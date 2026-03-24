/**
 * CameraRig – wraps all camera animation logic.
 * We store a ref to the camera, expose `flyTo` and `orbitTo` helpers
 * that other components trigger via GSAP.
 *
 * All camera positions are in world-space:
 *   Shelf view:  position [0, 0, 9],  lookAt [0, 0, 0]
 *   Zoomed view: position close to clicked orb, lookAt orb
 *   Desk view:   position [6, 2, 9],  lookAt [6, 0, 0]
 */
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { useStore } from "../store/useStore";

export const SHELF_CAM: [number, number, number] = [0, 0.5, 11];
export const DESK_CAM: [number, number, number] = [5.5, 1.5, 10];

export const SHELF_LOOK: [number, number, number] = [0, 0, 0];
export const DESK_LOOK: [number, number, number] = [5, 0.5, 0];

export function useCameraRig() {
  const { camera } = useThree();
  const lookAtTarget = useRef(new THREE.Vector3(...SHELF_LOOK));

  // Continuously apply lookAt from our animated ref vector
  // (R3F updates camera.matrixWorldNeedsUpdate each frame)
  useEffect(() => {
    const id = setInterval(() => {
      camera.lookAt(lookAtTarget.current);
      camera.updateProjectionMatrix();
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [camera]);

  function flyToShelf(duration = 1.6) {
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(camera.position, {
          x: SHELF_CAM[0], y: SHELF_CAM[1], z: SHELF_CAM[2],
          duration,
          ease: "power3.inOut",
        })
        .to(
          lookAtTarget.current,
          { x: SHELF_LOOK[0], y: SHELF_LOOK[1], z: SHELF_LOOK[2], duration, ease: "power3.inOut" },
          "<"
        );
    });
  }

  function flyToOrb(orbPos: THREE.Vector3, duration = 1.0) {
    // Camera stops 2.8 units in front of the orb
    const offset = new THREE.Vector3(0, 0.2, 3.2);
    const dest = orbPos.clone().add(offset);
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(camera.position, {
          x: dest.x, y: dest.y, z: dest.z,
          duration,
          ease: "power2.inOut",
        })
        .to(
          lookAtTarget.current,
          { x: orbPos.x, y: orbPos.y, z: orbPos.z, duration, ease: "power2.inOut" },
          "<"
        );
    });
  }

  function flyToDesk(duration = 1.8) {
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(camera.position, {
          x: DESK_CAM[0], y: DESK_CAM[1], z: DESK_CAM[2],
          duration,
          ease: "power3.inOut",
        })
        .to(
          lookAtTarget.current,
          { x: DESK_LOOK[0], y: DESK_LOOK[1], z: DESK_LOOK[2], duration, ease: "power3.inOut" },
          "<"
        );
    });
  }

  return { camera, lookAtTarget, flyToShelf, flyToOrb, flyToDesk };
}

/** Initializes camera position on mount */
export function CameraInit() {
  const { camera } = useThree();
  const phase = useStore((s) => s.phase);

  useEffect(() => {
    if (phase === "LOADING") {
      camera.position.set(...SHELF_CAM);
      camera.lookAt(...SHELF_LOOK);
    }
  }, [camera, phase]);

  return null;
}
