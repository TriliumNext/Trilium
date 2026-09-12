// @ts-check

import { defineConfig, globalIgnores } from 'eslint/config';
import tsParser from "@typescript-eslint/parser";
import stylistic from "@stylistic/eslint-plugin";

// eslint config just for formatting rules
// potentially to be merged with the linting rules into one single config,
// once we have fixed the majority of lint errors

// Go to https://eslint.style/rules/default/${rule_without_prefix} to check the rule details
export const stylisticRules = {
    "@stylistic/indent": ["error", 4],
    "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/quote-props": ["error", "consistent-as-needed"],
    "@stylistic/max-len": ["error", { code: 100 }],
    "@stylistic/comma-dangle": ["error", "never"],
    "@stylistic/linebreak-style": ["error", "unix"],
    "@stylistic/array-bracket-spacing": ["error", "always"],
    "@stylistic/object-curly-spacing": ["error", "always"],
    "@stylistic/padded-blocks": ["error", { classes: "always" }]
};

export default defineConfig(
    globalIgnores([
        ".cache",
        "tmp",
        "**/dist",
        "**/out-tsc",
        "apps/edit-docs/demo/*",
        "docs/*",
        "apps/web-clipper/lib/*",
        // Build output that is gitignored but sits outside a `dist`, so it would otherwise be
        // linted. `cap sync` copies the whole standalone bundle into the native projects, which
        // adds ~165 MB of minified JS and makes ESLint run out of memory.
        "apps/mobile/android/**",
        "apps/mobile/ios/**",
        "apps/*/out/**",
        "apps/web-clipper/.output/**",
        "site/**",
        "**/test-output/**",
        "apps/web-clipper/.wxt/**",
        // Vendored third-party code. `--fix` must never touch these: the pdf.js viewer is
        // re-vendored verbatim from an upstream release, and `update-viewer.ts` locates our
        // patches by matching upstream markup.
        "packages/pdfjs-viewer/viewer/**",
        "packages/splitjs/test/lib/**",
        // A worktree here is a full second copy of the repository.
        ".claude/worktrees/**"
    ]),

    {
        files: ["**/*.{js,ts,mjs,cjs}"],

        languageOptions: {
            parser: tsParser
        },

        plugins: {
            "@stylistic": stylistic
        },

        rules: {
            ...stylisticRules
        }
    }
);