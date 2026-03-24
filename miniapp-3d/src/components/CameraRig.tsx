/**
 * CameraRig – единая система управления камерой.
 *
 * Принцип работы:
 *  - `camTarget.pos` и `camTarget.look` — мутируемые векторы-цели
 *  - GSAP анимирует эти векторы (просто числа)
 *  - `CameraController` в `useFrame` плавно lerp-ит камеру к целям каждый кадр
 *
 * Это исключает конфликты между GSAP и R3F render loop.
 */
import { useRef } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import gsap from "gsap";

// ─── Глобальные цели камеры (мутируются через GSAP) ─────────────────────────
export const camTarget = {
  pos: new THREE.Vector3(0, 2.5, 10),
  look: new THREE.Vector3(0, 1.8, 0),
};

// ─── Именованные позиции ────────────────────────────────────────────────────
export const CAM_SHELF_POS: [number, number, number] = [0, 2.5, 10];
export const CAM_SHELF_LOOK: [number, number, number] = [0, 1.8, 0];
export const CAM_DESK_POS: [number, number, number] = [0, 3.5, 2.5];
export const CAM_DESK_LOOK: [number, number, number] = [0, 3.5, -10];

// ─── CameraController – монтируется внутри Canvas ───────────────────────────
export function CameraController() {
  const { camera } = useThree();
  const currentLook = useRef(new THREE.Vector3(...CAM_SHELF_LOOK));

  useFrame((_, delta) => {
    // Экспоненциальный lerp, независимый от частоты кадров
    const alpha = 1 - Math.exp(-5 * delta);
    camera.position.lerp(camTarget.pos, alpha);
    currentLook.current.lerp(camTarget.look, alpha);
    camera.lookAt(currentLook.current);
  });

  return null;
}

// ─── Helpers для переключения камеры ────────────────────────────────────────
export function camToShelf(duration = 1.6) {
  const [x, y, z] = CAM_SHELF_POS;
  const [lx, ly, lz] = CAM_SHELF_LOOK;
  return Promise.all([
    new Promise<void>((res) =>
      gsap.to(camTarget.pos, { x, y, z, duration, ease: "power2.inOut", onComplete: res })
    ),
    new Promise<void>((res) =>
      gsap.to(camTarget.look, { x: lx, y: ly, z: lz, duration, ease: "power2.inOut", onComplete: res })
    ),
  ]);
}

export function camToOrb(orbPos: THREE.Vector3, duration = 0.85) {
  // Камера встаёт чуть ниже и перед шаром
  const tx = orbPos.x * 0.35;
  const ty = orbPos.y + 0.6;
  const tz = orbPos.z + 3.8;
  return Promise.all([
    new Promise<void>((res) =>
      gsap.to(camTarget.pos, { x: tx, y: ty, z: tz, duration, ease: "power2.out", onComplete: res })
    ),
    new Promise<void>((res) =>
      gsap.to(camTarget.look, { x: orbPos.x, y: orbPos.y, z: orbPos.z, duration, ease: "power2.out", onComplete: res })
    ),
  ]);
}

export function camToDesk(duration = 1.8) {
  const [x, y, z] = CAM_DESK_POS;
  const [lx, ly, lz] = CAM_DESK_LOOK;
  return Promise.all([
    new Promise<void>((res) =>
      gsap.to(camTarget.pos, { x, y, z, duration, ease: "power3.inOut", onComplete: res })
    ),
    new Promise<void>((res) =>
      gsap.to(camTarget.look, { x: lx, y: ly, z: lz, duration, ease: "power3.inOut", onComplete: res })
    ),
  ]);
}
