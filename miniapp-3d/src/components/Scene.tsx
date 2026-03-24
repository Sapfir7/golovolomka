/**
 * Scene – the root R3F Canvas component.
 *
 * Manages:
 *  • All 3D objects (Shelf, MemoryOrb[], TractorBeam, DeskProjector)
 *  • Camera animation via useCameraRig / GSAP Timelines
 *  • Postprocessing (Bloom, DepthOfField)
 *  • All scene-phase transitions (SHELF → ZOOMED → TRANSITION → DESK → back)
 *
 * NOTE on WebGPU: @react-three/fiber v8 uses WebGLRenderer by default.
 * True WebGPU renderer (WebGPURenderer) in Three.js r173 is available via
 *   `<Canvas gl={{ ...webgpuProps }}>`
 * but requires a polyfill. We enable it opportunistically below.
 */
import { Canvas, useThree } from "@react-three/fiber";
import {
  Environment,
  AdaptiveDpr,
  PerformanceMonitor,
  OrbitControls,
} from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";

import { useStore } from "../store/useStore";
import { Shelf, orbSlotPosition } from "./Shelf";
import { MemoryOrb } from "./MemoryOrb";
import { TractorBeam } from "./TractorBeam";
import { DeskProjector, STAND_WORLD } from "./DeskProjector";
import { CameraInit, useCameraRig, SHELF_CAM, SHELF_LOOK } from "./CameraRig";
import { fetchPlayback } from "../api/client";
import type { Memory } from "../types";

// ─── Stable orb wrapper that captures the THREE.Group ref ────────────────────
interface OrbWithRefProps {
  memory: Memory;
  slotPos: [number, number, number];
  idx: number;
  isSelected: boolean;
  isTransitioning: boolean;
  onClick: () => void;
  onOrbMounted: (g: THREE.Group | null) => void;
}
function OrbWithRef({ memory, slotPos, idx, isSelected, isTransitioning, onClick, onOrbMounted }: OrbWithRefProps) {
  const ref = useRef<THREE.Group>(null!);

  useEffect(() => {
    onOrbMounted(ref.current);
    return () => onOrbMounted(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MemoryOrb
      position={slotPos}
      color={memory.color}
      orbIndex={idx}
      isSelected={isSelected}
      isTransitioning={isTransitioning}
      onClick={onClick}
      posRef={ref}
    />
  );
}

// ─── Bezier helper for orb flight path ────────────────────────────────────────
function bezierPoint(
  t: number,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3
): THREE.Vector3 {
  // Quadratic Bezier: B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
  const mt = 1 - t;
  return new THREE.Vector3(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z
  );
}

// ─── Inner component (has access to R3F context) ─────────────────────────────
function SceneInner() {
  const { camera } = useThree();
  const { flyToShelf, flyToOrb, flyToDesk } = useCameraRig();

  const phase = useStore((s) => s.phase);
  const setPhase = useStore((s) => s.setPhase);
  const memories = useStore((s) => s.memories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const selectMemory = useStore((s) => s.selectMemory);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setPlayback = useStore((s) => s.setPlayback);
  const setLoadingPlayback = useStore((s) => s.setLoadingPlayback);

  // Per-orb group refs for GSAP animation
  const orbRefs = useRef<Map<string, THREE.Group>>(new Map());

  // Tractor beam visibility
  const [beamVisible, setBeamVisible] = useState(false);
  const [beamPos, setBeamPos] = useState<[number, number, number]>([0, 5, 0]);

  // Screen texture state (null = blank screen)
  const [screenTexture, setScreenTexture] = useState<THREE.Texture | null>(null);
  const [spotlightOn, setSpotlightOn] = useState(false);

  // Track which orb is "in flight" (hidden from shelf while on desk)
  const [orbOnDesk, setOrbOnDesk] = useState<string | null>(null);

  // ── PHASE 2: Click orb → zoom in ─────────────────────────────────────────
  const handleOrbClick = useCallback(
    async (memory: Memory, slotIdx: number) => {
      if (phase !== "SHELF") return;

      const slotPos = orbSlotPosition(slotIdx);
      const target = new THREE.Vector3(...slotPos);

      setPhase("ZOOMED");
      selectMemory(memory.id);
      await flyToOrb(target, 1.0);
    },
    [phase, flyToOrb, selectMemory, setPhase]
  );

  // ── PHASE 3: "Watch" → TRANSITION ─────────────────────────────────────────
  const handleWatchMemory = useCallback(async () => {
    if (phase !== "ZOOMED" || !selectedMemoryId) return;

    const idx = memories.findIndex((m) => m.id === selectedMemoryId);
    if (idx < 0) return;

    const slotPos = orbSlotPosition(idx);
    const orbStart = new THREE.Vector3(...slotPos);
    const orbEnd = new THREE.Vector3(...STAND_WORLD);

    // Bezier control point: arc up and to the right
    const control = new THREE.Vector3(
      (orbStart.x + orbEnd.x) / 2 + 1,
      Math.max(orbStart.y, orbEnd.y) + 2.5,
      (orbStart.z + orbEnd.z) / 2
    );

    setPhase("TRANSITION");
    setBeamPos([slotPos[0], slotPos[1] + 4, slotPos[2]]);
    setBeamVisible(true);

    // Start fetching playback data in background
    if (telegramId) {
      setLoadingPlayback(true);
      fetchPlayback(telegramId, selectedMemoryId, initData)
        .then((pb) => setPlayback(pb))
        .catch(() => setPlayback({ mediaType: "text", note: "Не удалось загрузить воспоминание." }))
        .finally(() => setLoadingPlayback(false));
    }

    // GSAP timeline: camera retreats, orb flies, camera orbits to desk
    const orbRef = orbRefs.current.get(selectedMemoryId);

    const tl = gsap.timeline({
      onComplete: () => {
        setBeamVisible(false);
        setOrbOnDesk(selectedMemoryId);
        setSpotlightOn(true);
        flyToDesk(1.4).then(() => setPhase("DESK"));
      },
    });

    // 1. Camera pulls back slightly
    tl.to(camera.position, { z: camera.position.z + 2, duration: 0.5, ease: "power2.in" });

    // 2. Fly orb along bezier curve
    if (orbRef) {
      const prog = { t: 0 };
      tl.to(
        prog,
        {
          t: 1,
          duration: 1.6,
          ease: "power1.inOut",
          onUpdate: () => {
            const pt = bezierPoint(prog.t, orbStart, control, orbEnd);
            orbRef.position.set(pt.x, pt.y, pt.z);
          },
        },
        0.3
      );
    }

    // 3. Camera begins orbiting to desk view (starts partway through orb flight)
    tl.to(
      camera.position,
      { x: 8, y: 2, z: 11, duration: 1.8, ease: "power2.inOut" },
      0.6
    );
  }, [
    phase,
    selectedMemoryId,
    memories,
    camera,
    flyToDesk,
    setPhase,
    telegramId,
    initData,
    setPlayback,
    setLoadingPlayback,
  ]);

  // ── PHASE 5: "Back" → return orb to shelf ─────────────────────────────────
  const handleBack = useCallback(async () => {
    if (phase !== "DESK") return;

    setSpotlightOn(false);
    setPhase("TRANSITION");

    const idx = memories.findIndex((m) => m.id === selectedMemoryId);
    if (idx < 0) { setPhase("SHELF"); return; }

    const orbEnd = new THREE.Vector3(...orbSlotPosition(idx));
    const orbStart = new THREE.Vector3(...STAND_WORLD);
    const control = new THREE.Vector3(
      (orbStart.x + orbEnd.x) / 2,
      Math.max(orbStart.y, orbEnd.y) + 2.5,
      (orbStart.z + orbEnd.z) / 2
    );

    const orbRef = orbRefs.current.get(selectedMemoryId ?? "");

    setBeamPos([STAND_WORLD[0], STAND_WORLD[1] + 4, STAND_WORLD[2]]);
    setBeamVisible(true);

    const prog = { t: 0 };
    await new Promise<void>((resolve) => {
      const tl = gsap.timeline({ onComplete: resolve });
      if (orbRef) {
        tl.to(prog, {
          t: 1,
          duration: 1.4,
          ease: "power1.inOut",
          onUpdate: () => {
            const pt = bezierPoint(prog.t, orbStart, control, orbEnd);
            orbRef.position.set(pt.x, pt.y, pt.z);
          },
        });
      }
      tl.to(
        camera.position,
        { x: SHELF_CAM[0], y: SHELF_CAM[1], z: SHELF_CAM[2], duration: 1.8, ease: "power3.inOut" },
        0.2
      );
    });

    setBeamVisible(false);
    setOrbOnDesk(null);
    setScreenTexture(null);
    selectMemory(null);
    setPlayback(null);
    setPhase("SHELF");
    camera.lookAt(new THREE.Vector3(...SHELF_LOOK));
  }, [
    phase, selectedMemoryId, memories, camera,
    selectMemory, setPlayback, setPhase,
  ]);

  // Expose handleBack and handleWatchMemory to UIOverlay via store events
  useEffect(() => {
    // We use a custom event on window to bridge 2D UI → 3D scene
    const onWatch = () => handleWatchMemory();
    const onBack = () => handleBack();
    window.addEventListener("scene:watch", onWatch);
    window.addEventListener("scene:back", onBack);
    return () => {
      window.removeEventListener("scene:watch", onWatch);
      window.removeEventListener("scene:back", onBack);
    };
  }, [handleWatchMemory, handleBack]);

  // Subscribe to playback changes and build screen texture for photos
  const playback = useStore((s) => s.playback);
  useEffect(() => {
    if (!playback) { setScreenTexture(null); return; }
    if (playback.mediaType === "photo" && playback.url) {
      const loader = new THREE.TextureLoader();
      let cancelled = false;
      loader.load(playback.url, (tex) => {
        if (cancelled) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        setScreenTexture(tex);
      });
      return () => { cancelled = true; };
    } else {
      // video / text — screen stays blank (video plays in HTML overlay)
      setScreenTexture(null);
    }
  }, [playback]);

  return (
    <>
      <CameraInit />

      {/* ── Lighting ──────────────────────────────────────────────────── */}
      <ambientLight intensity={0.25} color="#c8d8ff" />
      <directionalLight
        position={[-4, 8, 6]}
        intensity={1.2}
        color="#fff8ee"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {/* Subtle fill from the right */}
      <directionalLight position={[8, 3, -2]} intensity={0.4} color="#ddeeff" />

      {/* ── HDR environment for reflections ───────────────────────────── */}
      <Environment preset="night" environmentIntensity={0.6} />

      {/* ── Shelf structure ───────────────────────────────────────────── */}
      <Shelf />

      {/* ── Memory orbs ───────────────────────────────────────────────── */}
      {memories.map((memory, idx) => {
        const slotPos = orbSlotPosition(idx);
        const isSelected = memory.id === selectedMemoryId;
        const isOnDesk = memory.id === orbOnDesk;
        const memId = memory.id;
        return (
          <OrbWithRef
            key={memId}
            memory={memory}
            slotPos={isOnDesk ? STAND_WORLD : slotPos}
            idx={idx}
            isSelected={isSelected}
            isTransitioning={phase === "TRANSITION"}
            onOrbMounted={(group) => { if (group) orbRefs.current.set(memId, group); else orbRefs.current.delete(memId); }}
            onClick={() => handleOrbClick(memory, idx)}
          />
        );
      })}

      {/* ── Tractor beam ──────────────────────────────────────────────── */}
      <TractorBeam position={beamPos} visible={beamVisible} />

      {/* ── Desk, projector, screen ───────────────────────────────────── */}
      <DeskProjector screenTexture={screenTexture} spotlightOn={spotlightOn} />

      {/* ── Postprocessing ─────────────────────────────────────────────── */}
      <EffectComposer>
        <Bloom
          intensity={0.9}
          luminanceThreshold={0.55}
          luminanceSmoothing={0.4}
          blendFunction={BlendFunction.ADD}
          mipmapBlur
        />
        <DepthOfField
          focusDistance={phase === "ZOOMED" ? 0.005 : 0.0}
          focalLength={0.02}
          bokehScale={phase === "ZOOMED" ? 5 : 0}
        />
      </EffectComposer>

      {/* Performance adapters */}
      <AdaptiveDpr pixelated />
      <PerformanceMonitor />
    </>
  );
}

// ─── Canvas wrapper ──────────────────────────────────────────────────────────
export function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 0.5, 11], fov: 55, near: 0.1, far: 200 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.1,
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
