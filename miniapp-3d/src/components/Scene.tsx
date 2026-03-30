import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, DepthOfField } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import type { Memory, Playback } from "../types";
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
  const { camera, size } = useThree();
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
  const deskZoom = useStore((s) => s.deskZoom);
  const setDeskZoom = useStore((s) => s.setDeskZoom);
  const videoVolume = useStore((s) => s.videoVolume);

  const [dofFocus, setDofFocus] = useState(0);
  const [flying, setFlying] = useState<{ memory: Memory; pos: THREE.Vector3 } | null>(null);
  const [deskMemoryId, setDeskMemoryId] = useState<string | null>(null);
  const [playbackTexture, setPlaybackTexture] = useState<THREE.Texture | null>(null);

  const isPortrait = size.height > size.width;
  const isTopShelf = (idx: number) => idx <= 4;

  const marker = useMemo(() => {
    const get = (name: string) => model.getObjectByName(name);
    const pos = (name: string) => get(name)?.position.clone() ?? null;
    const slots = Array.from({ length: 10 }, (_, i) => pos(`Slot_${String(i).padStart(2, "0")}`)).filter(Boolean) as THREE.Vector3[];
    return {
      slots,
      stand: pos("pos_final") ?? new THREE.Vector3(-3.33, 0.65, -3.67),
      startMobile: pos("CamStart_Mobile") ?? pos("pos_1_for_slots_0_1_2_3_4") ?? new THREE.Vector3(4.54, 1.11, -2.5),
      startDesktop: pos("CamStart_Desktop") ?? pos("pos_1_for_slots_0_1_2_3_4") ?? new THREE.Vector3(4.51, 1.02, -2.13),
      zoom1Mobile: pos("CamZoom1_Mobile") ?? new THREE.Vector3(4.55, 1.40, -1.64),
      zoom1Desktop: pos("CamZoom1_Desktop") ?? new THREE.Vector3(4.58, 1.56, -0.83),
      zoom2Mobile: pos("CamZoom2_Mobile") ?? new THREE.Vector3(4.55, 1.19, -1.62),
      zoom2Desktop: pos("CamZoom2_Desktop") ?? new THREE.Vector3(4.58, 1.31, -0.83),
      deskMobile: pos("CamDesk_Mobile") ?? pos("pos_prefinal") ?? new THREE.Vector3(-2.61, 2.57, -3.74),
      deskDesktop: pos("CamDesk_desktop") ?? pos("pos_prefinal") ?? new THREE.Vector3(-2.18, 2.70, -3.74),
      planeMobileObj: get("Plane_mobile"),
      planeDesktopObj: get("Plane_desktope"),
      planeMobilePos: pos("Plane_mobile") ?? pos("Plane") ?? new THREE.Vector3(-7.81, 2.81, -3.72),
      planeDesktopPos: pos("Plane_desktope") ?? pos("Plane") ?? new THREE.Vector3(-7.81, 2.75, -3.77),
      wardrobe: get("Wardrobe"),
      room: get("Room"),
    };
  }, [model]);

  const currentPlaneObj = isPortrait ? marker.planeMobileObj : marker.planeDesktopObj;
  const currentPlanePos = isPortrait ? marker.planeMobilePos : marker.planeDesktopPos;

  const cameraTarget = useRef({
    pos: (isPortrait ? marker.startMobile : marker.startDesktop).clone(),
    look: (marker.slots[2] ?? new THREE.Vector3(4.55, 1.45, 0.75)).clone(),
  });
  const lookCurrent = useRef(cameraTarget.current.look.clone());
  const lastSelectedIndex = useRef(0);

  const deskPosTarget = isPortrait ? marker.deskMobile : marker.deskDesktop;

  const updateProjectionMaterial = useCallback(
    (texture: THREE.Texture | null) => {
      const applyTo = (obj: THREE.Object3D | undefined) => {
        if (!obj) return;
        obj.visible = phase === "DESK";
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = new THREE.MeshStandardMaterial({
            color: "#0f071a",
            emissive: "#3a2452",
            emissiveIntensity: texture ? 0.45 : 0.2,
            map: texture ?? null,
            emissiveMap: texture ?? null,
            roughness: 0.88,
            metalness: 0.02,
            transparent: true,
            opacity: 0.98,
          });
        });
      };
      applyTo(marker.planeMobileObj ?? undefined);
      applyTo(marker.planeDesktopObj ?? undefined);
      if (marker.planeMobileObj) marker.planeMobileObj.visible = phase === "DESK" && isPortrait;
      if (marker.planeDesktopObj) marker.planeDesktopObj.visible = phase === "DESK" && !isPortrait;
    },
    [isPortrait, marker.planeDesktopObj, marker.planeMobileObj, phase]
  );

  // Base beta material pass.
  useEffect(() => {
    marker.wardrobe?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({
        color: "#5a3b22",
        roughness: 0.8,
        metalness: 0.08,
      });
    });
    marker.room?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({
        color: "#261344",
        roughness: 0.94,
        metalness: 0.02,
      });
    });
    updateProjectionMaterial(null);
  }, [marker.room, marker.wardrobe, updateProjectionMaterial]);

  // Camera smoothing + desk zoom dolly.
  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-5 * delta);
    const desiredPos = cameraTarget.current.pos.clone();
    if (phase === "DESK" && deskZoom > 0.001) {
      const dir = new THREE.Vector3().subVectors(cameraTarget.current.look, desiredPos).normalize();
      desiredPos.addScaledVector(dir, deskZoom * 1.15);
    }
    camera.position.lerp(desiredPos, alpha);
    lookCurrent.current.lerp(cameraTarget.current.look, alpha);
    camera.lookAt(lookCurrent.current);
  });

  // Init camera.
  useEffect(() => {
    const start = isPortrait ? marker.startMobile : marker.startDesktop;
    const look = marker.slots[2] ?? new THREE.Vector3(4.55, 1.45, 0.75);
    camera.position.copy(start);
    camera.lookAt(look);
    cameraTarget.current.pos.copy(start);
    cameraTarget.current.look.copy(look);
  }, [camera, isPortrait, marker]);

  // Responsive plane toggle.
  useEffect(() => {
    updateProjectionMaterial(playbackTexture);
  }, [isPortrait, phase, playbackTexture, updateProjectionMaterial]);

  // Build texture for projection plane from playback.
  const applyPlaybackToPlane = useCallback(
    (pb: Playback | null) => {
      if (!pb || pb.mediaType === "text" || !pb.url) {
        if (playbackTexture) playbackTexture.dispose();
        setPlaybackTexture(null);
        updateProjectionMaterial(null);
        return;
      }
      if (pb.mediaType === "photo") {
        const loader = new THREE.TextureLoader();
        loader.load(
          pb.url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            setPlaybackTexture(t);
            updateProjectionMaterial(t);
          },
          undefined,
          () => updateProjectionMaterial(null)
        );
        return;
      }
      if (pb.mediaType === "video") {
        const video = document.createElement("video");
        video.src = pb.url;
        video.crossOrigin = "anonymous";
        video.muted = false;
        video.volume = videoVolume;
        video.playsInline = true;
        video.loop = true;
        video.autoplay = true;
        video.play().catch(() => void 0);
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        setPlaybackTexture(texture);
        updateProjectionMaterial(texture);
      }
    },
    [playbackTexture, updateProjectionMaterial, videoVolume]
  );

  useEffect(() => {
    if (phase !== "DESK") return;
    applyPlaybackToPlane(useStore.getState().playback);
  }, [applyPlaybackToPlane, phase]);

  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (phase === "DESK") applyPlaybackToPlane(state.playback);
    });
    return () => unsub();
  }, [applyPlaybackToPlane, phase]);

  const slotForIndex = useCallback(
    (idx: number) => marker.slots[idx] ?? marker.slots[marker.slots.length - 1] ?? new THREE.Vector3(4.5, 1.4, 0.75),
    [marker.slots]
  );

  const tweenCamera = useCallback(
    (targetPos: THREE.Vector3, lookAt: THREE.Vector3, duration: number) => {
      gsap.to(cameraTarget.current.pos, { x: targetPos.x, y: targetPos.y, z: targetPos.z, duration, ease: "power2.inOut" });
      gsap.to(cameraTarget.current.look, { x: lookAt.x, y: lookAt.y, z: lookAt.z, duration, ease: "power2.inOut" });
    },
    []
  );

  const onOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;
      const slot = slotForIndex(idx);
      lastSelectedIndex.current = idx;
      selectMemory(memory.id);
      setPhase("ZOOMED");
      setDofFocus(0.0065);
      const target = isTopShelf(idx)
        ? (isPortrait ? marker.zoom1Mobile : marker.zoom1Desktop)
        : (isPortrait ? marker.zoom2Mobile : marker.zoom2Desktop);
      tweenCamera(target, slot, 0.85);
    },
    [isPortrait, marker, phase, selectMemory, setPhase, slotForIndex, tweenCamera]
  );

  const goShelf = useCallback(() => {
    setDeskZoom(0);
    setDofFocus(0);
    selectMemory(null);
    setPlayback(null);
    setPhase("SHELF");
    const idx = lastSelectedIndex.current;
    const slot = slotForIndex(Math.min(idx, marker.slots.length - 1));
    const start = isPortrait ? marker.startMobile : marker.startDesktop;
    tweenCamera(start, slot, 1.05);
  }, [isPortrait, marker, selectMemory, setDeskZoom, setPhase, setPlayback, slotForIndex, tweenCamera]);

  const startWatch = useCallback(async () => {
    if (phase !== "ZOOMED" || !selectedMemoryId) return;
    const idx = Math.max(0, memories.findIndex((m) => m.id === selectedMemoryId));
    const memory = memories[idx];
    const from = slotForIndex(idx);
    const to = marker.stand;
    lastSelectedIndex.current = idx;

    setPhase("TRANSITION");
    setDofFocus(0);
    setFlying({ memory, pos: from.clone() });

    if (telegramId) {
      setLoadingPlayback(true);
      fetchPlayback(telegramId, selectedMemoryId, initData)
        .then((pb) => setPlayback(pb))
        .finally(() => setLoadingPlayback(false));
    }

    tweenCamera(deskPosTarget, currentPlanePos, 1.5);

    const p0 = from.clone();
    const p2 = to.clone();
    const p1 = new THREE.Vector3((p0.x + p2.x) / 2 + 0.35, Math.max(p0.y, p2.y) + 0.9, (p0.z + p2.z) / 2 + 0.15);
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration: 1.35,
      ease: "power1.inOut",
      onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: bezierPoint(progress.t, p0, p1, p2) } : cur)),
      onComplete: () => {
        setFlying(null);
        setDeskMemoryId(memory.id);
        setPhase("DESK");
      },
    });
  }, [
    currentPlanePos,
    deskPosTarget,
    initData,
    marker.stand,
    memories,
    phase,
    selectedMemoryId,
    setLoadingPlayback,
    setPhase,
    setPlayback,
    slotForIndex,
    telegramId,
    tweenCamera,
  ]);

  const backFromDesk = useCallback(() => {
    if (phase !== "DESK" || !deskMemoryId) return;
    const idx = Math.max(0, memories.findIndex((m) => m.id === deskMemoryId));
    const memory = memories[idx];
    const from = marker.stand.clone();
    const to = slotForIndex(idx);
    setPhase("TRANSITION");
    setDeskMemoryId(null);
    setFlying({ memory, pos: from.clone() });
    updateProjectionMaterial(null);

    const start = isPortrait ? marker.startMobile : marker.startDesktop;
    tweenCamera(start, to, 1.35);

    const p1 = new THREE.Vector3((from.x + to.x) / 2 + 0.25, Math.max(from.y, to.y) + 0.9, (from.z + to.z) / 2 + 0.05);
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration: 1.2,
      ease: "power1.inOut",
      onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: bezierPoint(progress.t, from, p1, to) } : cur)),
      onComplete: goShelf,
    });
  }, [deskMemoryId, goShelf, isPortrait, marker, memories, phase, setPhase, slotForIndex, tweenCamera, updateProjectionMaterial]);

  useEffect(() => {
    window.addEventListener("scene:watch", startWatch);
    window.addEventListener("scene:back", backFromDesk);
    return () => {
      window.removeEventListener("scene:watch", startWatch);
      window.removeEventListener("scene:back", backFromDesk);
    };
  }, [backFromDesk, startWatch]);

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
          position={[flying.pos.x, flying.pos.y, flying.pos.z]}
          radius={ORB_RADIUS}
          color={flying.memory.color}
          orbIndex={0}
          previewUrl={flying.memory.previewUrl}
          isSelected
          isTransitioning
        />
      )}

      <ambientLight intensity={0.3} color="#8d6ad6" />
      <pointLight position={[4.6, 2.7, -1.5]} intensity={1.15} color="#f4d1b5" />
      <pointLight position={[-6.5, 3.2, -5.5]} intensity={1.1} color="#a2a7ff" />
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
    <Canvas camera={{ position: [4.52, 1.1, -2.4], fov: 47, near: 0.01, far: 100 }} gl={{ antialias: true }} dpr={[1, 2]} style={{ width: "100%", height: "100%" }}>
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(GLB_URL);
