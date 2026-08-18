import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Clean Architecture boundary: presentation (components/, and app/ outside
  // of its API routes) may depend on domain/* and on a use-case's public
  // entry point, but never reach directly into infrastructure/* or into an
  // application/* module's internals. Route handlers under app/api/** are
  // exempt — they are the layer allowed to wire in real use-cases/adapters.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**", "@/infrastructure/*"],
              message:
                "Presentation code may not import infrastructure adapters directly — depend on a domain policy or a use-case's public entry point instead.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
