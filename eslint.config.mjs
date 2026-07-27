import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  eslintConfigPrettier,
  {
    // Build output, and one-off developer setup scripts (Node CLIs under
    // scripts/, e.g. the Google token minter/verifier). Those are not part of
    // the Next.js app and idiomatically use patterns — ternary-as-statement
    // reporting, top-level await — that the app config flags as noise.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "scripts/**"],
  },
];

export default eslintConfig;
