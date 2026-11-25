import solid from "@solidjs/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { build, type Plugin } from "vite"
import { defineConfig } from "vitest/config"
import { version } from "./server/version.ts"

/**
 * Builds the service worker once the app is on disk: a second, small build of `ui/src/sw.ts` into one
 * self-contained /sw.js beside the page. It hands the worker the list of the app shell's files (the
 * page and everything under /assets) and a hash over their contents, so /sw.js changes whenever the
 * app does. Files from `ui/public` are not part of the shell.
 */
function serviceWorker(): Plugin {
  let root: string
  return {
    name: "print-buddy:service-worker",
    apply: "build",
    configResolved(config) { root = config.root },
    async writeBundle(options, bundle) {
      const hash = createHash("sha256")
      const files: string[] = []
      for (const name of Object.keys(bundle).sort()) {
        const output = bundle[name]!
        hash.update(name).update(output.type === "chunk" ? output.code : output.source)
        files.push(name === "index.html" ? "/" : `/${name}`)
      }
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: "warn",
        define: { __APP_SHELL__: JSON.stringify({ hash: hash.digest("hex").slice(0, 16), files }) },
        build: {
          outDir: options.dir,
          emptyOutDir: false,
          rolldownOptions: { input: join(root, "src/sw.ts"), output: { format: "iife", entryFileNames: "sw.js" } },
        },
      })
    },
  }
}

export default defineConfig({
  root: "ui",
  plugins: [solid(), tailwindcss(), serviceWorker()],
  // the version of the add-on config, built into the page so it names the app that actually runs, also from the cache
  define: { __APP_VERSION__: JSON.stringify(version) },
  // pdf.js is most of the main chunk, hence the higher limit for Vite's size warning
  build: { outDir: "../dist/ui", emptyOutDir: true, chunkSizeWarningLimit: 700 },
  server: { proxy: { "/api": "http://127.0.0.1:9217" } },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/testing/setup.ts"],
  },
})
