/**
 * Scene – корневой R3F Canvas + вся 3D логика.
 *
 * Фазы и ЕДИНАЯ траектория камеры:
 *
 *  SHELF      → камера: [0, 2.5, 10] → смотрит на [0, 1.8, 0]
 *  ZOOMED     → камера подъезжает к шару; появляется 2D-карточка
 *  TRANSITION → шар летит по Bezier-кривой к стойке; камера движется к [0, 3.5, 2.5]
 *  DESK       → камера: [0, 3.5, 2.5] → смотрит на [0, 3.5, -10]; HTML-оверлей показывает воспоминание
 *  (обратно)  → шар летит обратно, камера возвращается на SHELF
 *
 * Чего НЕТ в этом файле:
 *  - Никакого useEffect для lookAt (теперь в CameraController/useFrame)
 *  - Никаких отдельных ref-ов с getterами/setterами
 */
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { useStore } from "../store/useStore";
import { Room } from "./Room";
import { Shelf, orbSlotPosition, PROJECTION_STAND_POS } from "./Shelf";
import { MemoryOrb } from "./MemoryOrb";
import { TractorBeam } from "./TractorBeam";
import { ProjectionArea } from "./ProjectionArea";
import { CameraController, camToShelf, camToOrb, camToDesk, camTarget, CAM_SHELF_POS, CAM_SHELF_LOOK } from "./CameraRig";
import { fetchPlayback } from "../api/client";
import type { Memory } from "../types";

// ─── Quadratic Bezier helper ──────────────────────────────────────────────────
function bezier3(t: number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z,
  );
}

// ─── Летящий шар (анимируется отдельно во время TRANSITION) ──────────────────
interface FlyingOrbProps {
  memory: Memory;
  from: [number, number, number];
  to: [number, number, number];
  duration?: number;
  onLanded: () => void;
}

function FlyingOrb({ memory, from, to, duration = 1.55, onLanded }: FlyingOrbProps) {
  const ref = useRef<THREE.Group>(null!);

  useEffect(() => {
    const p0 = new THREE.Vector3(...from);
    const p2 = new THREE.Vector3(...to);
    // Контрольная точка — дуга вверх и в сторону
    const p1 = new THREE.Vector3(
      (p0.x + p2.x) / 2 + (p2.x - p0.x) * 0.15,
      Math.max(p0.y, p2.y) + 3.2,
      (p0.z + p2.z) / 2,
    );
    const prog = { t: 0 };
    gsap.to(prog, {
      t: 1,
      duration,
      ease: "power1.inOut",
      onUpdate: () => {
        if (!ref.current) return;
        const pt = bezier3(prog.t, p0, p1, p2);
        ref.current.position.set(pt.x, pt.y, pt.z);
      },
      onComplete: onLanded,
    });
    return () => gsap.killTweensOf(prog);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={ref} position={from}>
      <MemoryOrb
        position={[0, 0, 0]}
        color={memory.color}
        orbIndex={0}
        isSelected
        isTransitioning
      />
    </group>
  );
}

// ─── Главный компонент сцены ──────────────────────────────────────────────────
function SceneInner() {
  const { camera } = useThree();

  const phase          = useStore((s) => s.phase);
  const setPhase       = useStore((s) => s.setPhase);
  const memories       = useStore((s) => s.memories);
  const selectedId     = useStore((s) => s.selectedMemoryId);
  const selectMemory   = useStore((s) => s.selectMemory);
  const telegramId     = useStore((s) => s.telegramId);
  const initData       = useStore((s) => s.initData);
  const setPlayback    = useStore((s) => s.setPlayback);
  const setLoadingPb   = useStore((s) => s.setLoadingPlayback);

  // Индекс выбранного шара (нужен для возврата на полку)
  const selectedIdxRef = useRef(-1);

  // Показывать ли шар на стойке
  const [orbOnDesk, setOrbOnDesk]       = useState<Memory | null>(null);
  // Шар в полёте
  const [flyingOrb, setFlyingOrb]       = useState<{
    memory: Memory; from: [number,number,number]; to: [number,number,number];
  } | null>(null);
  const [beamVisible, setBeamVisible]   = useState(false);
  const [beamPos, setBeamPos]           = useState<[number,number,number]>([0, 6, 0]);
  const [spotlightOn, setSpotlightOn]   = useState(false);
  const [dofFocus, setDofFocus]         = useState(0.0);

  // ── Инициализация камеры ─────────────────────────────────────────────────
  useEffect(() => {
    camera.position.set(...CAM_SHELF_POS);
    camera.lookAt(...CAM_SHELF_LOOK);
    camTarget.pos.set(...CAM_SHELF_POS);
    camTarget.look.set(...CAM_SHELF_LOOK);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ФАЗА 2: клик по шару ─────────────────────────────────────────────────
  const handleOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;

      const pos = new THREE.Vector3(...orbSlotPosition(idx));
      selectedIdxRef.current = idx;
      selectMemory(memory.id);
      setPhase("ZOOMED");
      camToOrb(pos, 0.85);
      setDofFocus(0.006);

      // Начинаем загружать playback заранее (пока пользователь читает карточку)
      if (telegramId) {
        setLoadingPb(true);
        fetchPlayback(telegramId, memory.id, initData)
          .then((pb) => setPlayback(pb))
          .catch(() => setPlayback({ mediaType: "text", note: "Не удалось загрузить воспоминание." }))
          .finally(() => setLoadingPb(false));
      }
    },
    [phase, selectMemory, setPhase, telegramId, initData, setPlayback, setLoadingPb],
  );

  // ── ФАЗА 3: "Смотреть" → TRANSITION ─────────────────────────────────────
  const startTransitionToDesk = useCallback(() => {
    if (phase !== "ZOOMED" || selectedId === null) return;
    const idx = selectedIdxRef.current;
    if (idx < 0) return;

    const from = orbSlotPosition(idx);
    const to = PROJECTION_STAND_POS;
    const mem = memories.find((m) => m.id === selectedId);
    if (!mem) return;

    setPhase("TRANSITION");
    setDofFocus(0);
    setBeamPos([from[0], from[1] + 4, from[2]]);
    setBeamVisible(true);

    // Шар исчезает с полки и начинает лететь
    setFlyingOrb({ memory: mem, from, to });

    // Одновременно камера идёт к позиции стола
    camToDesk(1.7);
  }, [phase, selectedId, memories, setPhase]);

  // Когда летящий шар приземлился на стойку
  const onOrbLandedDesk = useCallback(() => {
    const mem = memories.find((m) => m.id === selectedId);
    setFlyingOrb(null);
    setBeamVisible(false);
    if (mem) setOrbOnDesk(mem);
    setSpotlightOn(true);
    setPhase("DESK");
  }, [selectedId, memories, setPhase]);

  // ── ФАЗА 5: "Назад" → TRANSITION обратно ────────────────────────────────
  const startTransitionToShelf = useCallback(() => {
    if (phase !== "DESK" || !orbOnDesk) return;

    const idx = selectedIdxRef.current;
    const to = orbSlotPosition(idx >= 0 ? idx : 0);
    const from = PROJECTION_STAND_POS;

    setSpotlightOn(false);
    setPhase("TRANSITION");
    setOrbOnDesk(null);
    setBeamPos([from[0], from[1] + 4, from[2]]);
    setBeamVisible(true);
    setFlyingOrb({ memory: orbOnDesk, from, to });

    camToShelf(1.8);
  }, [phase, orbOnDesk, setPhase]);

  // Когда шар вернулся на полку
  const onOrbLandedShelf = useCallback(() => {
    setFlyingOrb(null);
    setBeamVisible(false);
    selectMemory(null);
    setPlayback(null);
    setPhase("SHELF");
  }, [selectMemory, setPlayback, setPhase]);

  // ── Слушаем события от UIOverlay ─────────────────────────────────────────
  useEffect(() => {
    window.addEventListener("scene:watch", startTransitionToDesk);
    return () => window.removeEventListener("scene:watch", startTransitionToDesk);
  }, [startTransitionToDesk]);

  useEffect(() => {
    window.addEventListener("scene:back", startTransitionToShelf);
    return () => window.removeEventListener("scene:back", startTransitionToShelf);
  }, [startTransitionToShelf]);

  // ── Рендер ───────────────────────────────────────────────────────────────
  const isShelfOrbHidden = (id: string) =>
    // Шар скрыт если он летит или стоит на стойке
    (flyingOrb?.memory.id === id) || (orbOnDesk?.id === id);

  return (
    <>
      <CameraController />

      {/* Окружение и HDR */}
      <Environment preset="night" environmentIntensity={0.4} />

      {/* Глобальное освещение */}
      <ambientLight intensity={0.18} color="#8844cc" />
      <directionalLight
        position={[-3, 8, 5]}
        intensity={1.0}
        color="#eeddef"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* Фиолетовая комната */}
      <Room />

      {/* Стеллаж */}
      <Shelf />

      {/* Шары на полках */}
      {memories.map((memory, idx) => {
        if (isShelfOrbHidden(memory.id)) return null;
        const slotPos = orbSlotPosition(idx);
        return (
          <MemoryOrb
            key={memory.id}
            position={slotPos}
            color={memory.color}
            orbIndex={idx}
            isSelected={memory.id === selectedId}
            isTransitioning={false}
            onClick={() => handleOrbClick(memory, idx)}
          />
        );
      })}

      {/* Летящий шар */}
      {flyingOrb && (
        <FlyingOrb
          key={`fly-${flyingOrb.memory.id}-${flyingOrb.from[2]}`}
          memory={flyingOrb.memory}
          from={flyingOrb.from}
          to={flyingOrb.to}
          onLanded={flyingOrb.to[2] < 0 ? onOrbLandedDesk : onOrbLandedShelf}
        />
      )}

      {/* Шар на стойке (статично) */}
      {orbOnDesk && (
        <MemoryOrb
          position={PROJECTION_STAND_POS}
          color={orbOnDesk.color}
          orbIndex={0}
          isSelected
          isTransitioning={false}
        />
      )}

      {/* Луч захвата */}
      <TractorBeam position={beamPos} visible={beamVisible} />

      {/* Стойка и прожектор */}
      <ProjectionArea spotlightOn={spotlightOn} />

      {/* Постобработка */}
      <EffectComposer>
        <Bloom
          intensity={1.1}
          luminanceThreshold={0.5}
          luminanceSmoothing={0.4}
          blendFunction={BlendFunction.ADD}
          mipmapBlur
        />
        <DepthOfField
          focusDistance={dofFocus}
          focalLength={0.022}
          bokehScale={dofFocus > 0 ? 4.5 : 0}
        />
      </EffectComposer>

      <AdaptiveDpr pixelated />
      <PerformanceMonitor />
    </>
  );
}

// ─── Canvas-обёртка ───────────────────────────────────────────────────────────
export function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 2.5, 10], fov: 52, near: 0.1, far: 200 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <SceneInner />
      </Suspense>
    </Canvas>
  );
}
