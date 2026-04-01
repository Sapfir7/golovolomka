import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { useStore } from "../store/useStore";
import { OrbColorVignetteEffect } from "../effects/orbColorVignetteEffect";
import { COLOR_HEX } from "../memoryPalette";

const OrbColorVignette = wrapEffect(OrbColorVignetteEffect);

/** Виньетка в фазе проектора: затемнение к краям в оттенке цвета шара воспоминания. */
export function DeskVignette() {
  const phase = useStore((s) => s.phase);
  const deskOrbTint = useStore((s) => s.deskOrbTint);

  if (phase !== "DESK") return null;

  const tint = deskOrbTint ? COLOR_HEX[deskOrbTint] : "#261a32";

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <OrbColorVignette tint={tint} uRadius={0.62} uSoftness={0.52} uStrength={0.73} />
    </EffectComposer>
  );
}
