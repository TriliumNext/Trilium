import type {
    ActionArgs, ActionArgsPartial, CodeMirrorV, ExParams, InputStateInterface, MotionArgs,
    OperatorFn, Pos, Vim, vimActions, vimKey, vimMotions, vimState
} from "@replit/codemirror-vim-core";
import {
    isHighSurrogateHalf, isLowSurrogateHalf, type ModelElement, type ModelPosition
} from "ckeditor5";

import VimAdapter, { getActiveAdapter, VimPosition } from "./vim_adapter.js";
import { joinLine, openLine, setTypingFormatting } from "./vim_editing.js";
import { OBJECT_CHARACTER, toCharacterEdge } from "./vim_lines.js";
import {
    cloneFragment, getRichContent, putLines, rememberRichContent, type RichContent
} from "./vim_registers.js";
import { sortLines } from "./vim_sort.js";
import {
    findHeading, findParagraphObject, findSectionEdge, findStructuralBlock, fold, type FoldAction
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
    defineMotions(vim, builtIns.motions);
    defineActions(vim);
    defineExCommands(vim, builtIns.exCommands);
    addTriliumKeys(vim);
    wrapRegisters(vim);
    stopMacrosAtFailures(vim);
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
            void readClipboard(adapter, register).then((text) => {
                // Vim mode can be off by the time the clipboard is read.
                if (adapter.state.vim) {
                    adapter.operation(() => put(adapter, this, actionArgs, state, register, text));
                }
            });
            return;
        }
        put(adapter, this, actionArgs, state, register, register.toString());
    });

    // The engine removes the last line from the end of the line before, which in a note would take
    // that line as well, so the last line goes by itself here.
    vim.defineOperator("delete", function (this: Operators, cm, args, ranges, oldAnchor, newHead) {
        const adapter = cm as unknown as VimAdapter;
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
        if (isOnlyWidgets(adapter, ranges[0].anchor, ranges[0].head)) {
            return oldAnchor;
        }
        let changed = ranges;
        if (state.visualMode && state.visualLine && args.linewise) {
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
        const result = change.call(this, cm, args, changed, oldAnchor, newHead);
        if (formatting) {
            setTypingFormatting(adapter.editor, formatting);
        }
        return result;
    });
}

/**
 * Puts `text`, which `register` holds, with the formatting it was read with when it is the text of
 * a rich content.
 */
function put(
    adapter: VimAdapter, actions: Actions, actionArgs: ActionArgs, state: vimState,
        register: Register,
    text: string
) {
    if (!text) {
        return;
    }
    // The engine names the flag of `:put` `lineWise`.
    const isLinewise = !!(actionArgs as { lineWise?: boolean }).lineWise || register.linewise;
    const content = getRichContent(text);
    if (state.visualMode) {
        actions.continuePaste(adapter as unknown as CodeMirrorV, actionArgs, state, text, register);
        return;
    }
    if (isLinewise) {
        const cursorLine = adapter.getCursor().line;
        const start = putLines(adapter.editor, adapter.index(), cursorLine,
            !!actionArgs.after, content, text, actionArgs.repeat);
        if (start) {
            const { line } = adapter.locatePosition(start);
            adapter.setCursor(line, Math.max(adapter.getLine(line).search(/\S/), 0));
        } else if (adapter.index().getElement(cursorLine)?.is("element", "codeBlock")) {
            adapter.host.notify(adapter.editor.t("A widget cannot be put into a code block"));
        }
        return;
    }
    if (content) {
        putInline(adapter, content, !!actionArgs.after, actionArgs.repeat);
        return;
    }
    actions.continuePaste(adapter as unknown as CodeMirrorV, actionArgs, state, text, register);
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
        for (let step = 0; step < motionArgs.repeat; step++) {
            ch = toCharacterEdge(text, ch + (isForward ? 1 : -1), isForward);
        }
        const isAtEdge = isForward ? ch > Math.max(text.length - 1, 0) : head.ch <= 0;
        if (isAtEdge && !state.visualMode && !inputState.operator) {
            stopMacro(vim);
        }
        return new VimPosition(head.line, ch);
    });

    // `j`, `k` and the other line motions stop the macro being played at the first or last line.
    vim.defineMotion("moveByLines", function (this: Motions, cm, head, motionArgs, state) {
        const found = motions.moveByLines.call(this, cm, head, motionArgs, state);
        if (motionArgs.repeat + (motionArgs.repeatOffset ?? 0) && found.line === head.line) {
            stopMacro(vim);
        }
        return found;
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

function defineExCommands(vim: Vim, exCommands: ExCommands) {
    const substitute = exCommands.substitute;
    exCommands.substitute = function (this: unknown, cm, params) {
        substitute.call(this, cm, { ...params, argString: toEngineReplacement(params.argString) });
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
 * Runs the editor command of `:ck`, named by the first argument, with the rest of the arguments as
 * its value. With a range, the command acts on its lines, or on the Visual selection it came from.
 */
function runEditorCommand(adapter: VimAdapter, params: ExParams) {
    const editor = adapter.editor;
    const [ name, ...rest ] = params.args ?? [];
    const command = name ? editor.commands.get(name) : undefined;
    if (!name || !command) {
        adapter.host.notify(editor.t("Not an editor command: %0", [ name ?? "" ]));
        return;
    }
    const range = params.line === undefined
        ? null
        : getCommandRange(adapter, params.line, params.lineEnd ?? params.line);
    if (range) {
        adapter.setSelection(range.from, range.to);
    }
    if (command.isEnabled) {
        editor.execute(name, ...(rest.length ? [ { value: rest.join(" ") } ] : []));
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

/** Skips the keys of a macro once one of its motions failed, until the next key of the user. */
function stopMacrosAtFailures(vim: Vim) {
    const handleKey = vim.handleKey.bind(vim);
    vim.handleKey = (cm, key, origin) => {
        if (origin !== "macro") {
            isMacroStopped = false;
        } else if (isMacroStopped) {
            return true;
        }
        return handleKey(cm, key, origin);
    };
}

/** Stops the macro being played, after a motion that cannot move. */
function stopMacro(vim: Vim) {
    if (vim.getVimGlobalState_().macroModeState.isPlaying) {
        isMacroStopped = true;
    }
}

/**
 * Keeps the rich content of what a register command read with the text it stores, and sends the
 * clipboard registers `"+` and `"*` to the system clipboard.
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
        if (registerName === "+" || registerName === "*") {
            controller.getRegister(registerName).setText(stored, isLinewise, isBlockwise);
            controller.unnamedRegister.setText(stored, isLinewise);
            writeClipboard(adapter, stored, content);
        } else {
            pushText(registerName, operator, text, isLinewise, isBlockwise);
        }
        if (content && registerName !== "_") {
            rememberRichContent(stored, content);
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
            register.setText(text, text.endsWith("\n"));
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

