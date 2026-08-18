import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // Ad-hoc end-to-end smoke scripts (see CLAUDE.md). They walk untyped JSON
    // straight off the API and assert on values at runtime, so `any` on a
    // response body is the honest type rather than a shortcut. Scoped to these
    // files only - application code stays strict.
    files: ["verify-*.ts", "db/copy-to-supabase.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
