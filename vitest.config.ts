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
    // Every DB suite spins a Miniflare/workerd instance and re-applies the
    // schema in `beforeEach`. At full parallelism that start-up regularly
    // exceeds Vitest's 10 s default and fails the hook rather than a test, so
    // give hooks the same budget as the tests they set up.
    hookTimeout: 30_000,
  },
});
