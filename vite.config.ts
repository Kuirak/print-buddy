import solid from "@solidjs/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: "ui",
  plugins: [solid(), tailwindcss()],
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:9217" } },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/testing/setup.ts"],
  },
})
