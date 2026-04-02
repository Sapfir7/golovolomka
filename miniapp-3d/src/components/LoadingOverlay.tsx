import { useState, useEffect } from "react";
import { useStore } from "../store/useStore";

export function LoadingOverlay() {
  const phase = useStore((s) => s.phase);
  const glbReady = useStore((s) => s.glbReady);
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  const blocking = phase === "LOADING" || !glbReady;

  useEffect(() => {
    if (!blocking) {
      setFading(true);
      const timer = setTimeout(() => setVisible(false), 600);
      return () => clearTimeout(timer);
    }
    setVisible(true);
    setFading(false);
  }, [blocking]);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black"
      style={{
        transition: "opacity 0.55s ease-out",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="loading-spinner" />
        <p className="text-white/60 text-sm tracking-wide">Загрузка…</p>
      </div>
    </div>
  );
}
