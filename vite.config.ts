import solid from "@solidjs/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: "ui",
  plugins: [solid(), tailwindcss()],
  // pdf.js is most of the main chunk, hence the higher limit for Vite's size warning
  build: { outDir: "../dist/ui", emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": "http://127.0.0.1:9217" } },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/testing/setup.ts"],
  },
})
