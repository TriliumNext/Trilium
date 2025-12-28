// @ts-check

import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import simpleImportSort from "eslint-plugin-simple-import-sort";
import playwright from "eslint-plugin-playwright";
import tsParser from "@typescript-eslint/parser";
import preact from "eslint-config-preact";
import stylistic from "@stylistic/eslint-plugin";

// Go to https://eslint.style/rules/default/${rule_without_prefix} to check the rule details
export const stylisticRules = {
    "@stylistic/indent": ["error", 4],
    // "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
    "@stylistic/semi": ["error", "always"],
    // "@stylistic/quote-props": ["error", "consistent-as-needed"],
    // "@stylistic/max-len": ["error", { code: 100 }],
    // "@stylistic/comma-dangle": ["error", "never"],
    // "@stylistic/linebreak-style": ["error", "unix"],
    // "@stylistic/array-bracket-spacing": ["error", "always"],
    // "@stylistic/object-curly-spacing": ["error", "always"],
    // "@stylistic/padded-blocks": ["error", { classes: "always" }]
};

const mainConfig = [
  ...preact,
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // consider using rules below, once we have a full TS codebase and can be more strict
  // tseslint.configs.strictTypeChecked,
  // tseslint.configs.stylisticTypeChecked,
  // tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    plugins: {
      "simple-import-sort": simpleImportSort
    },

    rules: {
      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn"
    }
  },
  {
    files: ["**/*.{js,ts,mjs,cjs,tsx}"],

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
];

const playwrightConfig = {
  files: [
    "apps/server-e2e/src/**/*.spec.ts",
    "apps/desktop/e2e/**/*.spec.ts"
  ],
  plugins: { playwright },
  // Override or add rules here
  rules: { ...playwright.configs["flat/recommended"].rules, },
  languageOptions: { parser: tsParser },
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
    // TODO: check if we want to format packages here as well - for now skipping it
    "packages/*",
  ]),
  ...mainConfig,
  playwrightConfig
);
