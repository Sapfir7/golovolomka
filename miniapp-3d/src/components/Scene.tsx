import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import type { Memory } from "../types";
import { fetchPlayback } from "../api/client";

const GLB_URL = "/miniapp-3d/gol_v1.glb";
const ORB_RADIUS = 0.1125;

function bezierPoint(t: number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z
  );
}

function SceneContent() {
  const { camera } = useThree();
  const { scene } = useGLTF(GLB_URL);
  const model = useMemo(() => scene.clone(true), [scene]);

  const phase = useStore((s) => s.phase);
  const setPhase = useStore((s) => s.setPhase);
  const memories = useStore((s) => s.memories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const selectMemory = useStore((s) => s.selectMemory);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setPlayback = useStore((s) => s.setPlayback);
  const setLoadingPlayback = useStore((s) => s.setLoadingPlayback);
  const setDeskZoom = useStore((s) => s.setDeskZoom);

  const [dofFocus, setDofFocus] = useState(0);
  const [flying, setFlying] = useState<{
    memory: Memory;
    from: THREE.Vector3;
    to: THREE.Vector3;
    returnBack: boolean;
  } | null>(null);
  const [deskMemoryId, setDeskMemoryId] = useState<string | null>(null);

  const marker = useMemo(() => {
    const get = (name: string) => model.getObjectByName(name);
    const pos = (name: string) => get(name)?.position.clone() ?? null;
    const slots = Array.from({ length: 10 }, (_, i) =>
      pos(`Slot_${String(i).padStart(2, "0")}`)
    ).filter(Boolean) as THREE.Vector3[];
    return {
      slots,
      stand: pos("pos_final") ?? pos("StandPosition") ?? new THREE.Vector3(-3.33, 0.65, -3.67),
      shelfCam: pos("Camera.002") ?? pos("pos_1_for_slots_0_1_2_3_4") ?? new THREE.Vector3(4.55, 1.56, -1.08),
      shelfCamLower:
        pos("pos_1_for_slots_5_6_7_8_9") ?? pos("pos_1_for_slots_0_1_2_3_4") ?? new THREE.Vector3(4.55, 1.26, -1.08),
      deskCam: pos("Camera.001") ?? pos("pos_prefinal") ?? new THREE.Vector3(-3.33, 1.96, -3.67),
      plane: pos("Plane") ?? new THREE.Vector3(-7.82, 2.82, -3.72),
    };
  }, [model]);

  const cameraTarget = useRef({
    pos: marker.shelfCam.clone(),
    look: new THREE.Vector3(4.55, 1.45, 0.75),
  });
  const lookCurrent = useRef(cameraTarget.current.look.clone());
  const lastSelectedIndex = useRef(0);

  // Quick beta material pass (if Blender materials are placeholder).
  useEffect(() => {
    const wardrobe = model.getObjectByName("Wardrobe");
    const room = model.getObjectByName("Room");
    const plane = model.getObjectByName("Plane");

    wardrobe?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: "#5a3b22",
          roughness: 0.8,
          metalness: 0.08,
        });
      }
    });

    room?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: "#261344",
          roughness: 0.94,
          metalness: 0.02,
        });
      }
    });

    plane?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({
          color: "#13081f",
          emissive: "#24113a",
          emissiveIntensity: 0.32,
          roughness: 0.9,
        });
      }
    });
  }, [model]);

  // Camera smoothing.
  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-5 * delta);
    camera.position.lerp(cameraTarget.current.pos, alpha);
    lookCurrent.current.lerp(cameraTarget.current.look, alpha);
    camera.lookAt(lookCurrent.current);
  });

  // Init camera.
  useEffect(() => {
    camera.position.copy(marker.shelfCam);
    const initialLook = marker.slots[2] ?? new THREE.Vector3(4.55, 1.45, 0.75);
    camera.lookAt(initialLook);
    cameraTarget.current.pos.copy(marker.shelfCam);
    cameraTarget.current.look.copy(initialLook);
  }, [camera, marker]);

  const slotForIndex = useCallback(
    (idx: number) => marker.slots[idx] ?? marker.slots[marker.slots.length - 1] ?? new THREE.Vector3(4.5, 1.4, 0.75),
    [marker]
  );

  const onOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;
      const slot = slotForIndex(idx);
      lastSelectedIndex.current = idx;
      selectMemory(memory.id);
      setPhase("ZOOMED");
      setDofFocus(0.007);
      gsap.to(cameraTarget.current.pos, {
        x: slot.x,
        y: slot.y + 0.05,
        z: slot.z - 0.65,
        duration: 0.8,
        ease: "power2.out",
      });
      gsap.to(cameraTarget.current.look, {
        x: slot.x,
        y: slot.y,
        z: slot.z,
        duration: 0.8,
        ease: "power2.out",
      });
    },
    [phase, selectMemory, setPhase, slotForIndex]
  );

  const goShelf = useCallback(() => {
    setDeskZoom(0);
    setDofFocus(0);
    selectMemory(null);
    setPlayback(null);
    setPhase("SHELF");
    const targetCam = lastSelectedIndex.current >= 5 ? marker.shelfCamLower : marker.shelfCam;
    const slot = slotForIndex(Math.min(lastSelectedIndex.current, marker.slots.length - 1));
    gsap.to(cameraTarget.current.pos, {
      x: targetCam.x,
      y: targetCam.y,
      z: targetCam.z,
      duration: 1.1,
      ease: "power2.inOut",
    });
    gsap.to(cameraTarget.current.look, {
      x: slot.x,
      y: slot.y,
      z: slot.z,
      duration: 1.1,
      ease: "power2.inOut",
    });
  }, [marker, selectMemory, setDeskZoom, setPhase, setPlayback, slotForIndex]);

  const startWatch = useCallback(async () => {
    if (phase !== "ZOOMED" || !selectedMemoryId) return;
    const idx = Math.max(
      0,
      memories.findIndex((m) => m.id === selectedMemoryId)
    );
    const memory = memories[idx];
    const from = slotForIndex(idx);
    const to = marker.stand;
    lastSelectedIndex.current = idx;

    setPhase("TRANSITION");
    setDofFocus(0);
    setFlying({ memory, from: from.clone(), to: to.clone(), returnBack: false });

    // Load playback while transition runs.
    if (telegramId) {
      setLoadingPlayback(true);
      fetchPlayback(telegramId, selectedMemoryId, initData)
        .then((pb) => setPlayback(pb))
        .finally(() => setLoadingPlayback(false));
    }

    gsap.to(cameraTarget.current.pos, {
      x: marker.deskCam.x,
      y: marker.deskCam.y,
      z: marker.deskCam.z,
      duration: 1.5,
      ease: "power2.inOut",
    });
    gsap.to(cameraTarget.current.look, {
      x: marker.plane.x,
      y: marker.plane.y,
      z: marker.plane.z,
      duration: 1.5,
      ease: "power2.inOut",
    });

    const p0 = from.clone();
    const p2 = to.clone();
    const p1 = new THREE.Vector3(
      (p0.x + p2.x) / 2 + 0.35,
      Math.max(p0.y, p2.y) + 0.9,
      (p0.z + p2.z) / 2 + 0.15
    );
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration: 1.35,
      ease: "power1.inOut",
      onUpdate: () => {
        const p = bezierPoint(progress.t, p0, p1, p2);
        setFlying((cur) => (cur ? { ...cur, from: p } : cur));
      },
      onComplete: () => {
        setFlying(null);
        setDeskMemoryId(memory.id);
        setPhase("DESK");
      },
    });
  }, [
    phase,
    selectedMemoryId,
    memories,
    slotForIndex,
    marker,
    setPhase,
    telegramId,
    setLoadingPlayback,
    initData,
    setPlayback,
  ]);

  const backFromDesk = useCallback(() => {
    if (phase !== "DESK" || !deskMemoryId) return;
    const idx = Math.max(
      0,
      memories.findIndex((m) => m.id === deskMemoryId)
    );
    const memory = memories[idx];
    const to = slotForIndex(idx);
    const from = marker.stand.clone();
    setPhase("TRANSITION");
    setDeskMemoryId(null);
    setFlying({ memory, from: from.clone(), to: to.clone(), returnBack: true });

    const targetCam = idx >= 5 ? marker.shelfCamLower : marker.shelfCam;
    gsap.to(cameraTarget.current.pos, {
      x: targetCam.x,
      y: targetCam.y,
      z: targetCam.z,
      duration: 1.4,
      ease: "power2.inOut",
    });
    gsap.to(cameraTarget.current.look, {
      x: to.x,
      y: to.y,
      z: to.z,
      duration: 1.4,
      ease: "power2.inOut",
    });

    const p0 = from.clone();
    const p2 = to.clone();
    const p1 = new THREE.Vector3(
      (p0.x + p2.x) / 2 + 0.25,
      Math.max(p0.y, p2.y) + 0.9,
      (p0.z + p2.z) / 2 + 0.05
    );
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration: 1.2,
      ease: "power1.inOut",
      onUpdate: () => {
        const p = bezierPoint(progress.t, p0, p1, p2);
        setFlying((cur) => (cur ? { ...cur, from: p } : cur));
      },
      onComplete: goShelf,
    });
  }, [deskMemoryId, goShelf, marker, memories, phase, setPhase, slotForIndex]);

  useEffect(() => {
    window.addEventListener("scene:watch", startWatch);
    window.addEventListener("scene:back", backFromDesk);
    return () => {
      window.removeEventListener("scene:watch", startWatch);
      window.removeEventListener("scene:back", backFromDesk);
    };
  }, [startWatch, backFromDesk]);

  const visibleMemories = memories.slice(0, marker.slots.length || 10);

  return (
    <>
      <primitive object={model} />

      {visibleMemories.map((memory, i) => {
        if (memory.id === deskMemoryId) return null;
        if (flying?.memory.id === memory.id) return null;
        const slot = slotForIndex(i);
        return (
          <MemoryOrb
            key={memory.id}
            position={[slot.x, slot.y, slot.z]}
            radius={ORB_RADIUS}
            color={memory.color}
            orbIndex={i}
            previewUrl={memory.previewUrl}
            isSelected={memory.id === selectedMemoryId}
            isTransitioning={phase === "TRANSITION"}
            onClick={() => onOrbClick(memory, i)}
          />
        );
      })}

      {deskMemoryId && (() => {
        const mem = memories.find((m) => m.id === deskMemoryId);
        if (!mem) return null;
        return (
          <MemoryOrb
            position={[marker.stand.x, marker.stand.y, marker.stand.z]}
            radius={ORB_RADIUS}
            color={mem.color}
            orbIndex={0}
            previewUrl={mem.previewUrl}
            isSelected
            isTransitioning={false}
          />
        );
      })()}

      {flying && (
        <MemoryOrb
          position={[flying.from.x, flying.from.y, flying.from.z]}
          radius={ORB_RADIUS}
          color={flying.memory.color}
          orbIndex={0}
          previewUrl={flying.memory.previewUrl}
          isSelected
          isTransitioning
        />
      )}

      <ambientLight intensity={0.28} color="#8d6ad6" />
      <pointLight position={[4.6, 2.7, -1.5]} intensity={1.2} color="#f4d1b5" />
      <pointLight position={[-6.5, 3.2, -5.5]} intensity={1.2} color="#a2a7ff" />
      <Environment preset="studio" />

      <EffectComposer>
        <Bloom intensity={0.75} luminanceThreshold={0.6} luminanceSmoothing={0.3} />
        <DepthOfField focusDistance={dofFocus} focalLength={0.02} bokehScale={dofFocus > 0 ? 2.4 : 0} />
      </EffectComposer>
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      camera={{ position: [4.55, 1.55, -1.08], fov: 47, near: 0.01, far: 100 }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(GLB_URL);
