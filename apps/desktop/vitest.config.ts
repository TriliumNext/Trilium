/// <reference types='vitest' />
import { defineConfig } from "vite";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: "../../node_modules/.vite/apps/desktop",
  plugins: [],
  test: {
    watch: false,
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,mts}", "spec/**/*.{test,spec}.{ts,mts}"],
    exclude: ["spec/build-checks/**"],
    reporters: ["verbose"],
  },
}));
