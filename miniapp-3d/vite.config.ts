import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/miniapp-3d/",
  build: {
    outDir: "../miniapp-3d-dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-three": ["three"],
          "vendor-r3f": ["@react-three/fiber", "@react-three/drei"],
          "vendor-pp": ["@react-three/postprocessing", "postprocessing"],
          "vendor-gsap": ["gsap"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
