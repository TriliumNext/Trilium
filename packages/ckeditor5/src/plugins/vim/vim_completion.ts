/**
 * The completion of the command line of Vim mode: the Ex commands with a summary each, how the
 * engine matches a typed name, what a range means and the form of the arguments of a command. The
 * module has no editor code, so the Vim mode of code notes can share it.
 */

import type { Translate, VimHint } from "./vim_hints.js";

/** An Ex command, as the completion list shows it. */
export interface ExCommand {
    name: string;
    /** The shortest form that runs the command, as the engine knows it. */
    shortName: string;
    summary: string;
    /** Whether the command is listed. A command that means nothing in a note still runs. */
    isListed: boolean;
    /** Whether the command is covered in text notes, rather than available but not guaranteed. */
    isSupported: boolean;
    /** Whether the command acts on a range of lines. */
    takesRange: boolean;
    /** What follows the name: a form of its own, a list of names, or nothing. */
    arguments: "none" | "substitute" | "global" | "sort" | "map" | "normal" | "marks"
        | "editorCommand" | "option";
}

/** A row of the completion list. */
export interface CompletionRow {
    /** What the row shows, such as `s[ubstitute]`. */
    label: string;
    /** What `Tab` writes in place of the typed name or argument. */
    value: string;
    summary?: string;
    /** Whether `Enter` runs this row with the text typed as it is. */
    isDefault?: boolean;
    /** Whether the row is shown muted: an editor command not available here, or no match. */
    isMuted?: boolean;
}

/** The text of the command line, read as the engine reads it. */
export interface CommandLineParts {
    /** The range, such as `%` or `'<,'>`. */
    range: string;
    /** The command name typed so far. */
    name: string;
    /** What follows the name, such as ` file` or `/old/new/`. Empty while the name is typed. */
    rest: string;
}

/** An editor command, for the list of `:ck`. */
export interface EditorCommandInfo {
    name: string;
    isEnabled: boolean;
}

/** The commands that are available in text notes but not guaranteed. */
const UNSUPPORTED = new Set([
    "global", "vglobal", "normal", "delete", "yank", "put", "join", "registers", "marks",
    "delmarks", "map", "nmap", "vmap", "imap", "noremap", "nnoremap", "vnoremap", "inoremap",
    "unmap", "mapclear"
]);

/** The options of `:set` that the list offers. */
const OPTION_NAMES = [ "hints", "nohints" ];

/** A range: `%`, `*`, or a line and an optional second one, each with offsets. */
const RANGE = /^(?:%|\*|(?:\d+|[.$]|'.)?(?:[+-]\d*)*(?:,(?:\d+|[.$]|'.)?(?:[+-]\d*)*)?)/u;

/** The name of a command, as the engine reads it. */
const NAME = /^(?:\w+|!!|@@|[!#&*<=>@~])/u;

/** The Ex commands, most used first: those of text notes, then those available but not covered. */
export function getExCommands(t: Translate): ExCommand[] {
    return [
        command("substitute", "s", t("replace text in lines"), { range: true, args: "substitute" }),
        command("write", "w", t("save now")),
        command("quit", "q", t("close the note tab")),
        command("nohlsearch", "noh", t("clear the search highlights")),
        command("sort", "sor", t("sort lines or list items"), { range: true, args: "sort" }),
        command("wq", "wq", t("save and close the tab")),
        command("xit", "x", t("save and close the tab")),
        command("undo", "u", t("undo")),
        command("redo", "red", t("redo")),
        command("ck", "ck", t("run an editor command"), { range: true, args: "editorCommand" }),
        command("set", "se", t("change a Vim option"), { args: "option" }),
        command("startinsert", "start", t("enter Insert mode")),
        command("global", "g", t("run a command on matching lines"),
            { range: true, args: "global" }),
        command("vglobal", "v", t("run a command on the other lines"),
            { range: true, args: "global" }),
        command("normal", "norm", t("type Normal-mode keys on lines"),
            { range: true, args: "normal" }),
        command("delete", "d", t("delete lines"), { range: true }),
        command("yank", "y", t("yank (copy) lines"), { range: true }),
        command("put", "pu", t("put (paste) a register"), { range: true }),
        command("join", "j", t("join lines"), { range: true }),
        command("registers", "reg", t("list the registers")),
        command("marks", "marks", t("list the marks")),
        command("delmarks", "delm", t("delete marks"), { args: "marks" }),
        command("map", "map", t("map keys in every mode"), { args: "map" }),
        command("nmap", "nm", t("map keys in Normal mode"), { args: "map" }),
        command("vmap", "vm", t("map keys in Visual mode"), { args: "map" }),
        command("imap", "im", t("map keys in Insert mode"), { args: "map" }),
        command("noremap", "no", t("map keys in every mode, not remapped"), { args: "map" }),
        command("nnoremap", "nn", t("map keys in Normal mode, not remapped"), { args: "map" }),
        command("vnoremap", "vn", t("map keys in Visual mode, not remapped"), { args: "map" }),
        command("inoremap", "ino", t("map keys in Insert mode, not remapped"), { args: "map" }),
        command("unmap", "unmap", t("remove a mapping"), { args: "map" }),
        command("mapclear", "mapc", t("remove all mappings")),
        ...[
            [ "colorscheme", "colo" ], [ "setlocal", "setl" ], [ "setglobal", "setg" ],
            [ "omap", "om" ], [ "onoremap", "ono" ], [ "nmapclear", "nmapc" ],
            [ "vmapclear", "vmapc" ], [ "imapclear", "imapc" ], [ "omapclear", "omapc" ]
        ].map(([ name, shortName ]) => ({ ...command(name, shortName, ""), isListed: false }))
    ];
}

/** Reads `text`, the command line without its `:`, into its range, name and the rest. */
export function parseCommandLine(text: string): CommandLineParts {
    const afterColons = text.replace(/^:+/u, "");
    const range = (RANGE.exec(afterColons) as RegExpExecArray)[0];
    const afterRange = afterColons.slice(range.length).replace(/^\s+/u, "");
    const name = NAME.exec(afterRange)?.[0] ?? "";
    return { range, name, rest: afterRange.slice(name.length) };
}

/**
 * The command that `Enter` runs for the typed `name`, as the engine finds it: the command whose
 * short name is the longest start of `name`, and whose full name starts with `name`.
 */
export function findCommand(name: string, commands: ExCommand[]): ExCommand | null {
    for (let length = name.length; length > 0; length--) {
        const prefix = name.slice(0, length);
        const found = commands.find((each) => each.shortName === prefix);
        if (found) {
            return found.name.startsWith(name) ? found : null;
        }
    }
    return null;
}

/**
 * The commands whose names start with the typed `name`: first the one that `Enter` runs, then the
 * others by rank. Without a name, the commands that take a range come first after a range.
 */
export function getCommandRows(parts: CommandLineParts, t: Translate): CompletionRow[] {
    const commands = getExCommands(t);
    const listed = commands.filter((each) => each.isListed);
    if (!parts.name) {
        const ranked = parts.range
            ? [ ...listed.filter((each) => each.takesRange),
                ...listed.filter((each) => !each.takesRange) ]
            : listed;
        return ranked.map((each) => toRow(each, false));
    }
    const runs = findCommand(parts.name, commands);
    const matches = listed.filter((each) => each.name.startsWith(parts.name));
    if (!matches.length) {
        return [ {
            label: t("no command starts with %0", [ parts.name ]), value: parts.name, isMuted: true
        } ];
    }
    const first = matches.filter((each) => each === runs);
    const others = matches.filter((each) => each !== runs);
    return [
        ...first.map((each) => toRow(each, true)), ...others.map((each) => toRow(each, false))
    ];
}

/**
 * The rows for the argument of `:ck` or `:set` being typed, or `null` for a command whose
 * argument has no list. The editor commands match anywhere in their names.
 */
export function getArgumentRows(
    parts: CommandLineParts, t: Translate, editorCommands: () => EditorCommandInfo[]
): CompletionRow[] | null {
    const found = findCommand(parts.name, getExCommands(t));
    const argument = parts.rest.replace(/^\s+/u, "");
    if (!found || !/^\s/u.test(parts.rest) || /\s/u.test(argument)) {
        return null;
    }
    if (found.arguments === "option") {
        return OPTION_NAMES.filter((name) => name.startsWith(argument)).map((name) => ({
            label: name,
            value: name,
            summary: name === "hints" ? t("show the key hints") : t("hide the key hints")
        }));
    }
    if (found.arguments !== "editorCommand") {
        return null;
    }
    const typed = argument.toLowerCase();
    const matching = editorCommands()
        .filter(({ name }) => name.toLowerCase().includes(typed))
        .sort((a, b) => Number(!a.name.toLowerCase().startsWith(typed))
            - Number(!b.name.toLowerCase().startsWith(typed)) || a.name.localeCompare(b.name));
    return matching.map(({ name, isEnabled }) =>
        ({ label: name, value: name, isMuted: !isEnabled }));
}

/** Writes `value` in place of the name, or of the argument when `isArgument` is set. */
export function fillIn(text: string, value: string, isArgument: boolean): string {
    const parts = parseCommandLine(text);
    const beforeName = text.slice(0, text.length - parts.name.length - parts.rest.length);
    if (!isArgument) {
        return beforeName + value + parts.rest;
    }
    return beforeName + parts.name + parts.rest.replace(/\S.*$/su, "") + value;
}

/**
 * The hints at the right end of the command line: the meaning of a range typed alone, the form of
 * the arguments of a command once they start, or the summary of a command that takes none.
 */
export function getCommandLineHints(parts: CommandLineParts, t: Translate): VimHint[] {
    if (!parts.name) {
        const reading = getRangeReading(parts.range, t);
        return reading ? [ phrase(reading) ] : [];
    }
    const found = findCommand(parts.name, getExCommands(t));
    if (!found) {
        return [];
    }
    if (found.arguments === "none") {
        return [ phrase(found.summary) ];
    }
    if (!parts.rest) {
        return [];
    }
    return getArgumentForm(found, parts.rest, t);
}

/** What a range means, such as "lines 1 to 5", or `null` for a range the hints do not read. */
export function getRangeReading(range: string, t: Translate): string | null {
    if (range === "%") {
        return t("the whole note");
    }
    if (range === "'<,'>") {
        return t("the lines of the selection");
    }
    const [ first, last ] = range.split(",");
    if (last === undefined) {
        if (first === ".") {
            return t("this line");
        }
        if (first === "$") {
            return t("the last line");
        }
        return /^\d+$/u.test(first) ? t("line %0", [ first ]) : null;
    }
    if (first === "." && last === "$") {
        return t("from this line to the end");
    }
    const next = /^\.?\+(\d+)$/u.exec(last);
    if (first === "." && next) {
        return t("this line and the next %0", [ next[1] ]);
    }
    if (/^\d+$/u.test(first) && /^\d+$/u.test(last)) {
        return t("lines %0 to %1", [ first, last ]);
    }
    return null;
}

/** The form of the arguments of `command`, with the part being typed emphasized. */
function getArgumentForm(command: ExCommand, rest: string, t: Translate): VimHint[] {
    switch (command.arguments) {
        case "substitute":
        case "global": {
            const trimmed = rest.replace(/^\s+/u, "");
            const separator = trimmed.charAt(0);
            if (!separator || /\w/u.test(separator)) {
                return [];
            }
            const names = command.arguments === "substitute"
                ? [ t("pattern"), t("replacement"), t("flags") ]
                : [ t("pattern"), t("command") ];
            const part = Math.min(countParts(trimmed.slice(1), separator), names.length) - 1;
            return [ form(names, separator, part), ...getPartHints(command, part, t) ];
        }
        case "sort":
            return [
                literal("[!] [i] [n] [u] [/pattern/]", ""),
                literal("!", t("reverse")),
                literal("i", t("ignore case")),
                literal("n", t("by number")),
                literal("u", t("drop duplicates"))
            ];
        case "map":
            return [
                literal("{keys} {keys or :command}", ""),
                phrase(t("for example %0", [ ":imap jk <Esc>" ]))
            ];
        case "normal":
            return [ literal("{keys}", ""), phrase(t("typed on each line of the range")) ];
        case "marks":
            return [ literal("{marks}", "") ];
        default:
            return [];
    }
}

/** What the part being typed of `:s` or `:g` takes. */
function getPartHints(command: ExCommand, part: number, t: Translate): VimHint[] {
    if (part === 0) {
        return [ phrase(t("a JavaScript regular expression")) ];
    }
    if (command.arguments === "global") {
        return [ phrase(t("runs the command on each matching line")) ];
    }
    if (part === 1) {
        return [
            literal("$1", t("a group")),
            literal("$&", t("the whole match")),
            literal("\\n", t("a line break"))
        ];
    }
    return [
        literal("g", t("every match in the line")),
        literal("i", t("ignore case")),
        literal("c", t("confirm each"))
    ];
}

/** How many parts `text` has, split at each `separator` that no backslash escapes. */
function countParts(text: string, separator: string): number {
    let parts = 1;
    for (let index = 0; index < text.length; index++) {
        if (text.charAt(index) === "\\") {
            index++;
        } else if (text.charAt(index) === separator) {
            parts++;
        }
    }
    return parts;
}

function toRow(each: ExCommand, isDefault: boolean): CompletionRow {
    const { name, shortName, summary } = each;
    const label = shortName === name ? name : `${shortName}[${name.slice(shortName.length)}]`;
    return { label, value: name, summary, ...isDefault ? { isDefault } : {} };
}

function command(
    name: string, shortName: string, summary: string,
    { range = false, args = "none" }: { range?: boolean; args?: ExCommand["arguments"] } = {}
): ExCommand {
    return {
        name, shortName, summary, isListed: true, isSupported: !UNSUPPORTED.has(name),
        takesRange: range, arguments: args
    };
}

/** The parts of a form, such as `pattern/replacement/flags`, with the part `current` emphasized. */
function form(names: string[], separator: string, current: number): VimHint {
    const start = names.slice(0, current).reduce((sum, name) => sum + name.length + 1, 0);
    return {
        keys: [],
        description: names.join(separator),
        emphasis: { start, end: start + names[current].length }
    };
}

/** Text to type, shown as code, followed by what it does. */
function literal(text: string, description: string): VimHint {
    return { keys: [ text ], isLiteral: true, description };
}

function phrase(description: string): VimHint {
    return { keys: [], description };
}
