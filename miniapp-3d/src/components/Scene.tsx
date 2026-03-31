import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import { DeskVignette } from "./DeskVignette";
import type { Memory, Playback } from "../types";
import { fetchPlayback } from "../api/client";
import { hasCustomWaypoints, waypointsToVectors } from "../cameraPath";

/** Сцена `gol_v3_2.glb` (камеры, свет, Erkan, слоты, temp1–temp3). */
const GLB_URL = `${import.meta.env.BASE_URL}gol_v3_2.glb`;
const CABINET_WOOD_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/cabinet-wood.png`;
const ORB_RADIUS = 0.1125;

/** UV плоскости Erkan из Blender — при необходимости подкрути (раньше для старой плоскости был π/2). */
const ERKAN_TEX_ROTATION = 0;

/**
 * KHR_lights_punctual в канделах/люксах. Экспорт Blender иногда даёт ~1e5 cd (пересвет с ACES),
 * иногда ~1e3–1e4 (gol_v3_2). Масштабируем по порогу; при смене сцены подкрути пороги/cap.
 */
const GLB_LIGHT_INTENSITY_INSANE = 50000;
const GLB_LIGHT_SCALE_INSANE = 1 / 80000;
const GLB_LIGHT_SCALE_NORMAL = 1 / 1000;
const GLB_SPOT_POINT_INTENSITY_CAP = 14;
/** Слабый fill — без world из GLB тени остают очень тёмными. */
const ROOM_HEMISPHERE_INTENSITY = 0.18;

function scaleGltfPunctualLights(root: THREE.Object3D) {
  root.traverse((obj) => {
    const light = obj as THREE.Light;
    if (!light.isLight) return;
    const spot = (light as THREE.SpotLight).isSpotLight;
    const point = (light as THREE.PointLight).isPointLight;
    const dir = (light as THREE.DirectionalLight).isDirectionalLight;
    if (!spot && !point && !dir) return;
    const i0 = light.intensity;
    const scale = i0 > GLB_LIGHT_INTENSITY_INSANE ? GLB_LIGHT_SCALE_INSANE : GLB_LIGHT_SCALE_NORMAL;
    light.intensity = i0 * scale;
    if (spot || point) light.intensity = Math.min(light.intensity, GLB_SPOT_POINT_INTENSITY_CAP);
  });
}

function asStandardMaterial(m: THREE.Material): THREE.MeshStandardMaterial | null {
  const sm = m as THREE.MeshStandardMaterial;
  return sm.isMeshStandardMaterial ? sm : null;
}

/** Шкаф: `Cube` / `Cube.001`; пол: нода `Plane`; потолок/верх: `Plane.001` — чуть светлее пола. */
function applyCabinetWoodAndRoomTuning(root: THREE.Object3D, woodSource: THREE.Texture) {
  woodSource.colorSpace = THREE.SRGBColorSpace;
  const cloneWood = (rx: number, ry: number) => {
    const tex = woodSource.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  const cabinetWood = cloneWood(1.15, 1.15);
  const floorWood = cloneWood(5.5, 5.5);

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const apply = (mat: THREE.Material) => {
      const sm = asStandardMaterial(mat);
      if (!sm) return;
      if (mesh.name === "Cube" || mesh.name === "Cube.001") {
        sm.map = cabinetWood;
        sm.metalness = 0.04;
        sm.roughness = 0.8;
        sm.needsUpdate = true;
      } else if (mesh.name === "Plane") {
        sm.map = floorWood;
        sm.metalness = 0;
        sm.roughness = 0.9;
        sm.needsUpdate = true;
      } else if (mesh.name === "Plane.001") {
        sm.color.lerp(new THREE.Color(1, 1, 1), 0.12);
        sm.needsUpdate = true;
      }
    };
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply);
    else apply(mesh.material);
  });
}

function getPerspectiveCamera(root: THREE.Object3D, name: string): THREE.PerspectiveCamera | null {
  let out: THREE.PerspectiveCamera | null = null;
  root.traverse((o) => {
    if (o.name !== name) return;
    const p = o as THREE.PerspectiveCamera;
    if (p.isPerspectiveCamera) {
      out = p;
      return;
    }
    for (const ch of o.children) {
      const c = ch as THREE.PerspectiveCamera;
      if (c.isPerspectiveCamera) {
        out = c;
        return;
      }
    }
  });
  return out;
}

function cameraFraming(cam: THREE.PerspectiveCamera, lookDist = 45) {
  cam.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  cam.getWorldPosition(pos);
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const look = pos.clone().addScaledVector(dir, lookDist);
  return { pos, look };
}

function bezierPoint(t: number, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) {
  const mt = 1 - t;
  return new THREE.Vector3(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z
  );
}

function smoothArcMid(a: THREE.Vector3, b: THREE.Vector3) {
  const m = a.clone().add(b).multiplyScalar(0.5);
  m.y += 0.12;
  return m;
}

/** Путь шара: слот → temp1 → temp2 → temp3 → финал (temp3 — последняя перед проектором). */
function orbFlightCurve(
  from: THREE.Vector3,
  t1: THREE.Vector3,
  t2: THREE.Vector3,
  t3: THREE.Vector3,
  end: THREE.Vector3
) {
  return new THREE.CatmullRomCurve3(
    [from.clone(), t1.clone(), t2.clone(), t3.clone(), end.clone()],
    false,
    "catmullrom",
    0.4
  );
}

type StoredArc =
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

const _desiredPos = new THREE.Vector3();

function SceneContent() {
  const { camera } = useThree();
  const { scene } = useGLTF(GLB_URL);
  const woodTexture = useTexture(CABINET_WOOD_TEXTURE_URL);
  const model = useMemo(() => {
    const m = scene.clone(true);
    scaleGltfPunctualLights(m);
    applyCabinetWoodAndRoomTuning(m, woodTexture);
    return m;
  }, [scene, woodTexture]);

  const phase = useStore((s) => s.phase);
  const setPhase = useStore((s) => s.setPhase);
  const memories = useStore((s) => s.memories);
  const selectedMemoryId = useStore((s) => s.selectedMemoryId);
  const selectMemory = useStore((s) => s.selectMemory);
  const telegramId = useStore((s) => s.telegramId);
  const initData = useStore((s) => s.initData);
  const setPlayback = useStore((s) => s.setPlayback);
  const setLoadingPlayback = useStore((s) => s.setLoadingPlayback);

  const [flying, setFlying] = useState<{ memory: Memory; pos: THREE.Vector3 } | null>(null);
  const [deskMemoryId, setDeskMemoryId] = useState<string | null>(null);
  const [playbackTexture, setPlaybackTexture] = useState<THREE.Texture | null>(null);
  const deskVideoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const deskVideoElRef = useRef<HTMLVideoElement | null>(null);
  const playbackTexRef = useRef<THREE.Texture | null>(null);
  const cameraArcTweenRef = useRef<gsap.core.Tween | null>(null);
  const cameraArcProgressRef = useRef({ t: 0 });
  const lastArcRef = useRef<StoredArc | null>(null);

  const lastSelectedIndex = useRef(0);

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
    const fb = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const slotFallback = fb(4.55, 1.45, 0.75);
    /** В GLB Blender: `Slot00`…`Slot09` (без подчёркивания). */
    const slots = Array.from({ length: 10 }, (_, i) => {
      const name = `Slot${String(i).padStart(2, "0")}`;
      return worldPos(name) ?? slotFallback.clone();
    });

    const erkanObj = get("Erkan");
    const erkanPivot = worldPos("Erkan") ?? fb(-7.81, 2.81, -3.72);
    const erkanCenter = (() => {
      if (!erkanObj) return erkanPivot.clone();
      const box = new THREE.Box3().setFromObject(erkanObj);
      if (!box.isEmpty()) return box.getCenter(new THREE.Vector3());
      const v = new THREE.Vector3();
      erkanObj.getWorldPosition(v);
      return v;
    })();

    const firstNamed = (...names: string[]) => {
      for (const n of names) {
        const v = worldPos(n);
        if (v) return v;
      }
      return null;
    };

    const roomCenter = new THREE.Vector3();
    slots.forEach((s) => roomCenter.add(s));
    roomCenter.multiplyScalar(1 / Math.max(slots.length, 1));

    const camShelf = getPerspectiveCamera(model, "Camera.001");
    const camProj = getPerspectiveCamera(model, "Camera");
    const shelfFrame = camShelf ? cameraFraming(camShelf) : { pos: fb(4.54, 1.11, -2.5), look: slots[4]?.clone() ?? slotFallback.clone() };
    const projFrame = camProj ? cameraFraming(camProj) : { pos: fb(-2.61, 2.57, -3.74), look: erkanCenter.clone() };

    return {
      slots,
      /** Маркер посадки шара у проектора; в текущем GLB нет `pos_final` — центр Erkan. */
      stand: firstNamed("pos_final", "Pos_final") ?? erkanCenter.clone(),
      shelfFrame,
      projFrame,
      camShelf,
      camProj,
      camTemp: firstNamed("Cam_temp", "cam_temp"),
      temp1: firstNamed("Temp1", "temp1"),
      temp2: firstNamed("Temp2", "temp2"),
      temp3: firstNamed("Temp3", "temp3"),
      erkanObj,
      erkanBaseScale: erkanObj?.scale.clone() ?? fb(2.02, 1, 1.35),
      roomCenter,
    };
  }, [model]);

  useEffect(() => {
    const hide = new Set([
      "Cam_temp",
      "cam_temp",
      "Temp1",
      "Temp2",
      "Temp3",
      "temp1",
      "temp2",
      "temp3",
    ]);
    model.traverse((o) => {
      if (hide.has(o.name)) o.visible = false;
    });
  }, [model]);

  useEffect(() => {
    const c = marker.camShelf;
    if (!c || !(camera instanceof THREE.PerspectiveCamera)) return;
    camera.fov = c.fov;
    camera.near = c.near;
    camera.far = c.far;
    camera.updateProjectionMatrix();
  }, [camera, marker.camShelf]);

  const cameraTarget = useRef({
    pos: marker.shelfFrame.pos.clone(),
    look: marker.shelfFrame.look.clone(),
  });
  const lookCurrent = useRef(cameraTarget.current.look.clone());

  const resizeErkanForMedia = useCallback(
    (mediaWidth: number, mediaHeight: number) => {
      const obj = marker.erkanObj;
      if (!obj || !mediaWidth || !mediaHeight) return;
      const base = marker.erkanBaseScale;
      const maxH = base.x;
      const maxW = base.z;
      const ar = mediaWidth / mediaHeight;
      let h: number;
      let w: number;
      if (ar >= 1) {
        w = maxW;
        h = w / ar;
        if (h > maxH) {
          h = maxH;
          w = h * ar;
        }
      } else {
        h = maxH;
        w = h * ar;
        if (w > maxW) {
          w = maxW;
          h = w / ar;
        }
      }
      obj.scale.set(h, base.y, w);
    },
    [marker.erkanBaseScale, marker.erkanObj]
  );

  const resetErkanScale = useCallback(() => {
    if (marker.erkanObj) marker.erkanObj.scale.copy(marker.erkanBaseScale);
  }, [marker.erkanBaseScale, marker.erkanObj]);

  const updateProjectionMaterial = useCallback(
    (texture: THREE.Texture | null) => {
      const placeholderMat = () =>
        new THREE.MeshStandardMaterial({
          color: "#0a0612",
          emissive: "#1a1028",
          emissiveIntensity: 0.08,
          roughness: 0.9,
          metalness: 0,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        });
      const projectionMat = (map: THREE.Texture) =>
        new THREE.MeshBasicMaterial({
          map,
          color: 0xffffff,
          toneMapped: false,
          transparent: true,
          opacity: 0.995,
          side: THREE.DoubleSide,
        });
      const obj = marker.erkanObj;
      if (!obj) return;
      obj.visible = phase === "DESK";
      const showMedia = Boolean(texture) && phase === "DESK";
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = showMedia ? projectionMat(texture!) : placeholderMat();
      });
    },
    [marker.erkanObj, phase]
  );

  useEffect(() => {
    updateProjectionMaterial(null);
  }, [marker.erkanObj, updateProjectionMaterial]);

  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-3.2 * delta);
    _desiredPos.copy(cameraTarget.current.pos);
    camera.position.lerp(_desiredPos, alpha);
    lookCurrent.current.lerp(cameraTarget.current.look, alpha);
    camera.lookAt(lookCurrent.current);
    const vt = deskVideoTextureRef.current;
    if (vt && vt.image instanceof HTMLVideoElement && vt.image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      vt.needsUpdate = true;
    }
  });

  useEffect(() => {
    const { pos, look } = marker.shelfFrame;
    camera.position.copy(pos);
    camera.lookAt(look);
    cameraTarget.current.pos.copy(pos);
    cameraTarget.current.look.copy(look);
    lookCurrent.current.copy(look);
  }, [camera, marker]);

  useEffect(() => {
    updateProjectionMaterial(playbackTexture);
  }, [phase, playbackTexture, updateProjectionMaterial]);

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
        const lookMid = lookStart.clone().add(lookEnd).multiplyScalar(0.5).lerp(marker.roomCenter, 0.2);
        const lookPts = [lookStart.clone(), lookMid, lookEnd.clone()];
        const posCurve = new THREE.CatmullRomCurve3(posPts, false, "catmullrom", 0.5);
        const lookCurve = new THREE.CatmullRomCurve3(lookPts, false, "catmullrom", 0.5);
        if (options?.storeForReverse) {
          lastArcRef.current = {
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

      const posMid = options?.positionMid?.clone() ?? smoothArcMid(posStart, posEnd);
      const lookMid = lookStart.clone().add(lookEnd).multiplyScalar(0.5);
      if (options?.storeForReverse) {
        lastArcRef.current = {
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

  const prepareTexForPlane = (tex: THREE.Texture) => {
    tex.center.set(0.5, 0.5);
    tex.rotation = ERKAN_TEX_ROTATION;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
  };

  const applyPlaybackToPlane = useCallback(
    (pb: Playback | null) => {
      if (!pb || pb.mediaType === "text" || !pb.url) {
        disposePlaybackResources();
        resetErkanScale();
        updateProjectionMaterial(null);
        return;
      }
      disposePlaybackResources();
      resetErkanScale();
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
          resizeErkanForMedia(w, h);
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
        video.volume = 0;
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
            resizeErkanForMedia(video.videoWidth, video.videoHeight);
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
    [disposePlaybackResources, resetErkanScale, resizeErkanForMedia, updateProjectionMaterial]
  );

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

  const runCameraArcReverse = useCallback(
    (durationScale = 1) => {
      cameraArcTweenRef.current?.kill();
      const arc = lastArcRef.current;
      if (!arc) {
        const { pos, look } = marker.shelfFrame;
        runCameraArc(pos, look, 0.85 * durationScale);
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
      const posCurve = new THREE.CatmullRomCurve3(arc.posPts.map((p) => p.clone()), false, "catmullrom", 0.5);
      const lookCurve = new THREE.CatmullRomCurve3(arc.lookPts.map((p) => p.clone()), false, "catmullrom", 0.5);
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
    [marker.shelfFrame, runCameraArc]
  );

  const goShelf = useCallback(() => {
    setFlying(null);
    selectMemory(null);
    setPlayback(null);
    disposePlaybackResources();
    resetErkanScale();
    setPhase("SHELF");
    const { pos, look } = marker.shelfFrame;
    runCameraArc(pos, look, 0.85);
  }, [disposePlaybackResources, resetErkanScale, marker.shelfFrame, selectMemory, setPhase, setPlayback, runCameraArc]);

  const onOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;
      const slot = slotForIndex(idx);
      lastSelectedIndex.current = idx;
      selectMemory(memory.id);
      setPhase("ZOOMED");
      const { pos: shelfPos } = marker.shelfFrame;
      const zoomPos = shelfPos.clone().lerp(slot, 0.64);
      runCameraArc(zoomPos, slot.clone(), 0.82);
    },
    [marker.shelfFrame, phase, selectMemory, setPhase, slotForIndex, runCameraArc]
  );

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

    const { pos: pEnd, look: lEnd } = marker.projFrame;
    const posMid = marker.camTemp?.clone() ?? smoothArcMid(cameraTarget.current.pos, pEnd);

    runCameraArc(pEnd, lEnd, 1.05, { storeForReverse: true, positionMid: posMid });

    const { temp1, temp2, temp3 } = marker;
    const orbDur = 1.35;
    const progress = { t: 0 };
    if (temp1 && temp2 && temp3) {
      const curve = orbFlightCurve(from, temp1, temp2, temp3, to);
      gsap.to(progress, {
        t: 1,
        duration: orbDur,
        ease: "power1.inOut",
        onUpdate: () =>
          setFlying((cur) => (cur ? { ...cur, pos: curve.getPoint(progress.t) } : cur)),
        onComplete: () => {
          setFlying(null);
          setDeskMemoryId(memory.id);
          setPhase("DESK");
        },
      });
    } else {
      const p0 = from.clone();
      const p2 = to.clone();
      const p1 = new THREE.Vector3((p0.x + p2.x) / 2 + 0.28, Math.max(p0.y, p2.y) + 0.75, (p0.z + p2.z) / 2 + 0.12);
      gsap.to(progress, {
        t: 1,
        duration: orbDur,
        ease: "power1.inOut",
        onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: bezierPoint(progress.t, p0, p1, p2) } : cur)),
        onComplete: () => {
          setFlying(null);
          setDeskMemoryId(memory.id);
          setPhase("DESK");
        },
      });
    }
  }, [
    initData,
    marker.camTemp,
    marker.projFrame,
    marker.stand,
    marker.temp1,
    marker.temp2,
    marker.temp3,
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
    resetErkanScale();
    updateProjectionMaterial(null);

    const camDur = lastArcRef.current?.duration ?? 1.05;
    const orbDur = 1.25;
    runCameraArcReverse(1);

    const { temp1, temp2, temp3 } = marker;
    const progress = { t: 0 };
    if (temp1 && temp2 && temp3) {
      const curve = orbFlightCurve(from, temp3, temp2, temp1, to);
      gsap.to(progress, {
        t: 1,
        duration: orbDur,
        ease: "power1.inOut",
        onUpdate: () =>
          setFlying((cur) => (cur ? { ...cur, pos: curve.getPoint(progress.t) } : cur)),
      });
    } else {
      const p1 = new THREE.Vector3((from.x + to.x) / 2 + 0.2, Math.max(from.y, to.y) + 0.75, (from.z + to.z) / 2 + 0.04);
      gsap.to(progress, {
        t: 1,
        duration: orbDur,
        ease: "power1.inOut",
        onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: bezierPoint(progress.t, from, p1, to) } : cur)),
      });
    }
    gsap.delayedCall(Math.max(camDur, orbDur), goShelf);
  }, [
    deskMemoryId,
    disposePlaybackResources,
    goShelf,
    resetErkanScale,
    marker,
    memories,
    phase,
    setPhase,
    slotForIndex,
    runCameraArcReverse,
    updateProjectionMaterial,
  ]);

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
      <hemisphereLight
        color="#d8e2ea"
        groundColor="#1e1e22"
        intensity={ROOM_HEMISPHERE_INTENSITY}
      />
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

      <DeskVignette />
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      camera={{ position: [4.52, 1.1, -2.4], fov: 47, near: 0.01, far: 200 }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.78,
      }}
      dpr={[1, 1.75]}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(GLB_URL);
useTexture.preload(CABINET_WOOD_TEXTURE_URL);
