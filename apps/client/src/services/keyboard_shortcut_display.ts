/**
 * Client-side facade for the shortcut display utility. The core lives in
 * `@triliumnext/commons` so shared packages (e.g. the ckeditor5 checkbox
 * tooltip) can use it without depending on `apps/client`; here we bind it
 * to the client's own i18next `t()` and platform check so call sites can
 * keep the zero-argument-context ergonomic.
 *
 * `SHORTCUT_KEY_PREFIX`, `splitShortcutForDisplay`, `ShortcutTranslate`
 * are re-exported unchanged from commons — they are context-free and shared
 * verbatim by every caller.
 */

import {
    formatShortcut as formatShortcutCore,
    formatShortcutKey as formatShortcutKeyCore,
    joinShortcut as joinShortcutCore,
    SHORTCUT_KEY_PREFIX,
    splitShortcutForDisplay,
    type ShortcutTranslate
} from "@triliumnext/commons";

import { t } from "./i18n.js";
import { isMac } from "./utils.js";

export { SHORTCUT_KEY_PREFIX, splitShortcutForDisplay, type ShortcutTranslate };

export function formatShortcut(shortcut: string): string[] {
    return formatShortcutCore(shortcut, t, isMac());
}

export function joinShortcut(tokens: string[], sep = "+"): string {
    return joinShortcutCore(tokens, isMac(), sep);
}

export function formatShortcutKey(token: string): string {
    return formatShortcutKeyCore(token, t);
}
