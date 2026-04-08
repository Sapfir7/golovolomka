import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { EffectComposer, Bloom, SSAO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import type { Memory, Playback } from "../types";
import { COLOR_HEX, CONE_BEAM_NEUTRAL, FALLBACK_VIGNETTE_HEX } from "../memoryPalette";
import { createScreenProjectionMaterial } from "../materials/screenProjectionMaterial";
import { createConeBeamMaterial } from "../materials/coneBeamMaterial";
import { fetchPlayback } from "../api/client";
import { BLOOM, EFFECT_COMPOSER, SSAO as SSAO_CFG } from "../postprocessingConfig";
import {
  applyGlbNormalScale,
  configureGlbPbrMaterials,
  enhanceGltfTextureSampling,
  GLB_NORMAL_SCALE_MUL,
  smoothGlbVertexNormals,
  softenGlbMaterials,
} from "../utils/gltfMaterialUtils";
import {
  GLB_CAMERA_SHELF,
  GLB_CAMERAS_OUT,
  GLB_CAMERAS_TO_SCREEN,
  GLB_CONE_NODE,
  GLB_FINISH_NODE,
  GLB_SCREEN_NODE_CANDIDATES,
  GLB_SHADOW_SKIP_NAMES,
  GLB_SLOT_NAME_RE,
  GLB_TABLE2_NODE,
} from "../constants/gltfSceneNodes";
import {
  CAM_FLY_AFTER_BEAM_DELAY,
  CAM_SHELF_TO_02_SEC,
  CAM_TO_MAIN_DURATION,
  IOS_WEBGL_SAFE,
  LIGHT_DIM_FACTOR,
  ORB_DROP_DURATION,
  ORB_RADIUS,
  PAUSE_AT_CAM02_AFTER_DROP_SEC,
  SCREEN_FADE_IN_EASE,
  SCREEN_FADE_IN_SEC,
  SCREEN_FADE_OUT_EASE,
  SCREEN_FADE_OUT_SEC,
  SCREEN_MIRROR_X,
  SCREEN_UV_ROTATION,
  SCENE_MODEL_URL,
  SPOT_BASE_INTENSITY,
  T_BEAM_START,
  T_CAM_TO_MAIN_START,
  T_DESK_ENTER,
  T_ORB_DROP_START,
  T_ORB_LAND,
  VIGNETTE_EXPAND,
} from "../constants/sceneConfig";

function liftVignetteTint(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.s = Math.min(0.92, hsl.s * 1.22);
  hsl.l = Math.min(0.58, hsl.l + 0.07);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

const _fwd = new THREE.Vector3(0, 0, -1);
const _quat = new THREE.Quaternion();

function CameraAspectSync() {
  const { camera, gl, size } = useThree();
  const sync = useCallback(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const el = gl.domElement;
    const w = el.width;
    const h = el.height;
    if (w <= 0 || h <= 0) return;
    const a = w / h;
    if (Math.abs(camera.aspect - a) > 1e-5) {
      camera.aspect = a;
      camera.updateProjectionMatrix();
    }
  }, [camera, gl]);
  useEffect(() => { sync(); }, [sync, size.width, size.height]);
  useFrame(() => { sync(); });
  return null;
}

function findCam(root: THREE.Object3D, name: string): THREE.PerspectiveCamera | null {
  let out: THREE.PerspectiveCamera | null = null;
  root.traverse((o) => {
    if (o.name !== name) return;
    if ((o as THREE.PerspectiveCamera).isPerspectiveCamera) { out = o as THREE.PerspectiveCamera; return; }
    for (const ch of o.children) {
      if ((ch as THREE.PerspectiveCamera).isPerspectiveCamera) { out = ch as THREE.PerspectiveCamera; return; }
    }
  });
  return out;
}

function camFrame(cam: THREE.PerspectiveCamera, dist = 10) {
  cam.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3(); cam.getWorldPosition(pos);
  cam.getWorldQuaternion(_quat);
  const dir = _fwd.clone().applyQuaternion(_quat).normalize();
  return { pos, look: pos.clone().addScaledVector(dir, dist) };
}

function worldPos(model: THREE.Object3D, name: string): THREE.Vector3 | null {
  const o = model.getObjectByName(name);
  if (!o) return null;
  const v = new THREE.Vector3(); o.getWorldPosition(v); return v;
}

const _desiredPos = new THREE.Vector3();

function smoothConeNormals(geometry: THREE.BufferGeometry): void {
  const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const normAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
  if (!posAttr || !normAttr) return;
  const tol = 1e-4;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < posAttr.count; i++) {
    const key = `${Math.round(posAttr.getX(i) / tol)},${Math.round(posAttr.getY(i) / tol)},${Math.round(posAttr.getZ(i) / tol)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(i);
  }
  const tmp = new THREE.Vector3();
  for (const indices of buckets.values()) {
    tmp.set(0, 0, 0);
    for (const i of indices) {
      tmp.x += normAttr.getX(i);
      tmp.y += normAttr.getY(i);
      tmp.z += normAttr.getZ(i);
    }
    if (tmp.lengthSq() < 1e-8) continue;
    tmp.normalize();
    for (const i of indices) normAttr.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  normAttr.needsUpdate = true;
}

/**
 * After GLB load: enable cast/receive shadows on scene meshes for light volume.
 * Skips helpers, cone, screen, trajectories, слоты; ignores tiny debris to limit GPU cost.
 */
function configureGlbMeshShadows(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    if (GLB_SHADOW_SKIP_NAMES.has(o.name) || GLB_SLOT_NAME_RE.test(o.name)) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      return;
    }
    let p: THREE.Object3D | null = o.parent;
    while (p) {
      if (GLB_SHADOW_SKIP_NAMES.has(p.name) || GLB_SLOT_NAME_RE.test(p.name)) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        return;
      }
      p = p.parent;
    }

    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function SceneContent() {
  const { camera, gl } = useThree();
  const { scene } = useGLTF(SCENE_MODEL_URL);
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
  const setDeskOrbTint = useStore((s) => s.setDeskOrbTint);
  const deskOrbTint = useStore((s) => s.deskOrbTint);
  const setGlbReady = useStore((s) => s.setGlbReady);

  useEffect(() => {
    setGlbReady(true);
    return () => setGlbReady(false);
  }, [setGlbReady]);

  const [flying, setFlying] = useState<{ memory: Memory; pos: THREE.Vector3 } | null>(null);
  const [deskMemoryId, setDeskMemoryId] = useState<string | null>(null);
  const [playbackTexture, setPlaybackTexture] = useState<THREE.Texture | null>(null);
  const screenOpacityRef = useRef(0);

  const deskVideoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const deskVideoElRef = useRef<HTMLVideoElement | null>(null);
  const playbackTexRef = useRef<THREE.Texture | null>(null);
  const lastAppliedPlaybackUrl = useRef<string | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const cameraTarget = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() });
  const lookCurrent = useRef(new THREE.Vector3());

  const coneMeshRef = useRef<THREE.Mesh | null>(null);
  const coneMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const coneOrigScaleRef = useRef<THREE.Vector3 | null>(null);
  const beamStrengthRef = useRef(0);
  const beamActiveRef = useRef(false);
  const screenFadeStartedRef = useRef(false);
  const screenVigTintRef = useRef<THREE.Color | null>(null);
  const screenFadeTweenRef = useRef<gsap.core.Tween | null>(null);
  const spotScreenRef = useRef<THREE.SpotLight | null>(null);
  const lightDimRef = useRef(1);
  const sceneLightsRef = useRef<{ light: THREE.Light; base: number }[]>([]);

  useEffect(() => {
    if (phase !== "DESK" || !deskMemoryId) { setDeskOrbTint(null); return; }
    const mem = memories.find((m) => m.id === deskMemoryId);
    setDeskOrbTint(mem?.color ?? null);
  }, [phase, deskMemoryId, memories, setDeskOrbTint]);

  const marker = useMemo(() => {
    model.updateMatrixWorld(true);
    const fb = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const wp = (n: string) => worldPos(model, n);

    const slotEntries: { idx: number; v: THREE.Vector3 }[] = [];
    model.traverse((o) => {
      const m = o.name.match(GLB_SLOT_NAME_RE);
      if (!m) return;
      const idx = parseInt(m[1], 10);
      const v = new THREE.Vector3();
      o.getWorldPosition(v);
      slotEntries.push({ idx, v });
    });
    slotEntries.sort((a, b) => a.idx - b.idx);
    const slots =
      slotEntries.length > 0
        ? slotEntries.map((e) => e.v)
        : [
            fb(-13.044, 7.625, -11.32),
            fb(-12.178, 7.625, -11.503),
            fb(-11.285, 7.625, -11.67),
            fb(-10.43, 7.625, -11.766),
          ];

    let screenObj: THREE.Object3D | null = null;
    for (const name of GLB_SCREEN_NODE_CANDIDATES) {
      const o = model.getObjectByName(name);
      if (o) {
        screenObj = o;
        break;
      }
    }

    const screenCenter = (() => {
      if (!screenObj) return fb(11.37, 3.65, 1.6);
      const box = new THREE.Box3().setFromObject(screenObj);
      return box.isEmpty() ? fb(11.37, 3.65, 1.6) : box.getCenter(new THREE.Vector3());
    })();

    const camShelf = findCam(model, GLB_CAMERA_SHELF);
    const roomC = slots
      .reduce((a, s) => a.add(s), new THREE.Vector3())
      .multiplyScalar(1 / Math.max(slots.length, 1));
    const p00 = wp("pos_00");
    let shelfFrame: { pos: THREE.Vector3; look: THREE.Vector3 };
    if (p00) {
      const toOrbs = new THREE.Vector3().subVectors(roomC, p00);
      if (toOrbs.lengthSq() < 1e-8) toOrbs.set(0.35, -0.15, 0.92);
      toOrbs.normalize();
      const eye = p00.clone().addScaledVector(toOrbs, -0.5);
      shelfFrame = { pos: eye, look: roomC.clone() };
    } else if (camShelf) {
      shelfFrame = camFrame(camShelf);
    } else {
      shelfFrame = { pos: fb(-40, 8, -2), look: fb(-15, 5, 0) };
    }

    const cTo0 = findCam(model, GLB_CAMERAS_TO_SCREEN[0]);
    const cTo1 = findCam(model, GLB_CAMERAS_TO_SCREEN[1]);
    const cTo2 = findCam(model, GLB_CAMERAS_TO_SCREEN[2]);
    const cTo3 = findCam(model, GLB_CAMERAS_TO_SCREEN[3]);
    const cOut5 = findCam(model, GLB_CAMERAS_OUT[0]);
    const cOut4 = findCam(model, GLB_CAMERAS_OUT[1]);

    const frameOr = (cam: THREE.PerspectiveCamera | null, fallback: { pos: THREE.Vector3; look: THREE.Vector3 }) =>
      cam ? camFrame(cam) : fallback;

    return {
      slots,
      screenObj,
      screenCenter,
      screenBaseScale: screenObj?.scale.clone() ?? fb(1, 1, 1),
      shelfFrame,
      camTo00Frame: frameOr(cTo0, shelfFrame),
      camTo01Frame: frameOr(cTo1, shelfFrame),
      camTo02Frame: frameOr(cTo2, shelfFrame),
      camTo03Frame: frameOr(cTo3, shelfFrame),
      camMainFrame: frameOr(cTo3, { pos: fb(-9.8, 3, -0.55), look: screenCenter.clone() }),
      camOut05Frame: frameOr(cOut5, shelfFrame),
      camOut04Frame: frameOr(cOut4, shelfFrame),
      camShelf,
      trajPos00: wp("pos_00"),
      trajPos01: wp("pos_01"),
      trajPos02: wp("pos_02"),
      trajFinish: wp(GLB_FINISH_NODE),
      roomCenter: roomC,
    };
  }, [model]);

  /* ── Lights + shadows (one spot casts; meshes via configureGlbMeshShadows) ── */
  useEffect(() => {
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;

    const POINT_BASE = 7.9;
    const POINT001 = 12.2;
    const collected: { light: THREE.Light; base: number }[] = [];

    smoothGlbVertexNormals(model);
    configureGlbPbrMaterials(model);
    softenGlbMaterials(model);
    enhanceGltfTextureSampling(model, gl);
    applyGlbNormalScale(model, GLB_NORMAL_SCALE_MUL);

    model.traverse((o) => {
      const light = o as THREE.Light;
      if (!light.isLight) return;
      light.castShadow = false;

      if ((light as THREE.PointLight).isPointLight) {
        const inten = o.name === "Point.001" ? POINT001 : POINT_BASE;
        light.intensity = inten;
        collected.push({ light, base: inten });
      }
      if ((light as THREE.SpotLight).isSpotLight) {
        if (o.name === "Spot_screen" || o.name === "Spot.001") {
          const spot = light as THREE.SpotLight;
          spotScreenRef.current = spot;
          spot.intensity = SPOT_BASE_INTENSITY;
          spot.castShadow = true;
          spot.shadow.mapSize.set(2048, 2048);
          spot.shadow.radius = 3.5;
          spot.shadow.bias = -0.0001;
          spot.shadow.normalBias = 0.05;
          collected.push({ light, base: SPOT_BASE_INTENSITY });
        } else {
          light.intensity = 7.5;
          collected.push({ light, base: 7.5 });
        }
      }
      if ((light as THREE.DirectionalLight).isDirectionalLight) {
        light.intensity = 0.52;
        collected.push({ light, base: 0.52 });
      }
    });

    sceneLightsRef.current = collected;
    configureGlbMeshShadows(model);

    const hideTraj = new Set<string>(["pos_00", "pos_01", "pos_02", GLB_FINISH_NODE]);
    model.traverse((o) => {
      if (hideTraj.has(o.name)) o.visible = false;
    });

    const table2 = model.getObjectByName(GLB_TABLE2_NODE);
    if (table2) table2.visible = false;

    model.traverse((o) => {
      if (o.name === "Sphere" || o.name.startsWith("Sphere.")) o.visible = false;
    });

    const conusNode = model.getObjectByName(GLB_CONE_NODE);
    if (conusNode) {
      coneOrigScaleRef.current = conusNode.scale.clone();
      conusNode.traverse((ch) => {
        const mesh = ch as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          coneMeshRef.current = mesh;
          smoothConeNormals(mesh.geometry);
          mesh.geometry.computeBoundingBox();
          const box = mesh.geometry.boundingBox!;
          const tipLocal = new THREE.Vector3(
            (box.min.x + box.max.x) / 2,
            box.max.y,
            (box.min.z + box.max.z) / 2,
          );
          const baseLocal = new THREE.Vector3(
            (box.min.x + box.max.x) / 2,
            box.min.y,
            (box.min.z + box.max.z) / 2,
          );
          mesh.updateWorldMatrix(true, false);
          const tipWorld = tipLocal.clone().applyMatrix4(mesh.matrixWorld);
          const baseWorld = baseLocal.clone().applyMatrix4(mesh.matrixWorld);
          const atten = Math.max(tipWorld.distanceTo(baseWorld) * 1.3, 3.0);
          const mat = createConeBeamMaterial(mesh.geometry, {
            color: CONE_BEAM_NEUTRAL, strength: 0, spotPos: tipWorld,
            attenuation: atten, anglePower: 2.0,
          });
          coneMatRef.current = mat;
          mesh.material = mat;
        }
      });
      conusNode.visible = false;
    }
  }, [gl, model]);

  /* ── Initial camera ── */
  useEffect(() => {
    const c = marker.camShelf;
    if (c && camera instanceof THREE.PerspectiveCamera) {
      camera.fov = c.fov; camera.near = c.near; camera.far = c.far;
      camera.updateProjectionMatrix();
    }
    const { pos, look } = marker.shelfFrame;
    camera.position.copy(pos); camera.lookAt(look);
    cameraTarget.current.pos.copy(pos);
    cameraTarget.current.look.copy(look);
    lookCurrent.current.copy(look);
  }, [camera, marker]);

  /* ── Screen material ── */
  const screenShaderRef = useRef<THREE.ShaderMaterial | null>(null);

  const resetScreenScale = useCallback(() => {
    if (marker.screenObj) marker.screenObj.scale.copy(marker.screenBaseScale);
  }, [marker.screenBaseScale, marker.screenObj]);

  const resizeScreenForMedia = useCallback(
    (mw: number, mh: number) => {
      const obj = marker.screenObj;
      if (!obj || !mw || !mh) return;
      const base = marker.screenBaseScale;
      const maxH = base.x, maxW = base.z;
      const ar = mw / mh;
      let h: number, w: number;
      if (ar >= 1) { w = maxW; h = w / ar; if (h > maxH) { h = maxH; w = h * ar; } }
      else { h = maxH; w = h * ar; if (w > maxW) { w = maxW; h = w / ar; } }
      obj.scale.set(h * VIGNETTE_EXPAND, base.y, w * VIGNETTE_EXPAND);
    },
    [marker.screenBaseScale, marker.screenObj]
  );

  const adaptConeToScreen = useCallback(() => {
    const conusNode = model.getObjectByName(GLB_CONE_NODE);
    const orig = coneOrigScaleRef.current;
    const obj = marker.screenObj;
    if (!conusNode || !orig || !obj) return;
    const base = marker.screenBaseScale;
    const ratioX = obj.scale.x / base.x;
    const ratioZ = obj.scale.z / base.z;
    const shrink = 0.82;
    conusNode.scale.set(orig.x * ratioX * shrink, orig.y, orig.z * ratioZ * shrink);
  }, [model, marker.screenObj, marker.screenBaseScale]);

  const aimSpotAtScreen = useCallback(() => {
    const spot = spotScreenRef.current;
    const obj = marker.screenObj;
    if (!spot || !obj || !marker.screenCenter) return;
    spot.target.position.copy(marker.screenCenter);
    spot.target.updateMatrixWorld();
    const areaH = obj.scale.x;
    const areaW = obj.scale.z;
    const diag = Math.sqrt(areaW * areaW + areaH * areaH) * 0.5;
    const dist = spot.position.distanceTo(marker.screenCenter);
    spot.angle = Math.atan2(diag, dist) * 1.1;
    spot.penumbra = 0.4;
  }, [marker.screenObj, marker.screenCenter]);

  const applyScreenTexture = useCallback(
    (texture: THREE.Texture, opacity: number) => {
      const obj = marker.screenObj;
      if (!obj) return;
      obj.visible = true;
      screenShaderRef.current = null;
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const prev = mesh.material;
        if (prev instanceof THREE.ShaderMaterial) prev.dispose();
        const baseHex = screenVigTintRef.current
          ? `#${screenVigTintRef.current.getHexString()}`
          : (deskOrbTint ? COLOR_HEX[deskOrbTint] : FALLBACK_VIGNETTE_HEX);
        const vigTint = liftVignetteTint(baseHex);
        const mat = createScreenProjectionMaterial(texture, {
          vignetteTint: vigTint, vignetteStrength: 0.52,
          uvRotation: SCREEN_UV_ROTATION, mirrorX: SCREEN_MIRROR_X,
          colorMix: 0.3,
          texScale: 1 / VIGNETTE_EXPAND,
          sphereCurve: 0.028,
        });
        mat.uniforms.uOpacity = { value: opacity };
        screenShaderRef.current = mat;
        mesh.material = mat;
      });
    },
    [deskOrbTint, marker.screenObj]
  );

  const hideScreen = useCallback(() => {
    const obj = marker.screenObj;
    if (!obj) return;
    obj.visible = false;
    screenShaderRef.current = null;
  }, [marker.screenObj]);

  useEffect(() => { hideScreen(); }, [hideScreen]);

  /* ── Cone visibility ── */
  const showCone = useCallback((color?: THREE.Color) => {
    const conusNode = model.getObjectByName(GLB_CONE_NODE);
    if (conusNode) conusNode.visible = true;
    if (color && coneMatRef.current) {
      coneMatRef.current.uniforms.uColor.value.copy(color);
    }
  }, [model]);

  const hideCone = useCallback(() => {
    const conusNode = model.getObjectByName(GLB_CONE_NODE);
    if (conusNode) conusNode.visible = false;
    beamStrengthRef.current = 0;
    if (coneMatRef.current) {
      coneMatRef.current.uniforms.uStrength.value = 0;
      coneMatRef.current.uniforms.uReveal.value = 0;
      coneMatRef.current.uniforms.uColor.value.set(CONE_BEAM_NEUTRAL);
    }
    const orig = coneOrigScaleRef.current;
    if (conusNode && orig) conusNode.scale.copy(orig);
  }, [model]);

  /* ── Camera lerp + per-frame uniforms ── */
  useFrame((_, delta) => {
    const alpha = 1 - Math.exp(-6 * delta);
    _desiredPos.copy(cameraTarget.current.pos);
    camera.position.lerp(_desiredPos, alpha);
    lookCurrent.current.lerp(cameraTarget.current.look, alpha);
    camera.lookAt(lookCurrent.current);

    const mat = screenShaderRef.current;
    if (mat && mat.uniforms.uOpacity) mat.uniforms.uOpacity.value = screenOpacityRef.current;

    const vt = deskVideoTextureRef.current;
    if (vt && vt.image instanceof HTMLVideoElement && vt.image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
      vt.needsUpdate = true;

    const cm = coneMatRef.current;
    if (cm) {
      cm.uniforms.uStrength.value = beamStrengthRef.current;
      cm.uniforms.uTime.value += delta;
    }

    const dim = lightDimRef.current;
    for (const entry of sceneLightsRef.current) {
      entry.light.intensity = entry.base * dim;
    }
  });

  /* ── Playback loading ── */
  const disposePlaybackResources = useCallback(() => {
    const v = deskVideoElRef.current; deskVideoElRef.current = null; deskVideoTextureRef.current = null;
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
    const t = playbackTexRef.current; playbackTexRef.current = null; if (t) t.dispose();
    setPlaybackTexture(null);
    lastAppliedPlaybackUrl.current = null;
  }, []);

  const loadPlaybackTexture = useCallback(
    (pb: Playback) => {
      if (!pb.url) return;
      if (pb.url === lastAppliedPlaybackUrl.current) return;
      lastAppliedPlaybackUrl.current = pb.url;
      disposePlaybackResources();
      lastAppliedPlaybackUrl.current = pb.url;
      if (pb.mediaType === "photo") {
        const img = new Image(); img.crossOrigin = "anonymous";
        img.onload = () => {
          const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
          const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d"); if (!ctx) return;
          ctx.drawImage(img, 0, 0, w, h);
          const t = new THREE.CanvasTexture(canvas);
          t.colorSpace = THREE.SRGBColorSpace;
          t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
          t.needsUpdate = true;
          resizeScreenForMedia(w, h);
          adaptConeToScreen();
          aimSpotAtScreen();
          playbackTexRef.current = t;
          setPlaybackTexture(t);
        };
        img.src = pb.url;
      } else if (pb.mediaType === "video") {
        const video = document.createElement("video");
        deskVideoElRef.current = video;
        video.src = pb.url; video.crossOrigin = "anonymous";
        video.muted = true; video.volume = 0; video.playsInline = true;
        video.loop = true; video.setAttribute("playsinline", ""); video.autoplay = true;
        const texture = new THREE.VideoTexture(video);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
        video.addEventListener("loadedmetadata", () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            resizeScreenForMedia(video.videoWidth, video.videoHeight);
            adaptConeToScreen();
            aimSpotAtScreen();
          }
          texture.needsUpdate = true;
        }, { once: true });
        void video.play().catch(() => void 0);
        deskVideoTextureRef.current = texture;
        playbackTexRef.current = texture;
        setPlaybackTexture(texture);
      }
    },
    [adaptConeToScreen, aimSpotAtScreen, disposePlaybackResources, resizeScreenForMedia]
  );

  useEffect(() => {
    if (!playbackTexture) return;
    if (!beamActiveRef.current) return;
    applyScreenTexture(playbackTexture, screenOpacityRef.current);
  }, [playbackTexture, applyScreenTexture]);

  /* ── Helpers ── */
  const slotForIndex = useCallback(
    (idx: number) => marker.slots[idx] ?? marker.slots[marker.slots.length - 1] ?? new THREE.Vector3(4.5, 1.4, 0.75),
    [marker.slots]
  );

  function animateCam(frames: { pos: THREE.Vector3; look: THREE.Vector3 }[], dur: number): gsap.core.Tween {
    const pts = frames.map((f) => f.pos.clone());
    const lks = frames.map((f) => f.look.clone());
    const posCurve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.35);
    const lookCurve = new THREE.CatmullRomCurve3(lks, false, "catmullrom", 0.35);
    const prog = { t: 0 };
    return gsap.to(prog, {
      t: 1, duration: dur, ease: "sine.inOut",
      onUpdate: () => {
        cameraTarget.current.pos.copy(posCurve.getPoint(prog.t));
        cameraTarget.current.look.copy(lookCurve.getPoint(prog.t));
      },
    });
  }

  function animateOrb(from: THREE.Vector3, waypoints: THREE.Vector3[], dur: number): gsap.core.Tween {
    const pts = [from.clone(), ...waypoints.map((w) => w.clone())];
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.35);
    const prog = { t: 0 };
    return gsap.to(prog, {
      t: 1, duration: dur, ease: "power1.inOut",
      onUpdate: () => setFlying((cur) => (cur ? { ...cur, pos: curve.getPoint(prog.t) } : cur)),
    });
  }

  /* ── Go to shelf ── */
  const goShelf = useCallback(() => {
    setFlying(null); selectMemory(null); setPlayback(null);
    disposePlaybackResources(); resetScreenScale(); hideScreen(); hideCone();
    screenOpacityRef.current = 0; beamStrengthRef.current = 0; lightDimRef.current = 1;
    beamActiveRef.current = false;
    screenFadeStartedRef.current = false;
    screenVigTintRef.current = null;
    screenFadeTweenRef.current?.kill();
    screenFadeTweenRef.current = null;
    setPhase("SHELF");
    const { pos, look } = marker.shelfFrame;
    cameraTarget.current.pos.copy(pos);
    cameraTarget.current.look.copy(look);
  }, [disposePlaybackResources, resetScreenScale, hideScreen, hideCone, marker.shelfFrame, selectMemory, setPhase, setPlayback]);

  /* ── Orb click → zoom ── */
  const onOrbClick = useCallback(
    (memory: Memory, idx: number) => {
      if (phase !== "SHELF") return;
      const slot = slotForIndex(idx);
      selectMemory(memory.id);
      setPhase("ZOOMED");
      const { pos: sp } = marker.shelfFrame;
      const zoomPos = sp.clone().lerp(slot, 0.6);
      cameraTarget.current.pos.copy(zoomPos);
      cameraTarget.current.look.copy(slot);
    },
    [marker.shelfFrame, phase, selectMemory, setPhase, slotForIndex]
  );

  /* ══════════════════════════════════════════════════
     startWatch: shelf → screen, full choreography
     ══════════════════════════════════════════════════ */
  const startWatch = useCallback(async () => {
    if (phase !== "ZOOMED" || !selectedMemoryId) return;
    const idx = Math.max(0, memories.findIndex((m) => m.id === selectedMemoryId));
    const memory = memories[idx];
    const slot = slotForIndex(idx);

    setPhase("TRANSITION");
    setFlying({ memory, pos: slot.clone() });
    screenOpacityRef.current = 0;
    beamStrengthRef.current = 0;
    lightDimRef.current = 1;
    beamActiveRef.current = false;
    screenFadeStartedRef.current = false;
    screenVigTintRef.current = null;
    screenFadeTweenRef.current?.kill();
    screenFadeTweenRef.current = null;
    hideScreen();
    hideCone();

    if (telegramId) {
      setLoadingPlayback(true);
      fetchPlayback(telegramId, selectedMemoryId, initData)
        .then((pb) => { setPlayback(pb); loadPlaybackTexture(pb); })
        .finally(() => setLoadingPlayback(false));
    }

    const tl = gsap.timeline();
    timelineRef.current = tl;

    const fShelf = marker.shelfFrame;
    const fTo0 = marker.camTo00Frame;
    const fTo1 = marker.camTo01Frame;
    const fTo2 = marker.camTo02Frame;
    const fMain = marker.camMainFrame;
    const p00 = marker.trajPos00 ?? slot.clone().add(new THREE.Vector3(0, 0.25, -1.2));
    const p01 = marker.trajPos01 ?? p00.clone().add(new THREE.Vector3(-0.5, 0, 0.4));
    const p02 = marker.trajPos02 ?? p01.clone().add(new THREE.Vector3(0, -1.2, 0.2));
    const pFin = marker.trajFinish ?? p02.clone().add(new THREE.Vector3(0, -2.0, 0));

    // 1) Cam: shelf → Camera_to_00 → Camera_to_01; шар: слот → pos_00 → pos_01
    tl.add(() => {
      animateCam([fShelf, fTo0, fTo1], CAM_SHELF_TO_02_SEC);
      animateOrb(slot, [p00, p01], CAM_SHELF_TO_02_SEC);
    }, 0);

    // 2) Шар: pos_01 → pos_02 → finish
    tl.add(() => {
      animateOrb(p01, [p02, pFin], ORB_DROP_DURATION);
    }, T_ORB_DROP_START);

    // 3) После паузы у «стола»: луч + экран; камера Camera_to_01 → to_02 → to_03
    const beamIn = { v: 0 };
    const revealIn = { v: 0 };
    const dimmer = { v: 1 };
    tl.add(() => {
      const memHex = COLOR_HEX[memory.color] ?? FALLBACK_VIGNETTE_HEX;
      screenVigTintRef.current = new THREE.Color(memHex);
      const vigTint = liftVignetteTint(memHex);
      adaptConeToScreen();
      showCone(vigTint);
      beamActiveRef.current = true;

      gsap.to(beamIn, {
        v: 0.45, duration: 0.6, ease: "power2.out",
        onUpdate: () => { beamStrengthRef.current = beamIn.v; },
      });

      gsap.to(revealIn, {
        v: 1, duration: 0.6, ease: "power2.out",
        onUpdate: () => {
          if (coneMatRef.current) coneMatRef.current.uniforms.uReveal.value = revealIn.v;
        },
      });

      gsap.to(dimmer, {
        v: LIGHT_DIM_FACTOR, duration: 0.8, ease: "power2.inOut",
        onUpdate: () => { lightDimRef.current = dimmer.v; },
      });

      aimSpotAtScreen();

      screenFadeTweenRef.current?.kill();
      screenFadeStartedRef.current = true;
      screenOpacityRef.current = 0;
      const fadeIn = { v: 0 };
      screenFadeTweenRef.current = gsap.to(fadeIn, {
        v: 1, duration: SCREEN_FADE_IN_SEC, ease: SCREEN_FADE_IN_EASE,
        onUpdate: () => { screenOpacityRef.current = fadeIn.v; },
      });

      const tex = playbackTexRef.current;
      if (tex) applyScreenTexture(tex, 0);
    }, T_BEAM_START);

    // 4) Камера: Camera_to_01 → Camera_to_02 → Camera_to_03 (стол/экран)
    tl.add(() => {
      animateCam([fTo1, fTo2, fMain], CAM_TO_MAIN_DURATION);
    }, T_CAM_TO_MAIN_START);

    // 5) Complete: hide flying orb, enter DESK
    tl.add(() => {
      screenOpacityRef.current = 1;
      beamActiveRef.current = false;
      screenFadeTweenRef.current = null;
      setFlying(null);
      setDeskMemoryId(memory.id);
      setPhase("DESK");
    }, T_DESK_ENTER);
  }, [
    adaptConeToScreen, applyScreenTexture, hideScreen, hideCone, showCone,
    initData, loadPlaybackTexture, marker, memories, phase, selectedMemoryId,
    setLoadingPlayback, setPhase, setPlayback, slotForIndex, telegramId,
  ]);

  /* ══════════════════════════════════════════════════
     backFromDesk: screen → shelf, reverse choreography
     ══════════════════════════════════════════════════ */
  const backFromDesk = useCallback(() => {
    if (phase !== "DESK" || !deskMemoryId) return;
    const idx = Math.max(0, memories.findIndex((m) => m.id === deskMemoryId));
    const memory = memories[idx];
    const slot = slotForIndex(idx);

    setPhase("TRANSITION");
    timelineRef.current?.kill();
    const tl = gsap.timeline();
    timelineRef.current = tl;

    const fMain = marker.camMainFrame;
    const fOut5 = marker.camOut05Frame;
    const fOut4 = marker.camOut04Frame;
    const fShelf = marker.shelfFrame;
    const pFin = marker.trajFinish ?? slot.clone();
    const p02 = marker.trajPos02 ?? pFin.clone();
    const p01 = marker.trajPos01 ?? p02.clone();
    const p00 = marker.trajPos00 ?? p01.clone();

    // 1) Fade out memory + beam + reveal reverse + restore lights (0.8s)
    const fadeOut = { v: 1 };
    const beamOut = { v: beamStrengthRef.current };
    const revealOut = { v: coneMatRef.current?.uniforms.uReveal.value ?? 1 };
    const lightRestore = { v: lightDimRef.current };
    tl.add(() => {
      gsap.to(fadeOut, {
        v: 0, duration: SCREEN_FADE_OUT_SEC, ease: SCREEN_FADE_OUT_EASE,
        onUpdate: () => { screenOpacityRef.current = fadeOut.v; },
      });
      gsap.to(beamOut, {
        v: 0, duration: SCREEN_FADE_OUT_SEC, ease: SCREEN_FADE_OUT_EASE,
        onUpdate: () => { beamStrengthRef.current = beamOut.v; },
      });
      gsap.to(revealOut, {
        v: 0, duration: SCREEN_FADE_OUT_SEC, ease: SCREEN_FADE_OUT_EASE,
        onUpdate: () => {
          if (coneMatRef.current) coneMatRef.current.uniforms.uReveal.value = revealOut.v;
        },
      });
      gsap.to(lightRestore, {
        v: 1, duration: 1.0, ease: "power2.inOut",
        onUpdate: () => { lightDimRef.current = lightRestore.v; },
      });
    }, 0);

    // 2) Скрыть экран/конус; шар с finish → pos_02 → pos_01 → pos_00 → слот; камера to_03 → out_05 → out_04 → полка
    tl.add(() => {
      setDeskMemoryId(null);
      screenFadeTweenRef.current?.kill();
      screenFadeTweenRef.current = null;
      screenVigTintRef.current = null;
      disposePlaybackResources(); resetScreenScale(); hideScreen(); hideCone();
      screenOpacityRef.current = 0;
      setFlying({ memory, pos: pFin.clone() });
      animateCam([fMain, fOut5, fOut4, fShelf], 1.8);
      animateOrb(pFin, [p02, p01, p00, slot], 1.8);
    }, 0.85);

    tl.add(() => {
      setFlying(null); selectMemory(null); setPlayback(null);
      setPhase("SHELF");
    }, 2.7);
  }, [
    deskMemoryId, disposePlaybackResources, hideScreen, hideCone, marker, memories, phase,
    resetScreenScale, selectMemory, setPhase, setPlayback, slotForIndex,
  ]);

  useEffect(() => {
    window.addEventListener("scene:watch", startWatch);
    window.addEventListener("scene:back", backFromDesk);
    return () => {
      window.removeEventListener("scene:watch", startWatch);
      window.removeEventListener("scene:back", backFromDesk);
    };
  }, [backFromDesk, startWatch]);

  const visibleMemories = memories.slice(0, Math.max(1, marker.slots.length));

  return (
    <>
      <CameraAspectSync />
      <ambientLight intensity={0.26} />
      <hemisphereLight intensity={0.12} color="#c8d2e8" groundColor="#2a2218" />
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
            previewUrl={null}
            isSelected={memory.id === selectedMemoryId}
            onClick={() => onOrbClick(memory, i)}
          />
        );
      })}

      {flying && (
        <MemoryOrb
          position={[flying.pos.x, flying.pos.y, flying.pos.z]}
          radius={ORB_RADIUS} color={flying.memory.color} orbIndex={0}
          previewUrl={null} isSelected
        />
      )}

      {!IOS_WEBGL_SAFE && (
        <EffectComposer
          multisampling={EFFECT_COMPOSER.multisampling}
          resolutionScale={EFFECT_COMPOSER.resolutionScale}
          enableNormalPass
          depthBuffer
        >
          <SSAO
            intensity={SSAO_CFG.intensity}
            samples={SSAO_CFG.samples}
            rings={SSAO_CFG.rings}
            radius={SSAO_CFG.radius}
            bias={SSAO_CFG.bias}
            luminanceInfluence={SSAO_CFG.luminanceInfluence}
            worldDistanceThreshold={SSAO_CFG.worldDistanceThreshold}
            worldDistanceFalloff={SSAO_CFG.worldDistanceFalloff}
            worldProximityThreshold={SSAO_CFG.worldProximityThreshold}
            worldProximityFalloff={SSAO_CFG.worldProximityFalloff}
            depthAwareUpsampling
          />
          <Bloom
            luminanceThreshold={BLOOM.luminanceThreshold}
            luminanceSmoothing={BLOOM.luminanceSmoothing}
            intensity={BLOOM.intensity}
            radius={BLOOM.radius}
            mipmapBlur={BLOOM.mipmapBlur}
          />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      shadows={{ type: THREE.PCFSoftShadowMap }}
      camera={{ position: [0, 2, 8], fov: 45, near: 0.01, far: 500 }}
      gl={{
        antialias: true,
        powerPreference: IOS_WEBGL_SAFE ? "default" : "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.82,
      }}
      dpr={IOS_WEBGL_SAFE ? [1, 1] : [1, 2]}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}

useGLTF.preload(SCENE_MODEL_URL);
