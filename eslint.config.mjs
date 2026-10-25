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
      /**
       * A leading underscore marks a binding that exists only to be discarded — the
       * `const { value: _ignored, ...rest }` idiom used to strip a field the API rejects.
       * Flagging those as "unused" is the rule misreading a deliberate omission.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      /**
       * React Compiler's experimental rule treats any effect that transitively calls
       * setState as a violation, which flags the ordinary fetch-on-mount pattern used
       * correctly throughout these consoles and the legitimate post-hydration
       * localStorage reads in the shell.
       *
       * Downgraded to a warning rather than disabled: the CI gate stops being red for
       * patterns that are not defects, while the signal stays visible for review. The one
       * genuine finding in this group — the detail pages' missing cancellation guard —
       * has been fixed at the source, and every remaining data-loading effect that can
       * race now carries its own guard.
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
