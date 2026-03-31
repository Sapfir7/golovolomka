import { EffectComposer, Vignette } from "@react-three/postprocessing";
import { useStore } from "../store/useStore";

/** Лёгкая виньетка только в фазе просмотра у проектора (без лишнего multisampling). */
export function DeskVignette() {
  const phase = useStore((s) => s.phase);
  if (phase !== "DESK") return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Vignette eskil={false} offset={0.5} darkness={0.18} />
    </EffectComposer>
  );
}
