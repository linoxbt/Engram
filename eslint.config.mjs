/**
 * Lint rules for real bugs only, not style. `tsc` already covers types and Next 16 dropped `next lint`, so the gap
 * this fills is what the compiler cannot see: promises nobody awaits, React hooks with stale dependencies, and
 * dead bindings. Everything stylistic stays out on purpose — a thousand formatting errors would train us to ignore
 * the output. The type-aware rules find each file's tsconfig through typescript-eslint's project service.
 */
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** The bug rules, applied to every TypeScript file; the type-aware ones need `projectService`. */
const typedRules = {
  // react-query's invalidateQueries is fire-and-forget by design (it resolves when refetching finishes, which no
  // caller waits for), so allow it by name instead of sprinkling `void` over every mutation callback.
  "@typescript-eslint/no-floating-promises": ["error", { allowForKnownSafeCalls: [{ from: "package", name: "invalidateQueries", package: "@tanstack/query-core" }] }],
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/.next/**", "**/out/**", "**/build/**",
      "apps/web/test-results/**", "apps/web/playwright-report/**", "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      // recommendedTypeChecked brings a lot of noise about `any` and unsafe member access; the compiler is the
      // gate for types. Only the rules that catch behaviour the compiler accepts stay on.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-duplicate-type-constituents": "off",
      // `throw e` where e is `unknown` (rethrowing a caught error) is correct here, not a bug.
      "@typescript-eslint/only-throw-error": "off",
      // Appwrite types several free-form status strings as enums; comparing them to a literal is intended.
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Several regexes strip control characters on purpose, and `let x = <default>; try { x = … } catch {}` is
      // the house style for a parse with a fallback. Neither is a bug.
      "no-control-regex": "off",
      "no-useless-assignment": "off",
      ...typedRules,
    },
  },
  {
    // Client components: the hooks rules are the whole reason this config exists.
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Plain .mjs build and config files are outside every tsconfig, so the type-aware rules cannot run on them.
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false, project: false } },
    // These run under Node with no `globals` package to describe its globals; `tsc` is the gate for undefined names.
    rules: { "no-undef": "off", "@typescript-eslint/no-unused-vars": typedRules["@typescript-eslint/no-unused-vars"] },
  },
  {
    // Tests and one-shot scripts hand async callbacks to helpers that ignore the return value on purpose.
    files: ["**/test/**", "**/*.test.ts", "scripts/**", "apps/web/e2e/**"],
    rules: { "@typescript-eslint/no-misused-promises": "off" },
  },
);
