import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolves the "@/..." path alias (mirrors tsconfig paths) so tests can
// import application modules exactly as the app does, and stubs the
// `server-only` guard so server modules are unit-testable.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "tests/**/*.test.ts",
      // Dependency-free mobile modules. They import by relative path, never
      // through "@", because that alias resolves to the WEB root here and to
      // the mobile root inside the Expo project.
      "mobile/lib/**/*.test.ts",
    ],
  },
});
