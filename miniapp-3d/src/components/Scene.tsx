import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";
import { MemoryOrb } from "./MemoryOrb";
import type { Memory, Playback } from "../types";
import { COLOR_HEX } from "../memoryPalette";
import { createErkanProjectionMaterial } from "../materials/erkanProjectionMaterial";
import { createConeBeamMaterial } from "../materials/coneBeamMaterial";
import { fetchPlayback } from "../api/client";

const SCENE_MODEL_URL = `${import.meta.env.BASE_URL}temp_krik2.glb`;
const ORB_RADIUS = 0.1125;
const NUM_SLOTS = 5;

const SCREEN_UV_ROTATION = -Math.PI / 2;
const SCREEN_MIRROR_X = true;

const SPOT_BASE_INTENSITY = 12;
const LIGHT_DIM_FACTOR = 0.35;
const VIGNETTE_EXPAND = 2.2;

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

function SceneContent() {
  const { camera } = useThree();
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

    const slots = Array.from({ length: NUM_SLOTS }, (_, i) =>
      wp(`Slot${String(i).padStart(2, "0")}`) ?? fb(5.097 - i * 0.27, 1.545, 0.75)
    );

    const screenObj = model.getObjectByName("screen") ?? null;
    const screenCenter = (() => {
      if (!screenObj) return fb(-7.7, 2.44, -3.72);
      const box = new THREE.Box3().setFromObject(screenObj);
      return box.isEmpty() ? fb(-7.7, 2.44, -3.72) : box.getCenter(new THREE.Vector3());
    })();

    const camShelf = findCam(model, "Camera_shkaf_00");
    const camMain = findCam(model, "Camera");
    const shelfFrame = camShelf ? camFrame(camShelf) : { pos: fb(4.68, 1.09, -3.3), look: fb(4.55, 1.09, 0.75) };

    const cam01 = findCam(model, "Camera_01");
    const cam02 = findCam(model, "Camera_02");
    const cam03 = findCam(model, "Camera_03");
    const cam04 = findCam(model, "Camera_04");

    return {
      slots,
      screenObj,
      screenCenter,
      screenBaseScale: screenObj?.scale.clone() ?? fb(1, 1, 1),
      shelfFrame,
      cam01Frame: cam01 ? camFrame(cam01) : null,
      cam02Frame: cam02 ? camFrame(cam02) : null,
      cam03Frame: cam03 ? camFrame(cam03) : null,
      cam04Frame: cam04 ? camFrame(cam04) : null,
      camMainFrame: camMain ? camFrame(camMain) : { pos: fb(2.18, 1.68, -3.59), look: screenCenter.clone() },
      camShelf,
      traj00: wp("trajectory_00"),
      traj01: wp("trajectory_01"),
      traj02: wp("trajectory_02"),
      traj03: wp("trajectory_03"),
      traj04: wp("trajectory_04"),
      roomCenter: slots.reduce((a, s) => a.add(s), new THREE.Vector3()).multiplyScalar(1 / slots.length),
    };
  }, [model]);

  /* ── Lights ── */
  useEffect(() => {
    const POINT_BASE = 8;
    const POINT005 = 14;
    const collected: { light: THREE.Light; base: number }[] = [];

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false; m.receiveShadow = false;
        const stdMat = m.material;
        if (stdMat instanceof THREE.MeshStandardMaterial) {
          stdMat.roughness = Math.min(stdMat.roughness + 0.12, 1.0);
          stdMat.envMapIntensity = 0.6;
        }
      }
      const light = o as THREE.Light;
      if (!light.isLight) return;
      light.castShadow = false;

      if ((light as THREE.PointLight).isPointLight) {
        const inten = (o.name === "Point.005" || o.name === "Point005") ? POINT005 : POINT_BASE;
        light.intensity = inten;
        collected.push({ light, base: inten });
      }
      if ((light as THREE.SpotLight).isSpotLight) {
        if (o.name === "Spot_screen" || o.name === "Spot.001") {
          spotScreenRef.current = light as THREE.SpotLight;
          light.intensity = SPOT_BASE_INTENSITY;
          collected.push({ light, base: SPOT_BASE_INTENSITY });
        } else {
          light.intensity = 12;
          collected.push({ light, base: 12 });
        }
      }
      if ((light as THREE.DirectionalLight).isDirectionalLight) {
        light.intensity = 0.6;
        collected.push({ light, base: 0.6 });
      }
    });

    sceneLightsRef.current = collected;

    const hideNames = new Set([
      "trajectory_00", "trajectory_01", "trajectory_02",
      "trajectory_03", "trajectory_04", "Conus_light",
    ]);
    model.traverse((o) => { if (hideNames.has(o.name)) o.visible = false; });

    const conusNode = model.getObjectByName("Conus_light");
    if (conusNode) {
      coneOrigScaleRef.current = conusNode.scale.clone();
      conusNode.traverse((ch) => {
        const mesh = ch as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          coneMeshRef.current = mesh;
          const mat = createConeBeamMaterial(mesh.geometry, { color: "#fff6e0", strength: 0 });
          coneMatRef.current = mat;
          mesh.material = mat;
        }
      });
    }
  }, [model]);

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
    const conusNode = model.getObjectByName("Conus_light");
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
        const vigTint = new THREE.Color(deskOrbTint ? COLOR_HEX[deskOrbTint] : "#261a32");
        const mat = createErkanProjectionMaterial(texture, {
          vignetteTint: vigTint, vignetteStrength: 0.72,
          uvRotation: SCREEN_UV_ROTATION, mirrorX: SCREEN_MIRROR_X,
          colorMix: 0.3,
          texScale: 1 / VIGNETTE_EXPAND,
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
    const conusNode = model.getObjectByName("Conus_light");
    if (conusNode) conusNode.visible = true;
    if (color && coneMatRef.current) {
      coneMatRef.current.uniforms.uColor.value.copy(color);
    }
  }, [model]);

  const hideCone = useCallback(() => {
    const conusNode = model.getObjectByName("Conus_light");
    if (conusNode) conusNode.visible = false;
    beamStrengthRef.current = 0;
    if (coneMatRef.current) {
      coneMatRef.current.uniforms.uStrength.value = 0;
      coneMatRef.current.uniforms.uReveal.value = 0;
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
    if (mat && mat.uniforms.uTime) mat.uniforms.uTime.value += delta;

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
    if (playbackTexture) applyScreenTexture(playbackTexture, screenOpacityRef.current);
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

    const f01 = marker.cam01Frame ?? marker.shelfFrame;
    const f02 = marker.cam02Frame ?? marker.camMainFrame;
    const f03 = marker.cam03Frame ?? marker.camMainFrame;
    const fMain = marker.camMainFrame;
    const t00 = marker.traj00 ?? slot.clone().add(new THREE.Vector3(0, 0.3, -2));
    const t01 = marker.traj01 ?? fMain.pos.clone().add(new THREE.Vector3(2, 0.5, 0));
    const t02 = marker.traj02 ?? t01.clone().add(new THREE.Vector3(0, -1.2, 0));

    // 1) Cam: shelf → Camera_01 → Camera_02, Orb: slot → traj00 → traj01 (1.8s)
    tl.add(() => {
      animateCam([marker.shelfFrame, f01, f02], 1.8);
      animateOrb(slot, [t00, t01], 1.8);
    }, 0);

    // 2) Orb descends traj01 → traj02 (0.7s)
    tl.add(() => {
      animateOrb(t01, [t02], 0.7);
    }, 1.8);

    // 3) 0.4s pause: beam reveals tip→base, memory fades in, lights dim
    const beamIn = { v: 0 };
    const revealIn = { v: 0 };
    const dimmer = { v: 1 };
    tl.add(() => {
      const vigTint = new THREE.Color(COLOR_HEX[memory.color] ?? "#261a32");
      adaptConeToScreen();
      showCone(vigTint);

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

      const tex = playbackTexRef.current;
      if (tex) applyScreenTexture(tex, 0);
      const fadeIn = { v: 0 };
      gsap.to(fadeIn, {
        v: 1, duration: 0.7, ease: "power2.out",
        onUpdate: () => { screenOpacityRef.current = fadeIn.v; },
      });
    }, 2.5);

    // 4) Camera: Cam02 → Cam03 → CamMain (1.6s, starts after 0.4s pause)
    tl.add(() => {
      animateCam([f02, f03, fMain], 1.6);
    }, 2.9);

    // 5) Complete: hide flying orb, enter DESK
    tl.add(() => {
      screenOpacityRef.current = 1;
      setFlying(null);
      setDeskMemoryId(memory.id);
      setPhase("DESK");
    }, 4.5);
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

    const f04 = marker.cam04Frame ?? marker.shelfFrame;
    const t03 = marker.traj03 ?? marker.camMainFrame.pos.clone().add(new THREE.Vector3(2, 0, 0));
    const t04 = marker.traj04 ?? slot.clone().add(new THREE.Vector3(0, 0.3, -2));

    // 1) Fade out memory + beam + reveal reverse + restore lights (0.8s)
    const fadeOut = { v: 1 };
    const beamOut = { v: beamStrengthRef.current };
    const revealOut = { v: coneMatRef.current?.uniforms.uReveal.value ?? 1 };
    const lightRestore = { v: lightDimRef.current };
    tl.add(() => {
      gsap.to(fadeOut, {
        v: 0, duration: 0.8, ease: "power2.out",
        onUpdate: () => { screenOpacityRef.current = fadeOut.v; },
      });
      gsap.to(beamOut, {
        v: 0, duration: 0.8, ease: "power2.out",
        onUpdate: () => { beamStrengthRef.current = beamOut.v; },
      });
      gsap.to(revealOut, {
        v: 0, duration: 0.8, ease: "power2.out",
        onUpdate: () => {
          if (coneMatRef.current) coneMatRef.current.uniforms.uReveal.value = revealOut.v;
        },
      });
      gsap.to(lightRestore, {
        v: 1, duration: 1.0, ease: "power2.inOut",
        onUpdate: () => { lightDimRef.current = lightRestore.v; },
      });
    }, 0);

    // 2) Once faded: hide screen + cone, orb at traj_03, cam+orb fly home (1.8s)
    tl.add(() => {
      setDeskMemoryId(null);
      disposePlaybackResources(); resetScreenScale(); hideScreen(); hideCone();
      screenOpacityRef.current = 0;
      setFlying({ memory, pos: t03.clone() });
      animateCam([marker.camMainFrame, f04, marker.shelfFrame], 1.8);
      animateOrb(t03, [t04, slot], 1.8);
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

  const visibleMemories = memories.slice(0, marker.slots.length || NUM_SLOTS);

  return (
    <>
      <CameraAspectSync />
      <ambientLight intensity={0.18} />
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

      {flying && (
        <MemoryOrb
          position={[flying.pos.x, flying.pos.y, flying.pos.z]}
          radius={ORB_RADIUS} color={flying.memory.color} orbIndex={0}
          previewUrl={flying.memory.previewUrl} isSelected isTransitioning
        />
      )}
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 2, 8], fov: 45, near: 0.01, far: 500 }}
      gl={{
        antialias: true, powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.88,
      }}
      dpr={[1, 1.75]}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}><SceneContent /></Suspense>
    </Canvas>
  );
}

useGLTF.preload(SCENE_MODEL_URL);
