/**
 * The full key lists of Vim mode, which the Shortcut Hints panel shows for the state of the editor:
 * the keys of a mode by topic, every key that can follow the keys typed, or the keys and the
 * commands of a prompt. The module has no editor code, so code notes can share it.
 */

import { getExCommands } from "./vim_completion.js";
import { getCancelHint, getConfirmHints, hint, type Translate, type VimHint } from "./vim_hints.js";

/** A titled group of hints. */
export interface VimHintSection {
    title: string;
    hints: VimHint[];
}

/** The state that the key list describes. */
export type KeyReferenceState =
    | { kind: "normal" | "visual" | "search" | "confirm" | "command" }
    | { kind: "insert"; areInsertKeysEnabled: boolean }
    | { kind: "pending"; hints: VimHint[] };

/** The keys of `state`, by topic, the ones available but not guaranteed last. */
export function getKeyReference(state: KeyReferenceState, t: Translate): VimHintSection[] {
    switch (state.kind) {
        case "pending":
            return [ {
                title: t("Keys that can follow"), hints: [ ...state.hints, getCancelHint(t) ]
            } ];
        case "visual":
            return getVisualReference(t);
        case "insert":
            return getInsertReference(state.areInsertKeysEnabled, t);
        case "command":
            return getCommandLineReference(t);
        case "search":
            return [ {
                title: t("Prompt keys"),
                hints: [
                    hint("<CR>", t("go to the match")),
                    hint([ "<Up>", "<Down>" ], t("earlier searches")),
                    hint("<C-u>", t("clear the prompt")),
                    hint("<Esc>", t("cancel"))
                ]
            } ];
        case "confirm":
            return [ { title: t("Prompt keys"), hints: getConfirmHints(t) } ];
        default:
            return getNormalReference(t);
    }
}

function getNormalReference(t: Translate): VimHintSection[] {
    return [
        {
            title: t("Moving"),
            hints: [
                hint([ "h", "j", "k", "l" ], t("left, down, up, right")),
                hint([ "w", "b", "e" ], t("next word, previous word, word end")),
                hint([ "0", "^", "$" ], t("line start, first character, line end")),
                hint([ "gg", "G" ], t("first line, last line")),
                hint([ "{", "}" ], t("previous block, next block")),
                hint([ "f", "t" ], t("to a character in this line…")),
                hint("%", t("matching bracket")),
                hint([ "gj", "gk" ], t("screen line down, up")),
                hint([ "<C-d>", "<C-u>" ], t("half a page down, up")),
                hint([ "<C-o>", "<C-i>" ], t("back, forward through jumps"))
            ]
        },
        {
            title: t("Editing"),
            hints: [
                hint("x", t("delete a character")),
                hint("d", t("delete with a motion…")),
                hint("c", t("change with a motion…")),
                hint("y", t("yank (copy) with a motion…")),
                hint([ "p", "P" ], t("put (paste) after, before")),
                hint([ "u", "<C-r>" ], t("undo, redo")),
                hint(".", t("repeat the last change")),
                hint("r", t("replace a character…")),
                hint("J", t("join lines")),
                hint([ ">>", "<<" ], t("indent, outdent this line")),
                hint("~", t("toggle the case of a character"))
            ]
        },
        {
            title: t("Typing"),
            hints: [
                hint([ "i", "a" ], t("insert before, after the cursor")),
                hint([ "I", "A" ], t("insert at line start, end")),
                hint([ "o", "O" ], t("open a line below, above")),
                hint("R", t("overwrite characters"))
            ]
        },
        {
            title: t("Selecting"),
            hints: [
                hint("v", t("select characters")),
                hint("V", t("select lines")),
                hint("gv", t("reselect"))
            ]
        },
        {
            title: t("Searching"),
            hints: [
                hint([ "/", "?" ], t("search forward, backward")),
                hint([ "n", "N" ], t("next, previous match")),
                hint([ "*", "#" ], t("this word, forward, backward"))
            ]
        },
        {
            title: t("Sections and links"),
            hints: [
                hint([ "]]", "[[" ], t("next, previous heading")),
                hint("za", t("collapse or expand")),
                hint("gf", t("follow the link"))
            ]
        },
        {
            title: t("Command line"),
            hints: [ hint(":", t("open the command line")), hint("ZZ", t("close the note tab")) ]
        },
        {
            title: t("Available, but not guaranteed"),
            hints: [
                hint("q", t("record a macro…")),
                hint("@", t("play a macro…")),
                hint("\"", t("name a register…")),
                hint("m", t("set a mark…")),
                hint([ "'", "`" ], t("go to a mark…"))
            ]
        }
    ];
}

function getVisualReference(t: Translate): VimHintSection[] {
    return [
        {
            title: t("Acting on the selection"),
            hints: [
                hint([ "y", "d", "c" ], t("yank (copy), delete, change")),
                hint([ ">", "<" ], t("indent, outdent")),
                hint([ "~", "u", "U" ], t("toggle, lower, upper case")),
                hint("J", t("join lines")),
                hint("p", t("put (paste) over it")),
                hint(":", t("a command on its lines"))
            ]
        },
        {
            title: t("Extending the selection"),
            hints: [
                hint([ "i", "a" ], t("select inside, around…")),
                hint("o", t("go to the other end")),
                hint([ "w", "j", "}", "G" ], t("any motion")),
                hint("<Esc>", t("leave Visual mode"))
            ]
        }
    ];
}

function getInsertReference(areInsertKeysEnabled: boolean, t: Translate): VimHintSection[] {
    const sections = [ {
        title: t("Insert mode keys"),
        hints: [
            hint([ "<Esc>", "<C-[>", "<C-c>" ], t("back to Normal mode")),
            hint("<C-o>", t("one Normal-mode command")),
            hint("<C-w>", t("delete the word before")),
            hint("<C-r>", t("insert a register…")),
            hint([ "<C-t>", "<C-d>" ], t("indent, outdent"))
        ]
    } ];
    if (areInsertKeysEnabled) {
        sections.push({
            title: t("With Vim keys in Insert mode"),
            hints: [
                hint("<C-u>", t("delete to the line start")),
                hint([ "<C-e>", "<C-y>" ], t("the character below, above")),
                hint("<C-k>", t("a digraph…")),
                hint("<C-v>", t("the next key as it is…")),
                hint("<C-a>", t("the last inserted text"))
            ]
        });
    }
    return sections;
}

function getCommandLineReference(t: Translate): VimHintSection[] {
    const commands = getExCommands(t).filter((each) => each.isListed);
    const toHint = ({ name, shortName, summary }: typeof commands[number]): VimHint => ({
        keys: [ shortName === name ? name : `${shortName}[${name.slice(shortName.length)}]` ],
        isLiteral: true,
        description: summary
    });
    return [
        {
            title: t("Prompt keys"),
            hints: [
                hint([ "<Tab>", "<S-Tab>" ], t("next, previous suggestion")),
                hint("<CR>", t("run the command")),
                hint([ "<Up>", "<Down>" ], t("earlier commands")),
                hint("<C-u>", t("clear the prompt")),
                hint("<Esc>", t("cancel"))
            ]
        },
        { title: t("Commands"), hints: commands.filter((each) => each.isSupported).map(toHint) },
        {
            title: t("Available, but not guaranteed"),
            hints: commands.filter((each) => !each.isSupported).map(toHint)
        }
    ];
}
