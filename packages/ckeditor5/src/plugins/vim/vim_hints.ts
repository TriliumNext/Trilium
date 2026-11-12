/**
 * The key hints of Vim mode: the keys of a mode, and the keys that can follow the keys of a command
 * being typed. The module has no editor code, so the Vim mode of code notes can share it.
 */

/** Keys in keyboard style, followed by a few words about what they do. */
export interface VimHint {
    /** The keys as the keyboard names them, such as `w`, `Esc` or `Ctrl+R`. None for a phrase. */
    keys: string[];
    /** Whether the two keys are the ends of a range, such as `a` to `z`. */
    isRange?: boolean;
    /** Whether the keys are text to type, such as `$1`, which shows as code rather than keys. */
    isLiteral?: boolean;
    description: string;
    /** The part of the description being typed, such as `pattern` in `pattern/replacement`. */
    emphasis?: { start: number; end: number };
}

/**
 * What the hints are about: `mode` for the keys of Normal or Visual mode, `command` for the keys
 * that can follow the keys typed so far, and `prompt` for the keys of a prompt.
 */
export type VimHintKind = "mode" | "command" | "prompt";

/** The hints that the status bar shows. */
export interface VimHints {
    kind: VimHintKind;
    /** The keys of the command so far, which lead the hints. */
    typedKeys: string[];
    hints: VimHint[];
}

/** The mode whose keys apply: Normal, Visual or Insert mode. */
export type VimKeyContext = "normal" | "visual" | "insert";

/** The state of the command being typed, read from the engine. */
export interface PendingCommand {
    context: VimKeyContext;
    /** The keys that wait for more, such as `g` or `i`, after any count. */
    keyBuffer: string;
    /** The keys of the operator that waits for its motion, such as `d` or `gu`, or `""`. */
    operator: string;
    /** Whether a count was typed. */
    hasCount: boolean;
    /** The register named with `"`, or `""`. */
    registerName: string;
}

/** The block that `ip` and `ap` take at the cursor, by the innermost container rule. */
export type ParagraphObjectKind = "paragraph" | "listItem" | "heading" | "quote" | "admonition"
    | "codeBlock" | "box" | "collapsibleTitle" | "collapsibleBody" | "widget";

/** What the hints read from the editor. Each is called only for the keys that need it. */
export interface HintContext {
    /** Whether the cursor is on a link, which `gf` follows. */
    isOnLink(): boolean;
    /** Whether `za` collapses or expands something at the cursor. */
    canFold(): boolean;
    getParagraphObjectKind(): ParagraphObjectKind;
    /** Whether the user mapped `keys` in `context`, which gives them another meaning. */
    isMapped(keys: string, context: VimKeyContext): boolean;
}

/** The translation function of the editor, which takes the English text and its `%0` values. */
export type Translate = (message: string, values?: string[]) => string;

/** How many hints the status bar shows before `[Esc] cancel`. */
export const HINT_LIMIT = 5;

/** How long a command waits for its next key, in milliseconds, before the hints for it show. */
export const HINT_PAUSE = 400;

/** The names of the keys that the keyboard labels by name. */
const KEY_NAMES: Record<string, string> = {
    Esc: "Esc", CR: "Enter", BS: "Backspace", Del: "Delete", Tab: "Tab", Space: "Space",
    lt: "<", Up: "↑", Down: "↓", Left: "←", Right: "→", Home: "Home", End: "End",
    PageUp: "Page Up", PageDown: "Page Down", Ins: "Insert"
};

/** The modifiers of a key as Vim writes them, `<C-r>`, and as the keyboard names them. */
const MODIFIER_NAMES: Record<string, string> = { C: "Ctrl", S: "Shift", A: "Alt", M: "Meta" };

/** The keys of `keys`, each a character or a `<…>` name, such as `"`, `a` and `<C-r>`. */
export function splitKeys(keys: string): string[] {
    return keys.match(/<[^<>]+>|./gsu) ?? [];
}

/** The name of `key`, written as Vim writes it, as the keyboard names it: `<C-r>` is `Ctrl+R`. */
export function getKeyLabel(key: string): string {
    const named = /^<((?:[CSAM]-)*)([^<>]+)>$/.exec(key);
    if (!named) {
        return key;
    }
    const modifiers = named[1].split("-").filter(Boolean).map((name) => MODIFIER_NAMES[name]);
    const name = KEY_NAMES[named[2]] ?? (modifiers.length ? named[2].toUpperCase() : named[2]);
    return [ ...modifiers, name ].join("+");
}

/** The keys of Normal mode, or of Visual mode, while nothing is pending. */
export function getModeHints(context: "normal" | "visual", t: Translate): VimHint[] {
    if (context === "visual") {
        return [
            hint("y", t("yank (copy)")),
            hint("d", t("delete")),
            hint("c", t("change")),
            hint([ ">", "<" ], t("indent, outdent")),
            hint([ "i", "a" ], t("select inside, around…"))
        ];
    }
    return [
        hint("i", t("insert")),
        hint("v", t("select")),
        hint("u", t("undo")),
        hint("/", t("search")),
        hint(":", t("command"))
    ];
}

/**
 * The keys that can follow the command being typed, most useful first, or `null` when it waits for
 * nothing the hints know. Hints for keys that the user mapped to something else are left out.
 */
export function getCommandHints(
    command: PendingCommand, context: HintContext, t: Translate
): VimHint[] | null {
    const hints = resolveCommandHints(command, context, t);
    if (!hints) {
        return null;
    }
    const prefix = command.operator + command.keyBuffer;
    const mappingContext = command.context;
    return hints.filter((each) => each.isRange || !each.keys.length
        || !each.keys.some((key) => context.isMapped(prefix + key, mappingContext)));
}

/** The keys of the confirm prompt of `:s///c`. */
export function getConfirmHints(t: Translate): VimHint[] {
    return [
        hint("y", t("replace")),
        hint("n", t("skip")),
        hint("a", t("all the rest")),
        hint("q", t("stop here")),
        hint("l", t("this one, then stop"))
    ];
}

/** The hint that ends the hints of a command. */
export function getCancelHint(t: Translate): VimHint {
    return hint("<Esc>", t("cancel"));
}

/**
 * The keys of the search prompt, the syntax of the pattern, and whether the pattern typed so far
 * ignores case, as the engine reads it: a pattern without capitals or with the flag `/i` does.
 */
export function getSearchHints(pattern: string, isJavaScript: boolean, t: Translate): VimHint[] {
    const slash = findUnescapedSlash(pattern);
    const regexPart = slash === -1 ? pattern : pattern.slice(0, slash);
    const flags = slash === -1 ? "" : pattern.slice(slash);
    let caseNote = flags.includes("i") || !/[A-Z]/u.test(regexPart)
        ? t("case ignored")
        : t("case matched");
    if (isJavaScript && !isValidPattern(regexPart)) {
        caseNote = t("incomplete pattern");
    }
    return [
        hint("<CR>", t("go to the match")),
        hint([ "<Up>", "<Down>" ], t("earlier searches")),
        phrase(isJavaScript ? t("JavaScript regex") : t("Vim regex")),
        phrase(caseNote)
    ];
}

/** The keys after a search: the next and the previous match, and clearing the highlights. */
export function getAfterSearchHints(t: Translate): VimHint[] {
    return [ hint("n", t("next")), hint("N", t("previous")), hint("<Esc>", t("clear")) ];
}

function findUnescapedSlash(pattern: string): number {
    for (let index = 0; index < pattern.length; index++) {
        if (pattern.charAt(index) === "\\") {
            index++;
        } else if (pattern.charAt(index) === "/") {
            return index;
        }
    }
    return -1;
}

function isValidPattern(pattern: string): boolean {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

function resolveCommandHints(
    command: PendingCommand, context: HintContext, t: Translate
): VimHint[] | null {
    const { keyBuffer, operator } = command;
    if (command.context === "insert") {
        return keyBuffer === "<C-r>" ? getInsertRegisterHints(t) : null;
    }
    if (!keyBuffer) {
        if (operator) {
            return getOperatorHints(operator, t);
        }
        if (command.hasCount) {
            return getCountHints(t);
        }
        return command.registerName ? getRegisterUseHints(t) : null;
    }
    const isVisual = command.context === "visual";
    if ((keyBuffer === "i" || keyBuffer === "a") && (operator || isVisual)) {
        return getTextObjectHints(keyBuffer === "i", context, t);
    }
    if (operator || isVisual) {
        const motions = getPrefixMotionHints(keyBuffer, isVisual, t);
        if (motions) {
            return motions;
        }
    } else {
        const prefixed = getPrefixHints(keyBuffer, context, t);
        if (prefixed) {
            return prefixed;
        }
    }
    return getCharacterHints(keyBuffer, operator ? "operator" : command.context, t)
        ?? (operator ? null : getNameHints(keyBuffer, t));
}

/** The keys after an operator: the line, the most used motions, and the text objects. */
function getOperatorHints(operator: string, t: Translate): VimHint[] | null {
    const toWord = hint("w", t("to next word"));
    const toLineEnd = hint("$", t("to line end"));
    const inside = hint("i", t("inside…"));
    const around = hint("a", t("around…"));
    switch (operator) {
        case "d":
        case "y":
            return [ hint(operator, t("this line")), toWord, toLineEnd, inside, around ];
        case "c":
            return [ hint("c", t("this line")), hint("w", t("rest of the word")), toLineEnd,
                inside, around ];
        case ">":
        case "<":
            return [
                hint(operator, t("this line")), hint("j", t("and the next line")), around,
                hint("}", t("to next block")), hint("G", t("to the end"))
            ];
        case "gu":
        case "gU":
        case "g~":
            return [ hint(operator.slice(1), t("this line")), toWord, toLineEnd, inside, around ];
        case "g?":
            return [ toWord, toLineEnd, inside, around ];
        default:
            return null;
    }
}

/** The text objects after `i` or `a`. */
function getTextObjectHints(isInner: boolean, context: HintContext, t: Translate): VimHint[] {
    return [
        hint("w", t("word")),
        hint("p", getParagraphObjectDescription(context.getParagraphObjectKind(), isInner, t)),
        hint("s", t("sentence")),
        hint("\"", t("quoted text")),
        hint("(", t("parentheses")),
        hint("[", t("brackets")),
        hint("{", t("braces")),
        hint("'", t("single-quoted text")),
        hint("W", t("word with punctuation"))
    ];
}

/** What `ip` or `ap` takes for the block at the cursor. */
function getParagraphObjectDescription(
    kind: ParagraphObjectKind, isInner: boolean, t: Translate
): string {
    switch (kind) {
        case "listItem":
            return isInner ? t("the item's paragraphs") : t("the item, nested items too");
        case "heading":
            return isInner ? t("the heading line") : t("the heading and its section");
        case "quote":
            return isInner ? t("its paragraphs") : t("the whole quote");
        case "admonition":
            return isInner ? t("its paragraphs") : t("the whole admonition");
        case "codeBlock":
            return isInner ? t("its lines") : t("the code block");
        case "box":
            return t("its content");
        case "collapsibleTitle":
            return isInner ? t("the title") : t("the whole block");
        case "collapsibleBody":
            return isInner ? t("the body") : t("the whole block");
        case "widget":
            return t("the widget");
        default:
            return t("the paragraph");
    }
}

/** The commands behind `g`, `z`, `[`, `]` and `Z` in Normal mode. */
function getPrefixHints(prefix: string, context: HintContext, t: Translate): VimHint[] | null {
    switch (prefix) {
        case "g":
            return [
                hint("g", t("first line")),
                ...context.isOnLink() ? [ hint("f", t("follow the link")) ] : [],
                hint([ "j", "k" ], t("screen line down, up")),
                hint("v", t("reselect")),
                hint("i", t("insert at last change")),
                hint([ "u", "U" ], t("lower, upper case…")),
                hint("~", t("toggle case…")),
                hint("J", t("join without a space")),
                hint("e", t("back to word end")),
                hint("I", t("insert at line start")),
                hint([ "*", "#" ], t("search this word, part of a word too"))
            ];
        case "z": {
            const canFold = context.canFold();
            return [
                ...canFold ? [ hint("a", t("collapse or expand")) ] : [],
                hint("z", t("center this line")),
                hint([ "t", "b" ], t("this line to top, bottom")),
                hint([ "j", "k" ], t("next, previous heading")),
                ...canFold ? [
                    hint([ "o", "c" ], t("expand, collapse")),
                    hint([ "A", "O", "C" ], t("the same, nested sections too"))
                ] : []
            ];
        }
        case "]":
            return [
                hint("]", t("next heading")),
                hint("z", t("end of this section")),
                hint("[", t("line before the next heading")),
                hint("p", t("put (paste) below"))
            ];
        case "[":
            return [
                hint("[", t("previous heading")),
                hint("z", t("start of this section")),
                hint("]", t("line before the previous heading")),
                hint("p", t("put (paste) above"))
            ];
        case "Z":
            return [ hint("Z", t("close the note tab")) ];
        default:
            return null;
    }
}

/** The motions behind a prefix, after an operator or in Visual mode. */
function getPrefixMotionHints(prefix: string, isVisual: boolean, t: Translate): VimHint[] | null {
    switch (prefix) {
        case "g":
            return [
                hint("g", t("to the first line")),
                hint("e", t("back to word end")),
                hint([ "j", "k" ], t("screen line down, up")),
                ...isVisual ? [
                    hint([ "u", "U" ], t("to lower, upper case")),
                    hint("~", t("switch the case")),
                    hint("J", t("join without a space"))
                ] : []
            ];
        case "z":
            return [ hint([ "j", "k" ], t("to next, previous heading")) ];
        case "]":
            return [
                hint("]", t("to next heading")),
                hint("z", t("to the end of this section")),
                hint("[", t("to the line before the next heading"))
            ];
        case "[":
            return [
                hint("[", t("to previous heading")),
                hint("z", t("to the start of this section")),
                hint("]", t("to the line before the previous heading"))
            ];
        default:
            return null;
    }
}

/** The phrase for the keys that wait for a character: `f`, `F`, `t`, `T` and `r`. */
function getCharacterHints(
    key: string, mode: "operator" | VimKeyContext, t: Translate
): VimHint[] | null {
    const repeats = [ phrase(t("then")), hint(";", t("again")), hint(",", t("the other way")) ];
    if (mode === "operator") {
        switch (key) {
            case "f":
                return [ phrase(t("any character: up to and including it")) ];
            case "F":
                return [ phrase(t("any character: back to and including it")) ];
            case "t":
                return [ phrase(t("any character: up to just before it")) ];
            case "T":
                return [ phrase(t("any character: back to just after it")) ];
            default:
                return null;
        }
    }
    if (mode === "visual") {
        switch (key) {
            case "f":
                return [ phrase(t("any character: extend to it")), ...repeats ];
            case "F":
                return [ phrase(t("any character: extend back to it")), ...repeats ];
            case "t":
                return [ phrase(t("any character: extend to just before it")), ...repeats ];
            case "T":
                return [ phrase(t("any character: extend back to just after it")), ...repeats ];
            case "r":
                return [ phrase(t("any character: it replaces each selected one")) ];
            default:
                return null;
        }
    }
    switch (key) {
        case "f":
            return [ phrase(t("any character: jump to it in this line")), ...repeats ];
        case "F":
            return [ phrase(t("any character: jump back to it in this line")), ...repeats ];
        case "t":
            return [ phrase(t("any character: jump to just before it")), ...repeats ];
        case "T":
            return [ phrase(t("any character: jump back to just after it")), ...repeats ];
        case "r":
            return [ phrase(t("any character: it replaces the one under the cursor")) ];
        default:
            return null;
    }
}

/** The names that `"`, `m`, `'`, `` ` ``, `q` and `@` wait for. */
function getNameHints(key: string, t: Translate): VimHint[] | null {
    switch (key) {
        case "\"":
            return [
                range("a", "z", t("a named register")),
                hint("+", t("the clipboard")),
                hint("0", t("the last yank")),
                hint("_", t("nowhere"))
            ];
        case "m":
            return [ range("a", "z", t("set a mark here")) ];
        case "'":
        case "`":
            return [
                range("a", "z", t("jump to a mark")),
                hint(key, t("back to before the last jump")),
                hint(".", t("the last change"))
            ];
        case "q":
            return [ range("a", "z", t("record a macro into this register")) ];
        case "@":
            return [ range("a", "z", t("play that macro")), hint("@", t("the last one again")) ];
        default:
            return null;
    }
}

/** The commands that use a register named with `"`. */
function getRegisterUseHints(t: Translate): VimHint[] {
    return [
        hint("y", t("yank into it…")),
        hint("d", t("delete into it…")),
        hint("p", t("put from it"))
    ];
}

/** What a count does, in words that name no number. */
function getCountHints(t: Translate): VimHint[] {
    return [
        phrase(t("a count: repeats the next command")),
        hint("j", t("lines down")),
        hint("w", t("words forward")),
        hint([ "d", "d" ], t("delete lines")),
        hint("G", t("go to that line"))
    ];
}

/** The registers that `Ctrl+R` in Insert mode types. */
function getInsertRegisterHints(t: Translate): VimHint[] {
    return [
        hint("\"", t("the last yank or delete")),
        hint("+", t("the clipboard")),
        range("a", "z", t("a named register"))
    ];
}

/** A hint for `keys`, written as Vim writes them, such as `w` or `<C-r>`. */
export function hint(keys: string | string[], description: string): VimHint {
    return { keys: (Array.isArray(keys) ? keys : [ keys ]).map(getKeyLabel), description };
}

function range(first: string, last: string, description: string): VimHint {
    return { keys: [ first, last ], isRange: true, description };
}

/** A hint of words alone, such as what a key that waits for a character takes. */
export function phrase(description: string): VimHint {
    return { keys: [], description };
}
