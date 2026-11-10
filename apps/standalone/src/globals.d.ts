import type { StandaloneApi } from "@triliumnext/commons";

declare global {
    interface Window {
        /** Set to `globalThis` for dependencies that read Node's `global`. */
        global: typeof globalThis;
        /** Declared again by the client's `types.d.ts`, which reads it; this project only writes it. */
        standaloneApi?: StandaloneApi;
    }
}
