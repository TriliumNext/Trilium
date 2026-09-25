/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
    /** Whether to enable the CKEditor inspector (see https://ckeditor.com/docs/ckeditor5/latest/framework/develpment-tools/inspector.html). */
    readonly VITE_CKEDITOR_ENABLE_INSPECTOR?: "true" | "false";
    /** Sends standalone's API calls through the service worker instead of the worker-owning tab. */
    readonly VITE_DISABLE_LOCAL_FETCH?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
