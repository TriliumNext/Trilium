/**
 * Display-only formatting of keyboard shortcut strings.
 *
 * Shortcuts are *stored* in a canonical, language-independent format (e.g. `Ctrl+Shift+J`,
 * `Alt+Left`, `Meta+Plus`). That stored form is load-bearing — it drives keystroke matching,
 * conflict detection, option persistence, and Electron global-shortcut registration — so it must
 * never be translated. This module translates a shortcut only at the moment it is *shown* to the
 * user, leaving the stored value untouched.
 *
 * The single rule is: split the shortcut on `+`, then classify each token:
 *  - a *glyph* token (arrow keys, the plus key) renders a universal symbol — identical in every
 *    language, so it is a constant here and never translated;
 *  - a *translatable* token (modifier or named key) resolves its label through the caller-supplied
 *    `translate` function, keyed by an id under {@link SHORTCUT_KEY_PREFIX}; the label text lives
 *    in the translation files, not here;
 *  - any other token — letter, digit, function key, punctuation — is emitted verbatim.
 *
 * On macOS the modifiers and the common named keys are additionally rendered as their platform glyphs
 * (⌘ ⌥ ⌃ ⇧, plus ↩ ⎋ ⇥ ⌦ ⌫), with modifiers reordered into Apple's canonical order (⌃⌥⇧⌘). Keys
 * whose macOS glyph is rarely seen (Page Up/Down, Home/End) — and Space, which Apple writes as a word —
 * keep their translated label. Everything else is unchanged. The stored format is never touched.
 *
 * The i18n `t()` function and the `isMac` flag are dependency-injected so this module can live in
 * `@triliumnext/commons` and be consumed by both client code (which supplies its own `t`/`isMac`)
 * and shared/plugin code (e.g. the ckeditor5 checkbox tooltip) without inverting the dependency
 * graph.
 */

/** i18n key prefix under which the per-token labels live. */
export const SHORTCUT_KEY_PREFIX = "keyboard_shortcut_keys";

const GLOBAL_PREFIX = "global:";

/** Function that resolves an i18n key to its translated label. */
export type ShortcutTranslate = (key: string) => string;

/**
 * Formats a single stored shortcut string into an ordered list of display tokens. The array is the
 * flexible primitive every display site can build on: wrap each token in its own `<kbd>`, join with
 * `+`, or join with spaces, as that site prefers.
 *
 * A leading `global:` prefix (a storage detail) is stripped so it never leaks into the display.
 *
 * @param shortcut a stored shortcut, e.g. `"Ctrl+Shift+J"`, `"global:Meta+Plus"`, `"F5"`.
 * @param translate resolver for `keyboard_shortcut_keys.<id>` i18n keys.
 * @param isMac when `true`, use macOS glyphs and Apple's canonical modifier order.
 */
export function formatShortcut(shortcut: string, translate: ShortcutTranslate, isMac: boolean): string[] {
    const tokens = splitShortcutForDisplay(shortcut);
    return isMac ? formatTokensForMac(tokens, translate) : tokens.map((token) => formatShortcutKey(token, translate));
}

/**
 * Joins formatted shortcut tokens into a display string. On macOS the tokens are concatenated with no
 * separator (native convention: `⇧⌘J`); elsewhere they are joined with `sep` (default `"+"`; the
 * command palette passes `" + "`).
 */
export function joinShortcut(tokens: string[], isMac: boolean, sep = "+"): string {
    return tokens.join(isMac ? "" : sep);
}

/**
 * Splits a stored shortcut into its ordered tokens (modifiers followed by the final key), preserving
 * original casing. Mirrors the plus-key handling of the matcher in `shortcuts.ts`: `+` doubles as the
 * separator, so the plus key is encoded either as the named token `Plus` or as a lone/trailing `+`
 * (`"+"`, or a string ending in `"++"` such as `"Ctrl++"`), all of which yield a `"+"` token here.
 */
export function splitShortcutForDisplay(shortcut: string): string[] {
    const bare = stripGlobalPrefix((shortcut ?? "").trim());
    if (!bare) {
        return [];
    }

    if (bare === "+" || bare.endsWith("++")) {
        const modifiers = bare.slice(0, -1).split("+").filter((part) => part.trim() !== "");
        return [ ...modifiers, "+" ];
    }

    return bare.split("+");
}

/**
 * Renders one shortcut token (matched case-insensitively): a glyph token ({@link KEY_GLYPHS}) becomes
 * its universal symbol, a translatable token ({@link TRANSLATABLE_KEYS}) is resolved through the
 * supplied `translate` function, and any other token — letter, digit, function key, punctuation — is
 * returned unchanged.
 */
export function formatShortcutKey(token: string, translate: ShortcutTranslate): string {
    const lower = token.toLowerCase();

    const glyph = KEY_GLYPHS[lower];
    if (glyph) {
        return glyph;
    }

    const id = TRANSLATABLE_KEYS[lower];
    if (id) {
        return translate(`${SHORTCUT_KEY_PREFIX}.${id}`);
    }

    return token;
}

function stripGlobalPrefix(shortcut: string): string {
    return shortcut.startsWith(GLOBAL_PREFIX) ? shortcut.substring(GLOBAL_PREFIX.length) : shortcut;
}

/**
 * macOS variant: render modifier tokens as their platform glyphs, reordered into Apple's canonical
 * order (⌃⌥⇧⌘) regardless of how the shortcut was stored, followed by the remaining keys — which get
 * their macOS glyph when one is defined ({@link MAC_GLYPHS}) and otherwise fall back to the
 * cross-platform rendering (translated label / arrow glyph / verbatim). The `+` join between tokens is
 * left to the call sites unchanged.
 */
function formatTokensForMac(tokens: string[], translate: ShortcutTranslate): string[] {
    const modifierIds: string[] = [];
    const rest: string[] = [];
    for (const token of tokens) {
        const id = TRANSLATABLE_KEYS[token.toLowerCase()];
        if (id && MAC_MODIFIER_ORDER.includes(id)) {
            modifierIds.push(id);
        } else {
            rest.push(token);
        }
    }

    modifierIds.sort((a, b) => MAC_MODIFIER_ORDER.indexOf(a) - MAC_MODIFIER_ORDER.indexOf(b));

    return [
        ...modifierIds.map((id) => MAC_GLYPHS[id]),
        ...rest.map((token) => macKeyGlyph(token) ?? formatShortcutKey(token, translate))
    ];
}

/** The macOS glyph for `token` if one is defined, otherwise `undefined`. */
function macKeyGlyph(token: string): string | undefined {
    const id = TRANSLATABLE_KEYS[token.toLowerCase()];
    return id ? MAC_GLYPHS[id] : undefined;
}

/**
 * Tokens rendered as a universal glyph — the arrow keys (whose keycap *is* the glyph) and the plus key
 * (stored as the named token `Plus`). These read identically in every language, so they are constants
 * and are never routed through translation.
 */
const KEY_GLYPHS: Record<string, string> = {
    up: "↑", arrowup: "↑",
    down: "↓", arrowdown: "↓",
    left: "←", arrowleft: "←",
    right: "→", arrowright: "→",
    plus: "+", "+": "+"
};

/**
 * Maps a raw shortcut token (lowercased, aliases collapsed) to its translation id under
 * {@link SHORTCUT_KEY_PREFIX}. Only modifiers and named keys — the parts that differ across languages —
 * appear here; their labels come from the translation files, never hard-coded in this module.
 */
const TRANSLATABLE_KEYS: Record<string, string> = {
    // Modifiers. `CommandOrControl` is resolved to a concrete modifier server-side; folded to Ctrl
    // here defensively for display.
    ctrl: "ctrl",
    control: "ctrl",
    commandorcontrol: "ctrl",
    alt: "alt",
    shift: "shift",
    meta: "meta",
    cmd: "meta",
    command: "meta",

    // Named keys.
    enter: "enter",
    return: "enter",
    escape: "escape",
    esc: "escape",
    delete: "delete",
    del: "delete",
    backspace: "backspace",
    space: "space",
    tab: "tab",
    home: "home",
    end: "end",
    pageup: "page_up",
    pagedown: "page_down",
    insert: "insert",
    ins: "insert"
};

/**
 * macOS key glyphs keyed by translation id: the four modifiers plus the common named keys. Keys absent
 * here (Page Up/Down, Home/End, Space, Insert) keep their translated label on macOS — their glyphs are
 * rarely seen and read worse than the word. The Return key uses ↩ (U+21A9), matching Apple's native
 * menus, and the forward-delete glyph ⌦ pairs with Backspace's ⌫.
 */
const MAC_GLYPHS: Record<string, string> = {
    // Modifiers, rendered in MAC_MODIFIER_ORDER (Control, Option, Shift, Command).
    ctrl: "⌃",
    alt: "⌥",
    shift: "⇧",
    meta: "⌘",
    // Common named keys.
    enter: "↩",
    escape: "⎋",
    tab: "⇥",
    delete: "⌦",
    backspace: "⌫"
};

/** Apple's canonical modifier display order; also defines which ids are treated as modifiers. */
const MAC_MODIFIER_ORDER = [ "ctrl", "alt", "shift", "meta" ];
