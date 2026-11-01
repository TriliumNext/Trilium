/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
    /** Whether to enable the CKEditor inspector (see https://ckeditor.com/docs/ckeditor5/latest/framework/develpment-tools/inspector.html). */
    readonly VITE_CKEDITOR_ENABLE_INSPECTOR?: "true" | "false";
    /** Sends standalone's API calls through the service worker instead of the worker-owning tab. */
    readonly VITE_DISABLE_LOCAL_FETCH?: "true" | "false";
    /**
     * Simulates a mobile device's system bars: the `--safe-area-inset-*` values in CSS pixels, in
     * the order of the CSS `padding` shorthand (`"0 0 48 0"`). Empty turns the simulation off.
     */
    readonly VITE_DEBUG_SAFE_AREA_INSETS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
