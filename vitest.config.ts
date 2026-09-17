import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Same alias as vite.config.ts so tests can import client-code paths if needed.
      "@": path.resolve(here, "./src/client"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Miniflare keeps its own module registry; only the code under test is transformed.
    pool: "forks",
    testTimeout: 30_000,
  },
});
