import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import type { Memory, Playback } from "../types";
import { fetchPlayback } from "../api/client";
import { hasCustomWaypoints, waypointsToVectors } from "../cameraPath";

/** Сцена из Blender; на сервере при отсутствии `gol_v2.glb` отдаётся `gol_v1.glb`. */
const GLB_URL = `${import.meta.env.BASE_URL}gol_v2.glb`;
const ORB_RADIUS = 0.1125;

/**
 * Blender planes have UVs where U→worldY (vertical) and V→worldZ (horizontal),
 * so every texture needs a 90° CCW rotation to display correctly.
 */
const PLANE_TEX_ROTATION = Math.PI / 2;

function bezierPoint(t: number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z
  );
}

function computeArcMid(
  posStart: THREE.Vector3,
  posEnd: THREE.Vector3,
  lookStart: THREE.Vector3,
  lookEnd: THREE.Vector3,
  roomCenter: THREE.Vector3
) {
  const mid = posStart.clone().add(posEnd).multiplyScalar(0.5);
  mid.y += 1.35;
  mid.z += 0.25;
  mid.lerp(roomCenter, 0.45);
  const lookMid = lookStart.clone().add(lookEnd).multiplyScalar(0.5).lerp(roomCenter, 0.5);
  lookMid.y += 0.15;
  return { mid, lookMid };
}

type StoredShelfToDeskArc =
  | {
      kind: "bezier";
      p0: THREE.Vector3;
      p1: THREE.Vector3;
      p2: THREE.Vector3;
      l0: THREE.Vector3;
      l1: THREE.Vector3;
      l2: THREE.Vector3;
      duration: number;
    }
  | {
      kind: "catmull";
      posPts: THREE.Vector3[];
      lookPts: THREE.Vector3[];
      duration: number;
    };

/** Pre-allocated vectors for useFrame to avoid GC every frame. */
const _desiredPos = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Пока только мобильная развёртка GLB (Plane_mobile, Cam*_Mobile). Десктоп — отдельный проход позже. */
const MOBILE_SCENE_ONLY = true;

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
  const deskZoom = useStore((s) => s.deskZoom);
  const setDeskZoom = useStore((s) => s.setDeskZoom);
  const videoVolume = useStore((s) => s.videoVolume);

  const [flying, setFlying] = useState<{ memory: Memory; pos: THREE.Vector3 } | null>(null);
  const [deskMemoryId, setDeskMemoryId] = useState<string | null>(null);
  const [playbackTexture, setPlaybackTexture] = useState<THREE.Texture | null>(null);
  const deskVideoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const deskVideoElRef = useRef<HTMLVideoElement | null>(null);
  const playbackTexRef = useRef<THREE.Texture | null>(null);
  const cameraArcTweenRef = useRef<gsap.core.Tween | null>(null);
  const cameraArcProgressRef = useRef({ t: 0 });
  /** Последняя траектория «зум к шару → проектор» — обратный полёт идёт по тем же точкам (t: 1→0). */
  const lastShelfToDeskArcRef = useRef<StoredShelfToDeskArc | null>(null);

  const isPortrait = MOBILE_SCENE_ONLY;
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
    const roomCenter = new THREE.Vector3();
    slots.forEach((s) => roomCenter.add(s));
    roomCenter.multiplyScalar(1 / Math.max(slots.length, 1));
    roomCenter.y += 1.15;
    roomCenter.x += 0.15;
    return {
      slots,
      stand: worldPos("pos_final") ?? fb(-3.33, 0.65, -3.67),
      startMobile: worldPos("CamStart_Mobile") ?? worldPos("pos_1_for_slots_0_1_2_3_4") ?? fb(4.54, 1.11, -2.5),
      startDesktop: worldPos("CamStart_Desktop") ?? worldPos("pos_1_for_slots_0_1_2_3_4") ?? fb(4.51, 1.02, -2.13),
      zoom1Mobile: worldPos("CamZoom1_Mobile") ?? fb(4.55, 1.4, -1.64),
      zoom1Desktop: worldPos("CamZoom1_Desktop") ?? fb(4.58, 1.56, -0.83),
      zoom2Mobile: worldPos("CamZoom2_Mobile") ?? fb(4.55, 1.19, -1.62),
      zoom2Desktop: worldPos("CamZoom2_Desktop") ?? fb(4.58, 1.31, -0.83),
      deskMobile: worldPos("CamDesk_Mobile") ?? worldPos("pos_prefinal") ?? fb(-2.61, 2.57, -3.74),
      deskDesktop: worldPos("CamDesk_desktop") ?? worldPos("pos_prefinal") ?? fb(-2.18, 2.7, -3.74),
      planeMobileObj,
      planeDesktopObj,
      /** Original Blender scales — used as basis for dynamic resize. */
      planeMobileScale: planeMobileObj?.scale.clone() ?? fb(2.02, 1, 1.35),
      planeDesktopScale: planeDesktopObj?.scale.clone() ?? fb(1.38, 1, 2.78),
      planeMobilePos: screenCenter(planeMobileObj, planeMobilePivot),
      planeDesktopPos: screenCenter(planeDesktopObj, planeDesktopPivot),
      wardrobe: get("Wardrobe"),
      room: get("Room"),
      /** Проходная точка камеры (полка → проектор); позиция из Blender, объект скрываем в сцене. */
      camTemp: worldPos("Cam_temp"),
      roomCenter,
    };
  }, [model]);

  useEffect(() => {
    model.traverse((o) => {
      if (o.name === "Cam_temp") o.visible = false;
    });
  }, [model]);

  const currentPlaneObj = isPortrait ? marker.planeMobileObj : marker.planeDesktopObj;
  const currentPlanePos = isPortrait ? marker.planeMobilePos : marker.planeDesktopPos;

  const cameraTarget = useRef({
    pos: (MOBILE_SCENE_ONLY ? marker.startMobile : marker.startDesktop).clone(),
    look: (marker.slots[2] ?? new THREE.Vector3(4.55, 1.45, 0.75)).clone(),
  });
  const lookCurrent = useRef(cameraTarget.current.look.clone());
  const lastSelectedIndex = useRef(0);

  const deskPosTarget = MOBILE_SCENE_ONLY ? marker.deskMobile : marker.deskDesktop;

  /** Camera further back so projector is ~70% of view. */
  const deskEyeExtended = useMemo(() => {
    const eye = deskPosTarget.clone();
    const target = currentPlanePos.clone();
    const pull = eye.clone().sub(target);
    if (pull.lengthSq() < 1e-8) return eye;
    return eye.add(pull.normalize().multiplyScalar(2.1));
  }, [deskPosTarget, currentPlanePos]);

  /**
   * Resize the active plane to match the media aspect ratio.
   * Plane local coords: [-1,0,1] to [1,0,-1] (2x2 quad in XZ).
   * After Blender rotation: scale.x → world Y height, scale.z → world Z width.
   */
  const resizePlaneForMedia = useCallback(
    (mediaWidth: number, mediaHeight: number) => {
      const obj = currentPlaneObj;
      if (!obj || !mediaWidth || !mediaHeight) return;
      const baseScale = isPortrait ? marker.planeMobileScale : marker.planeDesktopScale;
      const maxH = baseScale.x;
      const maxW = baseScale.z;
      const a = mediaWidth / mediaHeight;
      let h: number, w: number;
      if (a >= 1) {
        w = maxW;
        h = w / a;
        if (h > maxH) { h = maxH; w = h * a; }
      } else {
        h = maxH;
        w = h * a;
        if (w > maxW) { w = maxW; h = w / a; }
      }
      obj.scale.set(h, baseScale.y, w);
    },
    [currentPlaneObj, isPortrait, marker.planeDesktopScale, marker.planeMobileScale]
  );

  const resetPlaneScale = useCallback(() => {
    if (marker.planeMobileObj) marker.planeMobileObj.scale.copy(marker.planeMobileScale);
    if (marker.planeDesktopObj) marker.planeDesktopObj.scale.copy(marker.planeDesktopScale);
  }, [marker.planeDesktopObj, marker.planeDesktopScale, marker.planeMobileObj, marker.planeMobileScale]);

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
      applyToPlane(marker.planeMobileObj ?? undefined, isPortrait);
      applyToPlane(marker.planeDesktopObj ?? undefined, !isPortrait);
    },
    [isPortrait, marker.planeDesktopObj, marker.planeMobileObj, phase]
  );

  useEffect(() => {
    marker.wardrobe?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({
        color: "#7a5e3e",
        roughness: 0.72,
        metalness: 0.06,
      });
    });
    marker.room?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({
        color: "#3a2260",
        roughness: 0.85,
        metalness: 0.02,
      });
    });
    updateProjectionMaterial(null);
  }, [marker.room, marker.wardrobe, updateProjectionMaterial]);

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-2.8 * delta);
    _desiredPos.copy(cameraTarget.current.pos);
    if (phase === "DESK" && deskZoom > 0.001) {
      _dir.subVectors(cameraTarget.current.look, _desiredPos).normalize();
      _desiredPos.addScaledVector(_dir, deskZoom * 3.5);
    }
    camera.position.lerp(_desiredPos, alpha);
    lookCurrent.current.lerp(cameraTarget.current.look, alpha);
    camera.lookAt(lookCurrent.current);
    const vt = deskVideoTextureRef.current;
    if (vt && vt.image instanceof HTMLVideoElement && vt.image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      vt.needsUpdate = true;
    }
  });

  useEffect(() => {
    const start = MOBILE_SCENE_ONLY ? marker.startMobile : marker.startDesktop;
    const look = marker.slots[2] ?? new THREE.Vector3(4.55, 1.45, 0.75);
    camera.position.copy(start);
    camera.lookAt(look);
    cameraTarget.current.pos.copy(start);
    cameraTarget.current.look.copy(look);
  }, [camera, marker]);

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

  const runCameraArc = useCallback(
    (
      posEnd: THREE.Vector3,
      lookEnd: THREE.Vector3,
      duration: number,
      options?: { storeForReverse?: boolean; positionMid?: THREE.Vector3 }
    ) => {
      cameraArcTweenRef.current?.kill();
      const posStart = cameraTarget.current.pos.clone();
      const lookStart = cameraTarget.current.look.clone();
      const wps = hasCustomWaypoints() ? waypointsToVectors() : [];

      if (wps.length > 0) {
        const posPts = [posStart, ...wps.map((w) => w.clone()), posEnd.clone()];
        const { lookMid } = computeArcMid(posStart, posEnd, lookStart, lookEnd, marker.roomCenter);
        const lookPts = [lookStart.clone(), lookMid, lookEnd.clone()];
        const posCurve = new THREE.CatmullRomCurve3(posPts, false, "catmullrom", 0.5);
        const lookCurve = new THREE.CatmullRomCurve3(lookPts, false, "catmullrom", 0.5);
        if (options?.storeForReverse) {
          lastShelfToDeskArcRef.current = {
            kind: "catmull",
            posPts: posPts.map((p) => p.clone()),
            lookPts: lookPts.map((p) => p.clone()),
            duration,
          };
        }
        cameraArcProgressRef.current.t = 0;
        cameraArcTweenRef.current = gsap.to(cameraArcProgressRef.current, {
          t: 1,
          duration,
          ease: "sine.inOut",
          onUpdate: () => {
            const t = cameraArcProgressRef.current.t;
            cameraTarget.current.pos.copy(posCurve.getPoint(t));
            cameraTarget.current.look.copy(lookCurve.getPoint(t));
          },
        });
        return;
      }

      const { mid, lookMid } = computeArcMid(posStart, posEnd, lookStart, lookEnd, marker.roomCenter);
      const posMid = options?.positionMid ? options.positionMid.clone() : mid;
      if (options?.storeForReverse) {
        lastShelfToDeskArcRef.current = {
          kind: "bezier",
          p0: posStart.clone(),
          p1: posMid.clone(),
          p2: posEnd.clone(),
          l0: lookStart.clone(),
          l1: lookMid.clone(),
          l2: lookEnd.clone(),
          duration,
        };
      }
      cameraArcProgressRef.current.t = 0;
      cameraArcTweenRef.current = gsap.to(cameraArcProgressRef.current, {
        t: 1,
        duration,
        ease: "sine.inOut",
        onUpdate: () => {
          const t = cameraArcProgressRef.current.t;
          cameraTarget.current.pos.copy(bezierPoint(t, posStart, posMid, posEnd));
          cameraTarget.current.look.copy(bezierPoint(t, lookStart, lookMid, lookEnd));
        },
      });
    },
    [marker.roomCenter]
  );

  /** Configure texture rotation for Blender plane UV orientation. */
  const prepareTexForPlane = (tex: THREE.Texture) => {
    tex.center.set(0.5, 0.5);
    tex.rotation = PLANE_TEX_ROTATION;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
  };

  const applyPlaybackToPlane = useCallback(
    (pb: Playback | null) => {
      if (!pb || pb.mediaType === "text" || !pb.url) {
        disposePlaybackResources();
        resetPlaneScale();
        updateProjectionMaterial(null);
        return;
      }
      disposePlaybackResources();
      resetPlaneScale();
      updateProjectionMaterial(null);
      if (pb.mediaType === "photo") {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const w = img.naturalWidth || 1;
          const h = img.naturalHeight || 1;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, w, h);
          const t = new THREE.CanvasTexture(canvas);
          t.colorSpace = THREE.SRGBColorSpace;
          prepareTexForPlane(t);
          resizePlaneForMedia(w, h);
          playbackTexRef.current = t;
          setPlaybackTexture(t);
          updateProjectionMaterial(t);
        };
        img.onerror = () => {
          disposePlaybackResources();
          updateProjectionMaterial(null);
        };
        img.src = pb.url;
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
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        prepareTexForPlane(texture);
        video.addEventListener(
          "loadedmetadata",
          () => {
            resizePlaneForMedia(video.videoWidth, video.videoHeight);
            texture.needsUpdate = true;
          },
          { once: true }
        );
        void video.play().catch(() => void 0);
        deskVideoTextureRef.current = texture;
        playbackTexRef.current = texture;
        setPlaybackTexture(texture);
        updateProjectionMaterial(texture);
      }
    },
    [disposePlaybackResources, resetPlaneScale, resizePlaneForMedia, updateProjectionMaterial, videoVolume]
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

  /** Обратный пролёт по сохранённой кривой (те же контрольные точки, t: 1 → 0). */
  const runCameraArcReverse = useCallback(
    (durationScale = 1) => {
      cameraArcTweenRef.current?.kill();
      const arc = lastShelfToDeskArcRef.current;
      if (!arc) {
        const start = MOBILE_SCENE_ONLY ? marker.startMobile : marker.startDesktop;
        const look = slotForIndex(lastSelectedIndex.current);
        runCameraArc(start, look, 1.95 * durationScale);
        return;
      }
      const dur = arc.duration * durationScale;
      cameraArcProgressRef.current.t = 1;
      if (arc.kind === "bezier") {
        const { p0, p1, p2, l0, l1, l2 } = arc;
        cameraArcTweenRef.current = gsap.to(cameraArcProgressRef.current, {
          t: 0,
          duration: dur,
          ease: "sine.inOut",
          onUpdate: () => {
            const t = cameraArcProgressRef.current.t;
            cameraTarget.current.pos.copy(bezierPoint(t, p0, p1, p2));
            cameraTarget.current.look.copy(bezierPoint(t, l0, l1, l2));
          },
        });
        return;
      }
      const posCurve = new THREE.CatmullRomCurve3(
        arc.posPts.map((p) => p.clone()),
        false,
        "catmullrom",
        0.5
      );
      const lookCurve = new THREE.CatmullRomCurve3(
        arc.lookPts.map((p) => p.clone()),
        false,
        "catmullrom",
        0.5
      );
      cameraArcTweenRef.current = gsap.to(cameraArcProgressRef.current, {
        t: 0,
        duration: dur,
        ease: "sine.inOut",
        onUpdate: () => {
          const t = cameraArcProgressRef.current.t;
          cameraTarget.current.pos.copy(posCurve.getPoint(t));
          cameraTarget.current.look.copy(lookCurve.getPoint(t));
        },
      });
    },
    [marker.startDesktop, marker.startMobile, runCameraArc, slotForIndex]
  );

  const onOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;
      const slot = slotForIndex(idx);
      lastSelectedIndex.current = idx;
      selectMemory(memory.id);
      setPhase("ZOOMED");
      const target = isTopShelf(idx) ? marker.zoom1Mobile : marker.zoom2Mobile;
      runCameraArc(target, slot, 1.05);
    },
    [marker, phase, selectMemory, setPhase, slotForIndex, runCameraArc]
  );

  const goShelf = useCallback(() => {
    setDeskZoom(0);
    setFlying(null);
    selectMemory(null);
    setPlayback(null);
    disposePlaybackResources();
    resetPlaneScale();
    setPhase("SHELF");
    const idx = lastSelectedIndex.current;
    const slot = slotForIndex(Math.min(idx, marker.slots.length - 1));
    const start = MOBILE_SCENE_ONLY ? marker.startMobile : marker.startDesktop;
    runCameraArc(start, slot, 1.35);
  }, [disposePlaybackResources, resetPlaneScale, marker, selectMemory, setDeskZoom, setPhase, setPlayback, slotForIndex, runCameraArc]);

  const startWatch = useCallback(async () => {
    if (phase !== "ZOOMED" || !selectedMemoryId) return;
    const idx = Math.max(0, memories.findIndex((m) => m.id === selectedMemoryId));
    const memory = memories[idx];
    const from = slotForIndex(idx);
    const to = marker.stand;
    lastSelectedIndex.current = idx;

    setPhase("TRANSITION");
    setFlying({ memory, pos: from.clone() });

    if (telegramId) {
      setLoadingPlayback(true);
      fetchPlayback(telegramId, selectedMemoryId, initData)
        .then((pb) => setPlayback(pb))
        .finally(() => setLoadingPlayback(false));
    }

    runCameraArc(deskEyeExtended, currentPlanePos, 2.15, {
      storeForReverse: true,
      ...(marker.camTemp ? { positionMid: marker.camTemp } : {}),
    });

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
    deskEyeExtended,
    initData,
    marker.camTemp,
    marker.stand,
    memories,
    phase,
    selectedMemoryId,
    setLoadingPlayback,
    setPhase,
    setPlayback,
    slotForIndex,
    telegramId,
    runCameraArc,
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
    resetPlaneScale();
    updateProjectionMaterial(null);

    const camDur = lastShelfToDeskArcRef.current?.duration ?? 2.15;
    const orbDur = 1.2;
    runCameraArcReverse(1);

    const p1 = new THREE.Vector3((from.x + to.x) / 2 + 0.25, Math.max(from.y, to.y) + 0.9, (from.z + to.z) / 2 + 0.05);
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration: orbDur,
      ease: "power1.inOut",
      onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: bezierPoint(progress.t, from, p1, to) } : cur)),
    });
    gsap.delayedCall(Math.max(camDur, orbDur), goShelf);
  }, [deskMemoryId, disposePlaybackResources, goShelf, resetPlaneScale, marker, memories, phase, setPhase, slotForIndex, runCameraArcReverse, updateProjectionMaterial]);

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

      {deskMemoryId &&
        (() => {
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

      {/* ── Lighting ─────────────────────────────────────────────────── */}
      <ambientLight intensity={1.2} color="#d8cce8" />
      <hemisphereLight args={["#ede4f5", "#3a2260", 0.8]} />
      {/* Main warm key from above-right of the shelf */}
      <directionalLight position={[3, 5, 0]} intensity={1.8} color="#ffe4c4" />
      {/* Fill light from behind the camera during shelf view */}
      <pointLight position={[5, 2.5, -2]} intensity={2.5} color="#f5e0c8" distance={14} decay={1.2} />
      {/* Blue-purple accent from the projector wall side */}
      <pointLight position={[-6, 3, -4]} intensity={2.0} color="#a4a8e8" distance={16} decay={1.2} />
      {/* Soft fill from below to lighten the floor / underside */}
      <pointLight position={[0, 0.3, -2]} intensity={1.0} color="#c8b8e0" distance={10} decay={1.5} />
      {/* Spotlight on the projector screen area */}
      <spotLight
        position={[-3, 4.5, -3.7]}
        target-position={[-7.8, 2.7, -3.7]}
        angle={0.55}
        penumbra={0.6}
        intensity={2.0}
        color="#d0c8f0"
        distance={12}
        decay={1.2}
      />
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      camera={{ position: [4.52, 1.1, -2.4], fov: 47, near: 0.01, far: 100 }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
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
