import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "src-tauri/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
