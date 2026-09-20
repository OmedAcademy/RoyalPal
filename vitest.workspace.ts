import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = fileURLToPath(new URL("./mobile", import.meta.url));

/**
 * Two projects, because "@" means two different things in this repository:
 * the web root for Next.js, the Expo app's own root inside `mobile/`. A single
 * config can only resolve it one way, which is why mobile code was untestable
 * and why its bugs were the ones found by reading rather than by running.
 *
 * `npx vitest run` covers both. Naming them makes a single-project run
 * possible with `--project web` or `--project mobile`.
 */
export default defineWorkspace([
  "./vitest.config.ts",
  {
    resolve: {
      alias: { "@": MOBILE_ROOT },
    },
    test: {
      name: "mobile",
      root: MOBILE_ROOT,
      environment: "node",
      // Screens need a renderer; these are the modules behind them.
      include: ["lib/**/*.test.ts"],
    },
  },
]);
