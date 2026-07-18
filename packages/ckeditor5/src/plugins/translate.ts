import type { Editor } from "ckeditor5";

/**
 * Resolves a Trilium translation key through the host-provided `translate` bridge (the client sets
 * it in `buildConfig`). Falls back to the English text when no bridge is configured — a standalone
 * editor, or a test — so a plugin never renders a raw translation key at the user.
 */
export function translate(editor: Editor, key: string, fallback: string): string {
    const translateFn = editor.config.get("translate") as ((key: string) => string) | undefined;
    return translateFn ? translateFn(key) : fallback;
}
