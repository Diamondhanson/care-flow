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
  {
    rules: {
      // CareFlow deliberately uses the SSR mount-guard convention
      // (`useEffect(() => setMounted(true), [])`) across every theme- and
      // locale-aware client component — see CLAUDE.md, which *requires* a
      // mount check to keep server/client markup identical until hydration.
      // The React-Compiler-era `set-state-in-effect` rule flags this pattern
      // as an error, but here it is an intentional, correctness-preserving
      // idiom (not a cascading-render bug). Keep it visible as a warning so
      // genuinely new misuse still surfaces in review, without failing lint
      // on the established hydration guards.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
