import path from "path";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json";

/**
 * Offline service worker build.
 *
 * The SW (`src/client/offline/sw.ts`) IS the backend in desktop mode: it runs
 * the real Hono server in-worker over a sql.js database. It builds alongside
 * the app as `dist/sw.js`; the precache manifest (index.html + hashed assets)
 * is injected into the emitted sw.js after the bundle is known.
 */
function offlineSwPlugin(): Plugin {
  return {
    name: "offline-sw",
    apply: "build",
    enforce: "post",
    // closeBundle runs after ALL outputs are emitted, so the manifest sees the
    // full asset list (generateBundle fires per-entry and would race).
    closeBundle() {
      const swPath = path.resolve(__dirname, "dist/sw.js");
      let swCode: string;
      try {
        swCode = readFileSync(swPath, "utf8");
      } catch {
        return; // sw not built (dev/test)
      }
      // Copy the sql.js wasm binary next to sw.js — the adapter's locateFile
      // fetches /sql-wasm.wasm, and the precache manifest below makes it
      // available with zero network.
      const wasmSrc = path.resolve(__dirname, "node_modules/sql.js/dist/sql-wasm.wasm");
      const wasmDst = path.resolve(__dirname, "dist/sql-wasm.wasm");
      try {
        writeFileSync(wasmDst, readFileSync(wasmSrc));
      } catch {
        // Not fatal — first offline boot without wasm degrades to an error
        // screen, but a normal install always has the module.
      }
      const dir = path.resolve(__dirname, "dist");
      const walk = (rel: string): string[] => {
        const abs = path.join(dir, rel);
        const out: string[] = [];
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) out.push(...walk(relPath));
          // index.html is added explicitly; the sql wasm must be precached.
          else if (relPath !== "index.html") out.push(`/${relPath}`);
        }
        return out;
      };
      const assets = walk("").filter((n) => n !== "/sw.js");
      const manifest = ["/index.html", ...assets];
      // The minifier renames the import — match any `x=["/index.html"]` and
      // keep the same identifier name via the capture.
      swCode = swCode.replace(
        /(\w+)=\["\/index\.html"\]/,
        (_m, id: string) => `${id}=${JSON.stringify(manifest)}`,
      );
      writeFileSync(swPath, swCode);
    },
  };
}

export default defineConfig(({ mode }) => {
  const common = {
    define: {
      // Injected at build time so the UI can show the running app version.
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
  };
  // The service worker is built as its own pass with inlineDynamicImports: the
  // SW must be one self-contained file (code-split chunks share the app's
  // preload helper, which touches `document` and cannot run in a worker).
  if (mode === "sw") {
    return {
      ...common,
      plugins: [offlineSwPlugin()],
      build: {
        outDir: "dist",
        emptyOutDir: false,
        target: "esnext",
        rollupOptions: {
          input: { sw: path.resolve(__dirname, "src/client/offline/sw-entry.ts") },
          output: {
            format: "es",
            entryFileNames: "sw.js",
            inlineDynamicImports: true,
          },
        },
      },
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src/client"),
          "virtual:offline-shell-assets": path.resolve(__dirname, ".offline-shell-assets.ts"),
        },
      },
    };
  }
  return {
  ...common,
  plugins: [react(), tailwindcss(), offlineSwPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Explicit both-entries input: index.html (app) + sw (offline backend).
        index: path.resolve(__dirname, "index.html"),
        sw: path.resolve(__dirname, "src/client/offline/sw-entry.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      // Virtual module for the precache manifest (stub on disk; rewritten in
      // the emitted sw.js by the plugin above).
      "virtual:offline-shell-assets": path.resolve(__dirname, ".offline-shell-assets.ts"),
    },
  },
    server: {
      port: 5173,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
