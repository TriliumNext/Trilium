import type {
    ActionArgs, ActionArgsPartial, CM5RangeInterface, CodeMirrorV, ExParams, InputStateInterface,
    MotionArgs, OperatorArgs, OperatorFn, Pos, Vim, vimActions, vimKey, vimMotions, vimState
} from "@replit/codemirror-vim-core";
import {
    isHighSurrogateHalf, isLowSurrogateHalf, type ModelElement, ModelLivePosition,
    type ModelPosition
} from "ckeditor5";

import VimAdapter, { getActiveAdapter, VimPosition } from "./vim_adapter.js";
import { joinLine, openLine, setTypingFormatting } from "./vim_editing.js";
import type { VimKeyContext } from "./vim_hints.js";
import { type LineSpan, OBJECT_CHARACTER, toCharacterEdge } from "./vim_lines.js";
import {
    cloneFragment, getRichContent, putLines, rememberRichContent, type RichContent
} from "./vim_registers.js";
import { sortLines } from "./vim_sort.js";
import {
    findHeading, findParagraphObject, findSectionEdge, findStructuralBlock, fold, type FoldAction,
    getColumnParts
} from "./vim_structure.js";

type Actions = vimActions;
type Motions = vimMotions;
type Operators = Record<string, OperatorFn>;
type ExCommand = (cm: CodeMirrorV, params: ExParams) => void;
type ExCommands = Record<string, ExCommand>;
type FoldArgs = { fold: FoldAction; isNested: boolean };

/** The commands of the engine that the commands of Trilium build on. */
interface BuiltIns {
    actions: Actions;
    motions: Motions;
    operators: Operators;
    exCommands: ExCommands;
}
type Register = ReturnType<ReturnType<Vim["getRegisterController"]>["getRegister"]>;

/** The name of the commands that read the built-in actions and operators of the engine. */
const PROBE = "triliumProbe";

/** The insert positions of `i`, `a`, `I`, `A` and `gI`, which enter a widget instead. */
const WIDGET_INSERTS = new Set([ "inplace", "charAfter", "firstNonBlank", "bol", "eol" ]);

/** The motions that find a character typed after them: `f`, `F`, `t`, `T`, `;` and `,`. */
const CHARACTER_SEARCHES = [
    "moveToCharacter", "moveTillCharacter", "repeatLastCharacterSearch"
] as const;

/** Whether a motion of the macro being played failed, which stops the rest of it, as in Vim. */
let isMacroStopped = false;

/** A macro being played: how many of its keys are left, and the macro its last keys call. */
interface MacroRun {
    keysLeft: number;
    next: { name: string; repeat: number } | null;
}

/** The macros being played, the innermost last. */
const macroRuns: MacroRun[] = [];

/** How many macros one call of a macro plays at most, and how many inside one another. */
const MAX_MACRO_CALLS = 10000;
const MAX_NESTED_MACROS = 100;

/**
 * Whether the operator about to run follows `j`, `k` or another line motion, which in a table move
 * down and up a column.
 */
let isColumnMotion = false;

/**
 * The arguments that `:ck` gives the editor commands that take their value in another shape than
 * `{ value }`, from the text after the name of the command.
 */
const COMMAND_ARGUMENTS: Record<string, (value: string) => unknown[]> = {
    link: (href) => [ href ],
    insertText: (text) => [ { text } ],
    codeBlock: (language) => [ { language, forceValue: true } ],
    admonition: (forceValue) => [ { forceValue } ],
    listStyle: (type) => [ { type } ],
    referenceLink: (href) => [ { href } ],
    insertImage: (source) => [ { source } ],
    imageInsert: (source) => [ { source } ],
    insertLinkEmbed: (url) => [ { url } ],
    insertTable: (size) => {
        const [ rows, columns = rows ] = size.split(/[\sx,]+/u).map(Number);
        return [ { rows, columns } ];
    },
    textPartLanguage: (language) => {
        const [ languageCode, textDirection ] = language.split(/[\s:]+/u);
        return [ { languageCode, textDirection } ];
    }
};

/** The keys that the user mapped, by the mode they apply in, or under `all` for every mode. */
const userMappings = new Map<VimKeyContext | "all", Set<string>>();

/** The keys that Trilium adds to the engine. `:mapclear` removes them, so they are added again. */
const TRILIUM_KEYS: vimKey[] = [
    { keys: "]]", type: "motion", motion: "triliumHeading",
        motionArgs: { forward: true, toJumplist: true } },
    { keys: "[[", type: "motion", motion: "triliumHeading",
        motionArgs: { forward: false, toJumplist: true } },
    { keys: "][", type: "motion", motion: "triliumSectionEnd", motionArgs: { forward: true } },
    { keys: "[]", type: "motion", motion: "triliumSectionEnd", motionArgs: { forward: false } },
    { keys: "zj", type: "motion", motion: "triliumHeading", motionArgs: { forward: true } },
    { keys: "zk", type: "motion", motion: "triliumHeading", motionArgs: { forward: false } },
    { keys: "]z", type: "motion", motion: "triliumSectionEdge", motionArgs: { forward: true } },
    { keys: "[z", type: "motion", motion: "triliumSectionEdge", motionArgs: { forward: false } },
    { keys: "%", type: "motion", motion: "triliumPercent",
        motionArgs: { inclusive: true, toJumplist: true, explicitRepeat: true } },
    { keys: "ap", type: "motion", motion: "triliumParagraphObject" },
    { keys: "ip", type: "motion", motion: "triliumParagraphObject",
        motionArgs: { textObjectInner: true } },
    foldKey("za", "toggle", false),
    foldKey("zo", "open", false),
    foldKey("zc", "close", false),
    foldKey("zA", "toggle", true),
    foldKey("zO", "open", true),
    foldKey("zC", "close", true),
    { keys: "<C-v>", type: "action", action: "triliumNoBlockMode" },
    { keys: "<C-q>", type: "action", action: "triliumNoBlockMode" },
    { keys: "gf", type: "action", action: "triliumFollowLink" },
    { keys: "ZZ", type: "action", action: "triliumQuit" },
    { keys: "ZQ", type: "action", action: "triliumDiscard" }
];

/**
 * Adapts the engine to text notes: the line commands that act on blocks, structural blocks for
 * `{`, `}`, `ap` and `ip`, headings and folds, the commands of Trilium, and registers that keep
 * the formatting of what they hold.
 */
export function installTriliumCommands(vim: Vim) {
    const builtIns = captureBuiltIns(vim);
    defineEditingCommands(vim, builtIns.actions, builtIns.operators);
    defineMacroReplay(vim, builtIns.actions);
    defineColumnOperators(vim, builtIns.operators);
    defineMotions(vim, builtIns.motions);
    defineActions(vim);
    defineExCommands(vim, builtIns.exCommands, builtIns.actions);
    addTriliumKeys(vim);
    wrapRegisters(vim);
    stopMacrosAtFailures(vim);
    recordMappings(vim, builtIns.exCommands);
    defineHintsOption(vim);
    checkExRanges(builtIns.exCommands);
}

/**
 * Checks the range of every Ex command as Vim does: a backward range is swapped, line 0 is the
 * first line, and a line outside the note is an error. A range alone goes to the last line at
 * most.
 */
function checkExRanges(exCommands: ExCommands) {
    for (const [ name, command ] of Object.entries(exCommands)) {
        exCommands[name] = function (this: unknown, cm, params, ...rest: unknown[]) {
            const adapter = cm as unknown as VimAdapter;
            const range = getExRange(adapter, params, name === "move");
            if (!range) {
                adapter.host.notify(adapter.editor.t("Invalid range"));
                return;
            }
            (command as (...args: unknown[]) => void).call(this, cm, { ...params, ...range },
                ...rest);
        } as ExCommand;
    }
}

/**
 * The lines of the range of `params` in the order of the note, or `null` when one is outside the
 * note. Line 0 of Vim, -1 for the engine, is the first line. With `isClamped`, a line past the last
 * line is the last line.
 */
function getExRange(
    adapter: VimAdapter, params: ExParams, isClamped: boolean
): Partial<ExParams> | null {
    if (params.line === undefined) {
        return {};
    }
    const last = adapter.lastLine();
    const ends = [ params.line, params.lineEnd ?? params.line ].map((line) => {
        const fixed = line === -1 ? 0 : line;
        return isClamped ? Math.min(fixed, last) : fixed;
    });
    if (ends.some((line) => line < 0 || line > last)) {
        return null;
    }
    const [ line, lineEnd ] = ends.sort((a, b) => a - b);
    const end = params.lineEnd === undefined ? undefined : lineEnd;
    return { line, lineEnd: end, selectionLine: line, selectionLineEnd: end };
}

/**
 * `:set hints` and `:set nohints`, which turn the key hints on and off through the host, so the
 * change stays. `:set hints?` reads the option of the editor that runs the command.
 */
function defineHintsOption(vim: Vim) {
    vim.defineOption("hints", undefined, "boolean", null, (value, cm) => {
        const adapter = (cm as unknown as VimAdapter | undefined) ?? getActiveAdapter();
        const config = adapter?.editor.config.get("vim");
        if (value === undefined) {
            return config?.areHintsEnabled?.() ?? false;
        }
        if (cm) {
            config?.host?.setHintsEnabled?.(value);
        }
        return undefined;
    });
}

/** Whether the user mapped `keys` in `context`, with `:map` or one of its variants. */
export function isUserMapped(keys: string, context: VimKeyContext): boolean {
    return !!userMappings.get(context)?.has(keys) || !!userMappings.get("all")?.has(keys);
}

/** Whether `keys` start a longer mapping of the user in `context`. */
export function startsUserMapping(keys: string, context: VimKeyContext): boolean {
    return [ ...userMappings.get(context) ?? [], ...userMappings.get("all") ?? [] ]
        .some((mapped) => mapped.length > keys.length && mapped.startsWith(keys));
}

/** Adds the keys of Trilium, the ones `:mapclear` removes included. */
export function addTriliumKeys(vim: Vim) {
    for (const command of [ ...TRILIUM_KEYS ].reverse()) {
        vim._mapCommand({ ...command });
    }
}

/**
 * The built-in actions, motions, operators and Ex commands, read through commands that run against
 * a stand-in editor, since the engine only passes them to its commands as `this`.
 */
function captureBuiltIns(vim: Vim): BuiltIns {
    let actions: Actions | null = null;
    let motions: Motions | null = null;
    let operators: Operators | null = null;
    let exCommands: ExCommands | null = null;
    vim.defineAction(PROBE, function (this: Actions) {
        actions = this;
    });
    vim.defineMotion(PROBE, function (this: Motions) {
        motions = { ...this };
        return null;
    });
    vim.defineOperator(PROBE, function (this: Operators) {
        operators = this;
    });
    vim.defineEx(PROBE, PROBE, function (this: ExCommands) {
        exCommands = this;
    });
    vim._mapCommand({ keys: "<TriliumProbeAction>", type: "action", action: PROBE });
    vim._mapCommand({ keys: "<TriliumProbeMotion>", type: "motion", motion: PROBE });
    vim._mapCommand({ keys: "<TriliumProbeOperator>", type: "operator", operator: PROBE });

    const probe = createProbeEditor();
    vim.handleKey(probe, "<TriliumProbeAction>", "user");
    vim.handleKey(probe, "<TriliumProbeMotion>", "user");
    vim.maybeInitVimState_(probe).visualMode = true;
    vim.handleKey(probe, "<TriliumProbeOperator>", "user");
    vim.handleEx(probe, PROBE);
    for (const keys of [
        "<TriliumProbeAction>", "<TriliumProbeMotion>", "<TriliumProbeOperator>"
    ]) {
        vim.unmap(keys, undefined as unknown as string);
    }
    vim.getRegisterController().getRegister(":").setText("");
    return {
        actions: actions as unknown as Actions,
        motions: motions as unknown as Motions,
        operators: operators as unknown as Operators,
        exCommands: exCommands as unknown as ExCommands
    };
}

/** An editor that the probe commands of `captureBuiltIns()` run against. */
function createProbeEditor(): CodeMirrorV {
    const start = new VimPosition(0, 0);
    const probe = {
        state: {},
        _handlers: {},
        marks: {},
        curOp: null as unknown,
        operation<T>(fn: () => T): T {
            probe.curOp = { $d: 1 };
            try {
                return fn();
            } finally {
                probe.curOp = null;
            }
        },
        getCursor: () => start,
        getLine: () => "",
        firstLine: () => 0,
        lastLine: () => 0,
        setSelections: () => undefined,
        setBookmark: () => ({})
    };
    return probe as unknown as CodeMirrorV;
}

function defineEditingCommands(vim: Vim, actions: Actions, operators: Operators) {
    const enterInsertMode = actions.enterInsertMode;
    const toggleVisualMode = actions.toggleVisualMode;
    const change = operators.change;
    const remove = operators.delete;

    // On an emoji, the engine starts the selection at its second half, from which `l` would move
    // past the next character too.
    vim.defineAction("toggleVisualMode", function (this: Actions, cm, actionArgs, state) {
        toggleVisualMode.call(this, cm, actionArgs, state);
        const head = state.sel.head;
        const ch = toCharacterEdge(cm.getLine(head.line), head.ch, false);
        if (state.visualMode && ch !== head.ch) {
            state.sel.head = new VimPosition(head.line, ch);
        }
    });

    // `i` and `a` on a widget enter its caption or the editor in it, or open a line as `O` and `o`.
    vim.defineAction("enterInsertMode", function (this: Actions, cm, actionArgs, state) {
        const adapter = cm as unknown as VimAdapter;
        const insertAt = actionArgs?.insertAt;
        const objectLine = adapter.getSelectedObjectLine();
        if (objectLine !== null && !state.visualMode && insertAt && WIDGET_INSERTS.has(insertAt)) {
            const isAtEnd = insertAt === "charAfter" || insertAt === "eol";
            const widget = adapter.index().getElement(objectLine) as ModelElement;
            const entry = adapter.host.enterWidget(widget, isAtEnd);
            if (entry?.kind === "embed") {
                return;
            }
            if (entry?.kind === "caption") {
                enterInsertMode.call(this, cm, { insertAt: "inplace", repeat: 1 }, state);
                adapter.editor.model.change((writer) => writer.setSelection(entry.position));
                return;
            }
            const lineArgs = { after: isAtEnd, repeat: actionArgs.repeat };
            this.newLineAndEnterInsertMode(cm, lineArgs, state);
            return;
        }
        enterInsertMode.call(this, cm, actionArgs, state);
        if (insertAt === "charAfter" || insertAt === "eol") {
            adapter.leaveTwoStepBoundary();
        }
    });

    // `o` and `O` do what Enter does at the end or at the start of the line.
    vim.defineAction("newLineAndEnterInsertMode", function (this: Actions, cm, actionArgs, state) {
        const adapter = cm as unknown as VimAdapter;
        if (adapter.editor.isReadOnly) {
            return;
        }
        state.insertMode = true;
        openLine(adapter.editor, () => adapter.index(), adapter.getCursor().line,
            !!actionArgs.after);
        this.enterInsertMode(cm, { repeat: actionArgs.repeat }, state);
    });

    // `J` and `gJ` do what Backspace at the start of the next line does.
    vim.defineAction("joinLines", (cm, actionArgs, state) => {
        const adapter = cm as unknown as VimAdapter;
        let first: number;
        let joins: number;
        if (state.visualMode) {
            first = Math.min(state.sel.anchor.line, state.sel.head.line);
            joins = Math.max(Math.abs(state.sel.head.line - state.sel.anchor.line), 1);
        } else {
            first = adapter.getCursor().line;
            joins = Math.max(actionArgs.repeat, 2) - 1;
        }
        let position: ModelPosition | null = null;
        for (let join = 0; join < joins; join++) {
            const joined = joinLine(adapter.editor, adapter.index(), first, !actionArgs.keepSpaces);
            if (!joined) {
                break;
            }
            position = joined;
        }
        if (state.visualMode) {
            vim.exitVisualMode(cm, false);
        }
        adapter.setCursor(position ? adapter.locatePosition(position) : adapter.getCursor());
    });

    // `p` puts lines as blocks of the kind their place gives them, and formatted text.
    vim.defineAction("paste", function (this: Actions, cm, actionArgs, state) {
        const adapter = cm as unknown as VimAdapter;
        const registerName = actionArgs.registerName;
        const register = vim.getRegisterController().getRegister(registerName);
        if (registerName === "+" || registerName === "*") {
            const place = getPutPlace(adapter, state);
            void readClipboard(adapter, register).then((text) => {
                // Vim mode, the note or the cursor can change while the clipboard is read.
                if (adapter.state.vim === state && getPutPlace(adapter, state) === place) {
                    adapter.operation(() =>
                        put(vim, adapter, this, actionArgs, state, register, text));
                }
            });
            return;
        }
        put(vim, adapter, this, actionArgs, state, register, register.toString());
    });

    // The engine removes the last line from the end of the line before, which in a note would take
    // that line as well, so the last line goes by itself here.
    vim.defineOperator("delete", function (this: Operators, cm, args, ranges, oldAnchor, newHead) {
        const adapter = cm as unknown as VimAdapter;
        const parts = takeColumnParts(adapter, args, ranges);
        if (parts) {
            return deleteParts(vim, adapter, args, parts);
        }
        const { anchor, head } = ranges[0];
        const last = adapter.lastLine();
        if (!args.linewise || cm.state.vim.visualBlock || anchor.line !== last
            || head.line !== last + 1 || !last) {
            return remove.call(this, cm, args, ranges, oldAnchor, newHead);
        }
        const text = adapter.getRange(new VimPosition(last, 0),
            new VimPosition(last, adapter.getLine(last).length));
        adapter.replaceRange("", new VimPosition(last, 0), new VimPosition(last + 1, 0));
        const registers = vim.getRegisterController();
        registers.pushText(args.registerName as string, "delete", text, true, false);
        const previous = adapter.getLine(last - 1);
        const firstNonBlank = previous.search(/\S/);
        return new VimPosition(last - 1, firstNonBlank === -1 ? previous.length : firstNonBlank);
    });

    // A change does nothing on a widget, and a change of whole lines keeps one empty line. The new
    // text takes the formatting of the text it replaces, as typing over a selection does.
    vim.defineOperator("change", function (this: Operators, cm, args, ranges, oldAnchor, newHead) {
        const adapter = cm as unknown as VimAdapter;
        const state = cm.state.vim;
        const parts = takeColumnParts(adapter, args, ranges);
        if (isOnlyWidgets(adapter, ranges[0].anchor, ranges[0].head)) {
            return oldAnchor;
        }
        let changed = ranges;
        if (!parts && state.visualMode && state.visualLine && args.linewise) {
            const first = Math.min(ranges[0].anchor.line, ranges[0].head.line);
            const last = Math.max(ranges[0].anchor.line, ranges[0].head.line) - 1;
            const head = new VimPosition(last, adapter.getLine(last).length);
            changed = [ { anchor: new VimPosition(first, 0), head } ];
            adapter.setSelection(changed[0].anchor, head);
        }
        const [ start ] = [ changed[0].anchor, changed[0].head ]
            .sort((a, b) => a.line - b.line || a.ch - b.ch);
        const firstCharacter = args.linewise && !state.visualMode
            ? new VimPosition(start.line, Math.max(adapter.getLine(start.line).search(/\S/), 0))
            : start;
        const position = adapter.toModelPosition(firstCharacter);
        const node = position.textNode ?? position.nodeAfter;
        const formatting = node?.is("$text") ? [ ...node.getAttributes() ] : null;
        const result = parts
            ? changeParts(vim, actions, adapter, args, parts)
            : change.call(this, cm, args, changed, oldAnchor, newHead);
        if (formatting) {
            setTypingFormatting(adapter.editor, formatting);
        }
        return result;
    });
}

/**
 * Makes the other operators that take whole lines, such as `y`, `gU` and `>`, take the parts of a
 * table column that `j` and `k` move through.
 */
function defineColumnOperators(vim: Vim, operators: Operators) {
    for (const [ name, operator ] of Object.entries(operators)) {
        if (name === "delete" || name === "change") {
            continue;
        }
        vim.defineOperator(name, function (this: Operators, cm, args, ranges, oldAnchor, newHead) {
            const adapter = cm as unknown as VimAdapter;
            const parts = takeColumnParts(adapter, args, ranges);
            if (!parts) {
                return operator.call(this, cm, args, ranges, oldAnchor, newHead);
            }
            if (name === "yank") {
                return yankParts(vim, adapter, args, parts, oldAnchor);
            }
            const runOn = ({ first, last }: LineSpan) => {
                const anchor = new VimPosition(first, 0);
                const part = { anchor, head: new VimPosition(last + 1, 0) };
                cm.setSelections([ part ]);
                return operator.call(this, cm, args, [ part ], oldAnchor, newHead);
            };
            const [ top, ...rest ] = parts;
            for (const part of rest.reverse()) {
                runOn(part);
            }
            return runOn(top);
        });
    }
}

/**
 * The parts of the whole lines of `ranges` that an operator after `j` or `k`, or in Visual Line
 * mode, takes down a table column, or `null` when it takes them all. Resets `isColumnMotion`.
 */
function takeColumnParts(
    adapter: VimAdapter, args: OperatorArgs, ranges: CM5RangeInterface[]
): LineSpan[] | null {
    const isAfterLineMotion = isColumnMotion;
    isColumnMotion = false;
    const state = adapter.state.vim as vimState;
    if (!args.linewise || !(isAfterLineMotion || (state.visualMode && state.visualLine))) {
        return null;
    }
    // The engine ends a range of whole lines at the start of the line after the last one.
    const { anchor, head } = ranges[0];
    return getColumnParts(adapter, anchor.line, head.line - 1);
}

/** Deletes the lines of `parts` into one register entry, as `d` deletes lines. */
function deleteParts(vim: Vim, adapter: VimAdapter, args: OperatorArgs, parts: LineSpan[]): Pos {
    const text = adapter.readLines(parts);
    for (const { first, last } of [ ...parts ].reverse()) {
        adapter.replaceRange("", new VimPosition(first, 0), new VimPosition(last + 1, 0));
    }
    vim.getRegisterController().pushText(args.registerName, "delete", text, true, false);
    const line = Math.min(parts[0].first, adapter.lastLine());
    return new VimPosition(line, Math.max(adapter.getLine(line).search(/\S/), 0));
}

/**
 * Deletes the lines of `parts` into one register entry and keeps an empty line in place of the
 * first part to type in, as `c` changes lines.
 */
function changeParts(
    vim: Vim, actions: Actions, adapter: VimAdapter, args: OperatorArgs, parts: LineSpan[]
) {
    const text = adapter.readLines(parts);
    const [ top, ...rest ] = parts;
    for (const { first, last } of rest.reverse()) {
        adapter.replaceRange("", new VimPosition(first, 0), new VimPosition(last + 1, 0));
    }
    adapter.replaceRange("", new VimPosition(top.first, 0),
        new VimPosition(top.last, adapter.getLine(top.last).length));
    vim.getRegisterController().pushText(args.registerName, "change", text, true, false);
    const insertArgs = { head: new VimPosition(top.first, 0) } as unknown as ActionArgs;
    actions.enterInsertMode(adapter as unknown as CodeMirrorV, insertArgs,
        adapter.state.vim as vimState);
}

/** Yanks the lines of `parts` into one register entry, as `y` yanks lines. */
function yankParts(
    vim: Vim, adapter: VimAdapter, args: OperatorArgs, parts: LineSpan[], oldAnchor: Pos
): Pos {
    const text = adapter.readLines(parts);
    vim.getRegisterController().pushText(args.registerName, "yank", text, true, false);
    const count = text.split("\n").length - 1;
    const into = args.registerName ? ` into "${args.registerName}` : "";
    adapter.openNotification(document.createTextNode(`${count} lines yanked${into}`),
        { duration: 1500 });
    const isVisual = (adapter.state.vim as vimState).visualMode;
    return isVisual ? new VimPosition(parts[0].first, 0) : oldAnchor;
}

/**
 * Puts `text`, which `register` holds, with the formatting it was read with when it is the text of
 * a rich content.
 */
function put(
    vim: Vim, adapter: VimAdapter, actions: Actions, actionArgs: ActionArgs, state: vimState,
    register: Register, text: string
) {
    if (!text || adapter.editor.isReadOnly) {
        return;
    }
    // The engine names the flag of `:put` `lineWise`.
    const isLinewise = !!(actionArgs as { lineWise?: boolean }).lineWise || register.linewise;
    const content = getRichContent(register, text);
    if (state.visualMode) {
        if (content && isLinewise === state.visualLine) {
            putOverSelection(vim, adapter, state, content, text, actionArgs.repeat);
        } else {
            actions.continuePaste(adapter as unknown as CodeMirrorV, actionArgs, state, text,
                register);
        }
        return;
    }
    if (isLinewise) {
        const cursorLine = adapter.getCursor().line;
        const start = putLines(adapter.editor, adapter.index(), cursorLine,
            !!actionArgs.after, content, text, actionArgs.repeat);
        if (start) {
            setCursorOnLineOf(adapter, start);
        } else {
            notifyNothingPut(adapter, cursorLine);
        }
        return;
    }
    if (content) {
        putInline(adapter, content, !!actionArgs.after, actionArgs.repeat);
        return;
    }
    actions.continuePaste(adapter as unknown as CodeMirrorV, actionArgs, state, text, register);
}

/**
 * Puts `content`, which holds `text`, `count` times over the Visual selection: text over the
 * selected text, or lines over the lines of Visual Line mode. The selection goes to the unnamed
 * register with its formatting, as in Vim.
 */
function putOverSelection(
    vim: Vim, adapter: VimAdapter, state: vimState, content: RichContent, text: string,
    count: number
) {
    const isLines = state.visualLine;
    const first = Math.min(state.sel.anchor.line, state.sel.head.line);
    const last = Math.max(state.sel.anchor.line, state.sel.head.line);
    const start = adapter.getCursor("start");
    const end = adapter.getCursor("end");
    const replaced = isLines
        ? adapter.readLines([ { first, last } ])
        : adapter.getRange(start, end);
    const replacedContent = adapter.takeReadContent(replaced, isLines);
    const unnamed = vim.getRegisterController().unnamedRegister;
    unnamed.setText(replaced, isLines);
    rememberRichContent(unnamed, replacedContent as RichContent);
    vim.exitVisualMode(adapter as unknown as CodeMirrorV, false);
    if (!isLines) {
        adapter.replaceRange("", start, end);
        putInline(adapter, content, false, count);
        return;
    }
    const put = putLines(adapter.editor, adapter.index(), last, true, content, text, count);
    if (!put) {
        adapter.setCursor(start);
        notifyNothingPut(adapter, last);
        return;
    }
    const putStart = ModelLivePosition.fromPosition(put, "toNext");
    adapter.replaceRange("", new VimPosition(first, 0), new VimPosition(last + 1, 0));
    setCursorOnLineOf(adapter, putStart.toPosition());
    putStart.detach();
}

/** Puts the cursor on the first character that is not a space of the line of `position`. */
function setCursorOnLineOf(adapter: VimAdapter, position: ModelPosition) {
    const { line } = adapter.locatePosition(position);
    adapter.setCursor(line, Math.max(adapter.getLine(line).search(/\S/), 0));
}

/** Says why lines were not put at line `line`, a code line that takes no widget. */
function notifyNothingPut(adapter: VimAdapter, line: number) {
    if (adapter.index().getElement(line)?.is("element", "codeBlock")) {
        adapter.host.notify(adapter.editor.t("A widget cannot be put into a code block"));
    }
}

/** Where a put goes: the version of the note, the mode and the selection, as one key. */
function getPutPlace(adapter: VimAdapter, state: vimState): string {
    const { insertMode, visualMode, visualLine } = state;
    return JSON.stringify([ adapter.editor.model.document.version, insertMode, visualMode,
        visualLine, adapter.getCursor("anchor"), adapter.getCursor("head") ]);
}

/** Puts `content` after the cursor, or before it, `count` times, with its formatting. */
function putInline(adapter: VimAdapter, content: RichContent, isAfter: boolean, count: number) {
    const model = adapter.editor.model;
    const cursor = adapter.getCursor();
    const length = adapter.getLine(cursor.line).length;
    const ch = isAfter ? Math.min(cursor.ch + 1, length) : cursor.ch;
    const position = adapter.toModelPosition(new VimPosition(cursor.line, ch));
    let end = position;
    model.change((writer) => {
        let insertAt = position;
        for (let time = 0; time < count; time++) {
            const range = model.insertContent(cloneFragment(writer, content.fragment), insertAt);
            insertAt = range.end;
            end = range.end;
        }
    });
    const last = adapter.locatePosition(end);
    adapter.setCursor(last.line, Math.max(last.ch - 1, 0));
}

function defineMotions(vim: Vim, motions: Motions) {
    // `{count}%` goes that far into the note, and `%` alone to the matching bracket.
    vim.defineMotion("triliumPercent", (cm, head, motionArgs) => {
        if (!motionArgs.repeatIsExplicit) {
            return motions.moveToMatchedSymbol(cm, head);
        }
        if (motionArgs.repeat > 100) {
            return null;
        }
        const line = Math.ceil(motionArgs.repeat * cm.lineCount() / 100) - 1;
        motionArgs.linewise = true;
        return new VimPosition(line, Math.max(cm.getLine(line).search(/\S/), 0));
    });

    // `h`, `l` and the operators on characters take an emoji or an accented letter as one. `h` and
    // `l` stop the macro being played at the edge of the line, as in Vim.
    vim.defineMotion("moveByCharacters", (cm, head, motionArgs, state, inputState) => {
        const text = cm.getLine(head.line);
        const isForward = !!motionArgs.forward;
        let ch = head.ch;
        // The steps stop one past the edge of the line, however large the count.
        for (let step = 0; step < motionArgs.repeat && ch >= 0 && ch <= text.length; step++) {
            ch = toCharacterEdge(text, ch + (isForward ? 1 : -1), isForward);
        }
        const isAtEdge = isForward ? ch > Math.max(text.length - 1, 0) : head.ch <= 0;
        if (isAtEdge && !state.visualMode && !inputState.operator) {
            stopMacro(vim);
        }
        return new VimPosition(head.line, ch);
    });

    // A count of lines from the last line takes none, as in Vim: `2dd` there does nothing.
    vim.defineMotion("expandToLine", function (this: Motions, cm, head, motionArgs) {
        if (motionArgs.repeat > 1 && head.line >= cm.lastLine()) {
            return null;
        }
        return motions.expandToLine.call(this, cm, head, motionArgs);
    });

    // `j`, `k` and the other line motions stop the macro being played at the first or last line.
    // As in Vim, an operator takes the lines up to the edge of the note with a count that passes
    // it, and none when the cursor is on the edge.
    vim.defineMotion("moveByLines", function (
        this: Motions, cm, head, motionArgs, state, inputState
    ) {
        isColumnMotion = !!inputState.operator;
        const isMove = !!(motionArgs.repeat + (motionArgs.repeatOffset ?? 0));
        const isAtEdge = motionArgs.forward ? head.line >= cm.lastLine() : head.line <= 0;
        if (isMove && isAtEdge && inputState.operator) {
            stopMacro(vim);
            return null;
        }
        const found = motions.moveByLines.call(this, cm, head, motionArgs, state);
        if (isMove && found.line === head.line) {
            stopMacro(vim);
        }
        const line = Math.min(Math.max(found.line, 0), cm.lastLine());
        return line === found.line ? found : new VimPosition(line, found.ch);
    });

    // An operator with `)` in the last sentence of the note takes its last character too, as the
    // cursor of Vim goes past it.
    vim.defineMotion("moveBySentence", function (
        this: Motions, cm, head, motionArgs, state, inputState
    ) {
        const found = motions.moveBySentence.call(this, cm, head, motionArgs);
        if (!inputState.operator || !motionArgs.forward || found.line !== cm.lastLine()) {
            return found;
        }
        const text = cm.getLine(found.line);
        const isMoved = found.line !== head.line || found.ch !== head.ch;
        const isSentenceStart = isMoved && /[.!?][)\]"']*\s+$/u.test(text.slice(0, found.ch));
        const isLastCharacter = !text.slice(found.ch + 1).trim();
        return isLastCharacter && !isSentenceStart
            ? new VimPosition(found.line, text.length)
            : found;
    });

    // The engine keeps the second half of a character of two units, such as an emoji, as the
    // character to find: the search starts after the character at the cursor, and the cursor goes
    // to the first half of the character found.
    for (const name of CHARACTER_SEARCHES) {
        const search: (cm: CodeMirrorV, head: Pos, motionArgs: MotionArgs) => Pos | null =
            motions[name];
        vim.defineMotion(name, function (this: Motions, cm, head, motionArgs) {
            const character = name === "repeatLastCharacterSearch"
                ? vim.getVimGlobalState_().lastCharacterSearch.selectedCharacter
                : motionArgs.selectedCharacter;
            if (!isLowSurrogateHalf(character as string)) {
                return search.call(this, cm, head, motionArgs);
            }
            const text = cm.getLine(head.line);
            const start = isHighSurrogateHalf(text.charAt(head.ch))
                ? new VimPosition(head.line, head.ch + 1)
                : head;
            const found = search.call(this, cm, start, motionArgs);
            if (!found || found === start) {
                return found && head;
            }
            const isOnCharacter = text.charAt(found.ch) === character
                || (isHighSurrogateHalf(text.charAt(found.ch))
                    && text.charAt(found.ch + 1) === character);
            return isOnCharacter ? new VimPosition(found.line, found.ch - 1) : found;
        });
    }

    vim.defineMotion("moveByParagraph", (cm, head, motionArgs) =>
        findStructuralBlock(cm as unknown as VimAdapter, head, motionArgs.repeat,
            !!motionArgs.forward));

    vim.defineMotion("triliumParagraphObject",
        (cm, head, motionArgs: MotionArgs, state: vimState, inputState: InputStateInterface) => {
            const adapter = cm as unknown as VimAdapter;
            const isChange = !!inputState.operator && inputState.operator !== "yank";
            const span = findParagraphObject(adapter, head.line, motionArgs.repeat,
                !!motionArgs.textObjectInner, isChange);
            motionArgs.linewise = true;
            if (state.visualMode && !state.visualLine) {
                state.visualLine = true;
                VimAdapter.signal(adapter, "vim-mode-change",
                    { mode: "visual", subMode: "linewise" });
            }
            return [ new VimPosition(span.first, 0), new VimPosition(span.last, 0) ];
        });

    vim.defineMotion("triliumHeading", (cm, head, motionArgs) => {
        const line = findHeading(cm as unknown as VimAdapter, head.line, motionArgs.repeat,
            !!motionArgs.forward);
        return line === null ? head : new VimPosition(line, 0);
    });

    vim.defineMotion("triliumSectionEnd", (cm, head, motionArgs) => {
        const adapter = cm as unknown as VimAdapter;
        let line = head.line;
        for (let time = 0; time < motionArgs.repeat; time++) {
            line = findSectionEnd(adapter, line, !!motionArgs.forward);
        }
        return new VimPosition(line, 0);
    });

    vim.defineMotion("triliumSectionEdge", (cm, head, motionArgs) => {
        const line = findSectionEdge(cm as unknown as VimAdapter, head.line, !!motionArgs.forward);
        return new VimPosition(line, 0);
    });
    vim.defineMotion("moveByDisplayLines", moveByDisplayLines);
}

/** `gj` and `gk`: moves by lines on the screen, which the browser lays out. */
function moveByDisplayLines(
    this: Record<string, unknown>, cm: CodeMirrorV, head: Pos, motionArgs: MotionArgs,
    state: vimState
): Pos {
    const adapter = cm as unknown as VimAdapter;
    const verticalMotions = [
        this.moveByDisplayLines, this.moveByScroll, this.moveByLines, this.moveToColumn,
        this.moveToEol
    ];
    if (!verticalMotions.includes(state.lastMotion)) {
        state.lastHSPos = adapter.charCoords(head).left;
    }
    let current: Pos = head;
    for (let step = 0; step < Math.round(motionArgs.repeat); step++) {
        const isDown = !!motionArgs.forward;
        const next = adapter.findPositionOnScreenLine(current, isDown, state.lastHSPos)
            ?? new VimPosition(current.line + (isDown ? 1 : -1), current.ch);
        if (next.line < 0 || next.line > adapter.lastLine()) {
            break;
        }
        current = next;
    }
    if (current !== head) {
        state.lastHPos = current.ch;
    }
    return current;
}

/**
 * The number at or after column `ch` of `text`, a hexadecimal, a binary or a decimal one, and
 * where it starts. Only a decimal number takes the minus sign before it.
 */
function findNumber(text: string, ch: number): { start: number; text: string } | null {
    for (const match of text.matchAll(/(-?)(0[xX][\da-fA-F]+|0[bB][01]+|\d+)/gu)) {
        const [ whole, sign, digits ] = match;
        if (match.index + whole.length > ch) {
            return /^0[xXbB]/u.test(digits)
                ? { start: match.index + sign.length, text: digits }
                : { start: match.index, text: whole };
        }
    }
    return null;
}

/**
 * `number`, which `findNumber()` found, with `step` added. A number that starts with 0 keeps its
 * width, and a hexadecimal one the case of its last letter. Hexadecimal and binary numbers are
 * unsigned numbers of 64 bits, as in Vim.
 */
function addToNumber(number: string, step: number): string {
    const prefixed = /^0([xXbB])(.+)$/u.exec(number);
    if (!prefixed) {
        const value = Number(number) + step;
        const digits = number.replace("-", "");
        const width = digits.startsWith("0") ? digits.length : 0;
        return `${value < 0 ? "-" : ""}${String(Math.abs(value)).padStart(width, "0")}`;
    }
    const [ , kind, digits ] = prefixed;
    const size = 2n ** 64n;
    const value = ((BigInt(`0${kind.toLowerCase()}${digits}`) + BigInt(step)) % size + size) % size;
    const result = value.toString(/x/iu.test(kind) ? 16 : 2).padStart(digits.length, "0");
    const isUpperCase = /[A-F]/u.test(digits.match(/[a-f]/giu)?.at(-1) ?? "");
    return `0${kind}${isUpperCase ? result.toUpperCase() : result}`;
}

/** The line before the next heading after `line`, or before the heading before it. */
function findSectionEnd(adapter: VimAdapter, line: number, isForward: boolean): number {
    if (isForward) {
        const next = findHeading(adapter, line + 1, 1, true);
        return next === null ? adapter.lastLine() : next - 1;
    }
    const previous = findHeading(adapter, line, 1, false);
    return previous === null ? 0 : Math.max(previous - 1, 0);
}

function defineActions(vim: Vim) {
    // `Ctrl+A` and `Ctrl+X` read a number that starts with 0 as a decimal one, as Vim does by
    // default, and keep the width of a number with leading zeros.
    vim.defineAction("incrementNumberToken", (cm, actionArgs) => {
        const adapter = cm as unknown as VimAdapter;
        const cursor = adapter.getCursor();
        const found = findNumber(adapter.getLine(cursor.line), cursor.ch);
        if (!found) {
            return;
        }
        const text = addToNumber(found.text, (actionArgs.increase ? 1 : -1) * actionArgs.repeat);
        adapter.replaceRange(text, new VimPosition(cursor.line, found.start),
            new VimPosition(cursor.line, found.start + found.text.length));
        adapter.setCursor(cursor.line, found.start + text.length - 1);
    });
    vim.defineAction("triliumFold", (cm, actionArgs) => {
        const adapter = cm as unknown as VimAdapter;
        const { fold: action, isNested } = actionArgs as ActionArgs & FoldArgs;
        if (!fold(adapter, adapter.getCursor().line, action, isNested)) {
            adapter.host.notify(adapter.editor.t("Nothing to fold here"));
        }
    });
    vim.defineAction("triliumFollowLink", (cm) => (cm as unknown as VimAdapter).host.followLink());
    vim.defineAction("triliumQuit", (cm) => (cm as unknown as VimAdapter).host.closeTab());
    vim.defineAction("triliumDiscard", (cm) => notifyNothingToDiscard(cm as unknown as VimAdapter));
    vim.defineAction("triliumNoBlockMode", (cm) => {
        const adapter = cm as unknown as VimAdapter;
        adapter.host.notify(adapter.editor.t("Visual block mode is not available in text notes"));
    });
}

function defineExCommands(vim: Vim, exCommands: ExCommands, actions: Actions) {
    const substitute = exCommands.substitute;
    exCommands.substitute = function (this: unknown, cm, params) {
        const adapter = cm as unknown as VimAdapter;
        const [ pattern, , flags ] = params.argString ? splitSubstitute(params.argString) : [];
        if (!pattern && !vim.getVimGlobalState_().query) {
            adapter.host.notify(adapter.editor.t("No previous regular expression"));
            return;
        }
        if (pattern && vim.getOption("pcre") && !isRegExp(pattern)) {
            adapter.host.notify(adapter.editor.t("Invalid regex: %0", [ pattern ]));
            return;
        }
        if (flags && !/^[&cegiInp#lr]*\s*\d*\s*$/u.test(flags)) {
            adapter.host.notify(adapter.editor.t("Trailing characters: %0", [ flags.trim() ]));
            return;
        }
        substitute.call(this, cm, { ...params, argString: toEngineReplacement(params.argString) });
    };
    const global = exCommands.global;
    exCommands.global = function (this: unknown, cm, params) {
        const adapter = cm as unknown as VimAdapter;
        const argString = params.argString?.replace(/^!/u, "");
        if (argString?.startsWith("/") && !splitSubstitute(argString)[0]
            && !vim.getVimGlobalState_().query) {
            adapter.host.notify(adapter.editor.t("No previous regular expression"));
            return;
        }
        global.call(this, cm, params);
    };
    const normal = exCommands.normal;
    exCommands.normal = function (this: unknown, cm, params) {
        if (!params.argString?.replace(/^!/u, "").trim()) {
            const adapter = cm as unknown as VimAdapter;
            adapter.host.notify(adapter.editor.t("Argument required"));
            return;
        }
        normal.call(this, cm, params);
    };
    // `:join` joins the lines of its range, or the line with the next one, and nothing with a
    // range of one line.
    exCommands.join = (cm, params) => {
        const line = params.selectionLine as number;
        const lineEnd = params.selectionLineEnd;
        const joins = lineEnd === undefined ? 1 : lineEnd - line;
        if (joins) {
            cm.setCursor(new VimPosition(line, 0));
            const joinArgs = { repeat: joins + 1, keepSpaces: !!params.argString?.startsWith("!") };
            actions.joinLines(cm, joinArgs as ActionArgs, cm.state.vim);
        }
    };

    const save = (cm: CodeMirrorV) => (cm as unknown as VimAdapter).host.save();
    const quit = (cm: CodeMirrorV, params: ExParams) => {
        const adapter = cm as unknown as VimAdapter;
        if (params.argString?.trim().startsWith("!")) {
            notifyNothingToDiscard(adapter);
            return;
        }
        adapter.host.closeTab();
    };
    vim.defineEx("write", "w", save);
    vim.defineEx("quit", "q", quit);
    vim.defineEx("wq", "wq", (cm, params) => quit(cm, { ...params, argString: "" }));
    vim.defineEx("xit", "x", (cm, params) => quit(cm, { ...params, argString: "" }));
    vim.defineEx("ck", "ck", (cm, params) => runEditorCommand(cm as unknown as VimAdapter, params));
    vim.defineEx("sort", "sor", (cm, params) =>
        sortLines(cm as unknown as VimAdapter, params.line, params.lineEnd, params.argString));
    for (const [ name, shortName, context ] of [
        [ "mapclear", "mapc", undefined ], [ "nmapclear", "nmapc", "normal" ],
        [ "vmapclear", "vmapc", "visual" ], [ "imapclear", "imapc", "insert" ],
        [ "omapclear", "omapc", "operatorPending" ]
    ] as const) {
        vim.defineEx(name, shortName, () => {
            vim.mapclear(context);
            addTriliumKeys(vim);
        });
    }
}

/**
 * The arguments of `:s` with the replacement in the syntax of the engine, which takes `&` for the
 * whole match: `$&` is the whole match and `&` is itself, as in JavaScript.
 */
function toEngineReplacement(argString: string): string {
    if (!argString) {
        return argString;
    }
    const separator = argString.charAt(0);
    let part = 0;
    let result = separator;
    for (let index = 1; index < argString.length; index++) {
        const character = argString.charAt(index);
        if (character === "\\") {
            result += argString.slice(index, index + 2);
            index++;
        } else {
            part += character === separator ? 1 : 0;
            result += character === "&" && part === 1 ? "\\&" : character;
        }
    }
    return result;
}

/**
 * The parts of `argString`, the arguments of `:s` or `:g`, between the separators, the first
 * character being one, as the engine splits them: the pattern, the replacement and the flags.
 */
function splitSubstitute(argString: string): string[] {
    const separator = argString.charAt(0);
    const parts = [ "" ];
    for (let index = 1; index < argString.length; index++) {
        const character = argString.charAt(index);
        if (character === separator) {
            parts.push("");
            continue;
        }
        const escaped = character === "\\" ? argString.slice(index, index + 2) : character;
        parts[parts.length - 1] += escaped;
        index += escaped.length - 1;
    }
    return parts;
}

/** Whether `pattern` is a regular expression of JavaScript. */
function isRegExp(pattern: string): boolean {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

/**
 * Runs the editor command of `:ck`, named by the first argument, with the rest of the arguments as
 * its value. With a range, the command acts on its lines, or on the Visual selection it came from.
 */
function runEditorCommand(adapter: VimAdapter, params: ExParams) {
    const editor = adapter.editor;
    const [ name, ...rest ] = params.args ?? [];
    if (!name) {
        adapter.host.notify(editor.t("Type the name of an editor command after :ck"));
        return;
    }
    const command = editor.commands.get(name);
    if (!command) {
        adapter.host.notify(editor.t("Not an editor command: %0", [ name ]));
        return;
    }
    const range = params.line === undefined
        ? null
        : getCommandRange(adapter, params.line, params.lineEnd ?? params.line);
    if (range) {
        adapter.setSelection(range.from, range.to);
    }
    if (command.isEnabled) {
        const notifyFailure = () =>
            adapter.host.notify(editor.t("The editor command %0 failed", [ name ]));
        const value = rest.join(" ");
        const toArguments = COMMAND_ARGUMENTS[name] ?? ((each: string) => [ { value: each } ]);
        try {
            const result: unknown = editor.execute(name, ...(value ? toArguments(value) : []));
            if (result instanceof Promise) {
                result.catch(notifyFailure);
            }
        } catch {
            notifyFailure();
        }
    } else {
        adapter.host.notify(editor.t("The editor command %0 is not available here", [ name ]));
    }
    if (range) {
        adapter.setCursor(range.from);
    }
}

/** The text of the lines from `line` to `lineEnd`, or of the Visual selection that covered them. */
function getCommandRange(
    adapter: VimAdapter, line: number, lineEnd: number
): { from: Pos; to: Pos } {
    const last = adapter.state.vim?.lastSelection;
    const anchor = last?.anchorMark.find();
    const head = last?.headMark.find();
    const first = Math.min(line, lineEnd);
    const end = Math.max(line, lineEnd);
    if (last && anchor && head && !last.visualLine
        && Math.min(anchor.line, head.line) === first && Math.max(anchor.line, head.line) === end) {
        const [ start, stop ] = [ anchor, head ].sort((a, b) => a.line - b.line || a.ch - b.ch);
        return { from: start, to: new VimPosition(stop.line, stop.ch + 1) };
    }
    const to = new VimPosition(end, adapter.getLine(end).length);
    return { from: new VimPosition(first, 0), to };
}

function notifyNothingToDiscard(adapter: VimAdapter) {
    adapter.host.notify(adapter.editor.t("Nothing to discard: notes are saved as you type"));
}

/** Whether the range from `from` to `to` covers widget lines only. */
function isOnlyWidgets(adapter: VimAdapter, from: Pos, to: Pos): boolean {
    const index = adapter.index();
    const [ start, end ] = [ from, to ].sort((a, b) => a.line - b.line || a.ch - b.ch);
    const last = end.ch === 0 && end.line > start.line ? end.line - 1 : end.line;
    for (let line = start.line; line <= Math.min(last, index.lastLine); line++) {
        if (index.lines[line]?.kind !== "object") {
            return false;
        }
    }
    return true;
}

/**
 * Plays macros. `@@` does nothing before a macro ran. A macro that calls a macro with its last keys
 * goes on to that macro rather than holding it in a call, so that one that calls itself, as a
 * macro repeated up to a motion that fails does, plays in a loop. The calls stop after
 * `MAX_MACRO_CALLS` macros, or `MAX_NESTED_MACROS` macros played one inside the other.
 */
function defineMacroReplay(vim: Vim, actions: Actions) {
    const replayMacro = actions.replayMacro;
    vim.defineAction("replayMacro", function (this: Actions, cm, actionArgs, state) {
        const adapter = cm as unknown as VimAdapter;
        const macroState = vim.getVimGlobalState_().macroModeState;
        const name = actionArgs.selectedCharacter === "@"
            ? macroState.latestRegister
            : actionArgs.selectedCharacter;
        // The register being recorded holds nothing to play until the recording ends, as in Vim.
        const isRecorded = macroState.isRecording && name === macroState.latestRegister;
        if (!name || isRecorded) {
            return;
        }
        const repeat = actionArgs.repeat;
        const outer = macroRuns.at(-1);
        if (outer && !outer.keysLeft) {
            outer.next = { name, repeat };
            return;
        }
        if (macroRuns.length >= MAX_NESTED_MACROS) {
            stopMacroCalls(adapter);
            return;
        }
        const queue = [ { name, repeat } ];
        let calls = 0;
        while (queue.length) {
            const call = queue[queue.length - 1];
            if (!call.repeat) {
                queue.pop();
                continue;
            }
            call.repeat--;
            if (++calls > MAX_MACRO_CALLS) {
                stopMacroCalls(adapter);
                return;
            }
            const run: MacroRun = { keysLeft: countMacroKeys(vim, call.name), next: null };
            macroRuns.push(run);
            try {
                playRegister(vim, call.name, run.keysLeft, () => replayMacro.call(this, cm,
                    { ...actionArgs, selectedCharacter: call.name, repeat: 1 }, state));
            } finally {
                macroRuns.pop();
            }
            if (run.next) {
                queue.push(run.next);
            }
        }
    });
}

/**
 * Plays register `name`, which has `keyCount` keys, with `play`. A register of text, which no
 * recording filled, has no typing for the keys that enter Insert mode, which then type nothing.
 */
function playRegister(vim: Vim, name: string, keyCount: number, play: () => void) {
    const register = vim.getRegisterController().getRegister(name);
    const recorded = register.insertModeChanges;
    const nothing = Array.from({ length: keyCount }, () => ({ changes: [] }));
    register.insertModeChanges = [ ...recorded, ...nothing ] as typeof recorded;
    try {
        play();
    } finally {
        register.insertModeChanges = recorded;
    }
}

/** The number of keys that playing register `name` presses, as the engine splits them. */
function countMacroKeys(vim: Vim, name: string): number {
    if (name === ":") {
        return 0;
    }
    const register = vim.getRegisterController().getRegister(name);
    return register.keyBuffer.reduce((count, text) =>
        count + [ ...text.matchAll(/<(?:[CSMA]-)*\w+>|./gi) ].length, 0);
}

/** Stops the macros being played, which called macros too many times, with a message. */
function stopMacroCalls(adapter: VimAdapter) {
    adapter.host.notify(adapter.editor.t("The macro called itself too many times"));
    isMacroStopped = true;
}

/**
 * Skips the keys of a macro once one of its motions failed, until the next key of the user, and
 * counts the keys of the macro being played.
 */
function stopMacrosAtFailures(vim: Vim) {
    const handleKey = vim.handleKey.bind(vim);
    vim.handleKey = (cm, key, origin) => {
        if (origin !== "macro") {
            isMacroStopped = false;
        } else {
            // Only the macros that `defineMacroReplay()` plays press keys of a macro.
            (macroRuns.at(-1) as MacroRun).keysLeft--;
            if (isMacroStopped) {
                return true;
            }
        }
        return handleKey(cm, key, origin);
    };
}

/**
 * Keeps track of the keys that `:map`, `:unmap` and `:mapclear` and their variants map, which the
 * engine keeps in a list of its own.
 */
function recordMappings(vim: Vim, exCommands: ExCommands) {
    type MapCommand =
        (cm: CodeMirrorV, params: ExParams, context?: string, ...rest: unknown[]) => void;
    const getKeys = (context: string | undefined) => {
        const key = (context ?? "all") as VimKeyContext | "all";
        let keys = userMappings.get(key);
        if (!keys) {
            keys = new Set();
            userMappings.set(key, keys);
        }
        return keys;
    };
    // The target is the rest of the line, spaces included, as `:nmap gb :ck bold<CR>` has it.
    const map = exCommands.map as MapCommand;
    exCommands.map = function (this: unknown, cm, params, ...rest: unknown[]) {
        const [ lhs = "" ] = params.args ?? [];
        const rhs = lhs ? (params.argString as string).trim().slice(lhs.length).trimStart() : "";
        map.call(this, cm, { ...params, args: rhs ? [ lhs, rhs ] : params.args },
            ...rest as [ string | undefined ]);
        if (rhs) {
            getKeys(rest[0] as string | undefined).add(lhs);
        }
    } as ExCommand;
    const unmap = exCommands.unmap as MapCommand;
    exCommands.unmap = function (this: unknown, cm, params, ...rest: unknown[]) {
        unmap.call(this, cm, params, ...rest as [ string | undefined ]);
        const lhs = params.args?.[0];
        if (lhs) {
            getKeys(rest[0] as string | undefined).delete(lhs);
        }
    } as ExCommand;
    const mapclear = vim.mapclear.bind(vim);
    vim.mapclear = (context?: string) => {
        mapclear(context);
        const everyMode = userMappings.get("all");
        if (!context) {
            userMappings.clear();
            return;
        }
        userMappings.delete(context as VimKeyContext);
        userMappings.delete("all");
        // A mapping of every mode stays in the other modes, as the engine copies it there.
        if (!everyMode) {
            return;
        }
        for (const other of [ "normal", "visual", "insert" ].filter((each) => each !== context)) {
            for (const keys of everyMode) {
                getKeys(other).add(keys);
            }
        }
    };
}

/** Stops the macro being played, after a motion that cannot move. */
function stopMacro(vim: Vim) {
    if (vim.getVimGlobalState_().macroModeState.isPlaying) {
        isMacroStopped = true;
    }
}

/**
 * Keeps the rich content of what a register command read with each register it sets, and sends
 * the clipboard registers `"+` and `"*` to the system clipboard.
 */
function wrapRegisters(vim: Vim) {
    const controller = vim.getRegisterController();
    const RegisterClass = controller.getRegister("+").constructor as new () => Register;
    vim.defineRegister("*", new RegisterClass());

    const pushText = controller.pushText.bind(controller);
    controller.pushText = (registerName, operator, text, isLinewise, isBlockwise) => {
        const adapter = getActiveAdapter() as VimAdapter;
        const content = adapter.takeReadContent(text, !!isLinewise);
        const stored = isLinewise && !text.endsWith("\n") ? `${text}\n` : text;
        const buffers = new Map(Object.values(controller.registers)
            .map((register) => [ register, register.keyBuffer ]));
        if (registerName === "+" || registerName === "*") {
            controller.getRegister(registerName).setText(stored, isLinewise, isBlockwise);
            controller.unnamedRegister.setText(stored, isLinewise);
            writeClipboard(adapter, stored, content);
        } else {
            pushText(registerName, operator, text, isLinewise, isBlockwise);
        }
        if (!content) {
            return;
        }
        // The registers that the push set to `stored`, which the engine gives new buffers.
        for (const register of Object.values(controller.registers)) {
            if (register.keyBuffer !== buffers.get(register) && register.toString() === stored) {
                rememberRichContent(register, content);
            }
        }
    };
}

/** Copies `text`, with the formatting of `content`, to the system clipboard. */
function writeClipboard(adapter: VimAdapter, text: string, content: RichContent | null) {
    const html = content ? adapter.editor.data.stringify(content.fragment) : null;
    adapter.host.writeClipboard(text.replaceAll(OBJECT_CHARACTER, ""), html);
}

/** The text of the system clipboard, or what `register` holds when the clipboard cannot be read. */
async function readClipboard(adapter: VimAdapter, register: Register): Promise<string> {
    try {
        const text = await adapter.host.readClipboard();
        if (typeof text === "string") {
            // Setting the same text again gives the register a new buffer, without rich content.
            if (text !== register.toString()) {
                register.setText(text, text.endsWith("\n"));
            }
            return text;
        }
    } catch {
        // The clipboard cannot be read outside a secure context, so the register is put instead.
    }
    return register.toString();
}

function foldKey(keys: string, fold: FoldAction, isNested: boolean): vimKey {
    const actionArgs = { fold, isNested } as unknown as ActionArgsPartial;
    return { keys, type: "action", action: "triliumFold", actionArgs };
}

