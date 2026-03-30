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
  const deskVideoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const deskVideoElRef = useRef<HTMLVideoElement | null>(null);
  const playbackTexRef = useRef<THREE.Texture | null>(null);

  const isPortrait = size.height > size.width;
  const isTopShelf = (idx: number) => idx <= 4;

  const marker = useMemo(() => {
    model.updateMatrixWorld(true);
    const get = (name: string) => model.getObjectByName(name);
    const worldPos = (name: string) => {
      const o = get(name);
      if (!o) return null;
      const v = new THREE.Vector3();
      o.getWorldPosition(v);
      return v;
    };
    /** Центр экрана в мировых координатах (для lookAt), не только pivot объекта. */
    const screenCenter = (obj: THREE.Object3D | undefined, pivotFallback: THREE.Vector3) => {
      if (!obj) return pivotFallback.clone();
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
      const v = new THREE.Vector3();
      obj.getWorldPosition(v);
      return v;
    };
    const fb = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const slotFallback = fb(4.55, 1.45, 0.75);
    const slots = Array.from({ length: 10 }, (_, i) => worldPos(`Slot_${String(i).padStart(2, "0")}`) ?? slotFallback.clone());
    const planeMobileObj = get("Plane_mobile");
    const planeDesktopObj = get("Plane_desktope");
    const planeMobilePivot = worldPos("Plane_mobile") ?? worldPos("Plane") ?? fb(-7.81, 2.81, -3.72);
    const planeDesktopPivot = worldPos("Plane_desktope") ?? worldPos("Plane") ?? fb(-7.81, 2.75, -3.77);
    return {
      slots,
      stand: worldPos("pos_final") ?? fb(-3.33, 0.65, -3.67),
      startMobile: worldPos("CamStart_Mobile") ?? worldPos("pos_1_for_slots_0_1_2_3_4") ?? fb(4.54, 1.11, -2.5),
      startDesktop: worldPos("CamStart_Desktop") ?? worldPos("pos_1_for_slots_0_1_2_3_4") ?? fb(4.51, 1.02, -2.13),
      zoom1Mobile: worldPos("CamZoom1_Mobile") ?? fb(4.55, 1.4, -1.64),
      zoom1Desktop: worldPos("CamZoom1_Desktop") ?? fb(4.58, 1.56, -0.83),
      zoom2Mobile: worldPos("CamZoom2_Mobile") ?? fb(4.55, 1.19, -1.62),
      zoom2Desktop: worldPos("CamZoom2_Desktop") ?? fb(4.58, 1.31, -0.83),
      /** Пара камера–экран из GLB: CamDesk_Mobile + Plane_mobile (портрет), CamDesk_desktop + Plane_desktope (альбом). */
      deskMobile: worldPos("CamDesk_Mobile") ?? worldPos("pos_prefinal") ?? fb(-2.61, 2.57, -3.74),
      deskDesktop: worldPos("CamDesk_desktop") ?? worldPos("pos_prefinal") ?? fb(-2.18, 2.7, -3.74),
      planeMobileObj,
      planeDesktopObj,
      planeMobilePos: screenCenter(planeMobileObj, planeMobilePivot),
      planeDesktopPos: screenCenter(planeDesktopObj, planeDesktopPivot),
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
      const placeholderMat = () =>
        new THREE.MeshStandardMaterial({
          color: "#0f071a",
          emissive: "#3a2452",
          emissiveIntensity: 0.2,
          roughness: 0.88,
          metalness: 0.02,
          transparent: true,
          opacity: 0.98,
          side: THREE.DoubleSide,
        });
      const projectionMat = (map: THREE.Texture) =>
        new THREE.MeshBasicMaterial({
          map,
          color: 0xffffff,
          toneMapped: false,
          transparent: true,
          opacity: 0.99,
          side: THREE.DoubleSide,
        });
      const applyToPlane = (obj: THREE.Object3D | undefined, isActive: boolean) => {
        if (!obj) return;
        obj.visible = phase === "DESK" && isActive;
        const showMedia = Boolean(texture) && phase === "DESK" && isActive;
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.material = showMedia ? projectionMat(texture!) : placeholderMat();
        });
      };
      // Трансляция только на «свою» плоскость; вторая остаётся без карты (не дублируем текстуру на оба меша).
      applyToPlane(marker.planeMobileObj ?? undefined, isPortrait);
      applyToPlane(marker.planeDesktopObj ?? undefined, !isPortrait);
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
    const vt = deskVideoTextureRef.current;
    if (vt && vt.image instanceof HTMLVideoElement && vt.image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      vt.needsUpdate = true;
    }
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

  const disposePlaybackResources = useCallback(() => {
    const v = deskVideoElRef.current;
    deskVideoElRef.current = null;
    deskVideoTextureRef.current = null;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    const t = playbackTexRef.current;
    playbackTexRef.current = null;
    if (t) t.dispose();
    setPlaybackTexture(null);
  }, []);

  // Build texture for projection plane from playback (same-origin URLs from /api/.../media).
  const applyPlaybackToPlane = useCallback(
    (pb: Playback | null) => {
      if (!pb || pb.mediaType === "text" || !pb.url) {
        disposePlaybackResources();
        updateProjectionMaterial(null);
        return;
      }
      disposePlaybackResources();
      updateProjectionMaterial(null);
      if (pb.mediaType === "photo") {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          pb.url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            playbackTexRef.current = t;
            setPlaybackTexture(t);
            updateProjectionMaterial(t);
          },
          undefined,
          () => {
            disposePlaybackResources();
            updateProjectionMaterial(null);
          }
        );
        return;
      }
      if (pb.mediaType === "video") {
        const video = document.createElement("video");
        deskVideoElRef.current = video;
        video.src = pb.url;
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.volume = videoVolume;
        video.playsInline = true;
        video.loop = true;
        video.setAttribute("playsinline", "");
        video.autoplay = true;
        void video.play().catch(() => void 0);
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        deskVideoTextureRef.current = texture;
        playbackTexRef.current = texture;
        setPlaybackTexture(texture);
        updateProjectionMaterial(texture);
      }
    },
    [disposePlaybackResources, updateProjectionMaterial, videoVolume]
  );

  useEffect(() => {
    const v = deskVideoElRef.current;
    if (!v) return;
    v.muted = videoVolume < 0.001;
    v.volume = videoVolume;
  }, [videoVolume]);

  useEffect(() => {
    if (phase !== "DESK") return;
    applyPlaybackToPlane(useStore.getState().playback);
  }, [applyPlaybackToPlane, phase]);

  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      if (state.phase === "DESK") applyPlaybackToPlane(state.playback);
    });
    return () => unsub();
  }, [applyPlaybackToPlane]);

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
    disposePlaybackResources();
    setPhase("SHELF");
    const idx = lastSelectedIndex.current;
    const slot = slotForIndex(Math.min(idx, marker.slots.length - 1));
    const start = isPortrait ? marker.startMobile : marker.startDesktop;
    tweenCamera(start, slot, 1.05);
  }, [disposePlaybackResources, isPortrait, marker, selectMemory, setDeskZoom, setPhase, setPlayback, slotForIndex, tweenCamera]);

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
    disposePlaybackResources();
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
  }, [deskMemoryId, disposePlaybackResources, goShelf, isPortrait, marker, memories, phase, setPhase, slotForIndex, tweenCamera, updateProjectionMaterial]);

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
