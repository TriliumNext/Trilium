import type { Editor } from "ckeditor5";

/**
 * Render a keystroke for display inside a message, as `<kbd>Ctrl</kbd>+<kbd>Enter</kbd>` (or
 * `<kbd>⌃</kbd><kbd>↩</kbd>` on macOS).
 *
 * The host does the rendering, through the `renderShortcut` editor config entry. Key names are
 * translated — "Ctrl" is "Strg" in German — but they live in the app-wide `keyboard_shortcut_keys`
 * catalog that the command palette and the help dialog also read, not among the messages this
 * package owns. Resolving them here would mean either duplicating fifteen strings translators have
 * already done, or overriding CKEditor's own "Insert".
 *
 * Falls back to the stored form (`"Ctrl+Enter"`) when no host is attached — a standalone editor, or
 * a test — so a shortcut always reads as a shortcut rather than disappearing.
 *
 * The result is markup: a caller interpolating it into a message must not escape it, and the
 * tooltip showing that message must not sanitize it.
 */
export function renderShortcut(editor: Editor, shortcut: string): string {
    const render = editor.config.get("renderShortcut") as ((shortcut: string) => string) | undefined;
    return render?.(shortcut) ?? shortcut;
}
