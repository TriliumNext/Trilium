import {
    type CompletionRow, type EditorCommandInfo, fillIn, getArgumentRows, getCommandLineHints,
    getCommandRows, parseCommandLine
} from "./vim_completion.js";
import {
    getConfirmHints, getSearchHints, HINT_PAUSE, type Translate, type VimHint
} from "./vim_hints.js";

/** The prompts of the command line: `:`, `/` and `?`, the confirmation of `:s///c`, and others. */
export type PromptKind = "command" | "search" | "confirm" | "other";

/** What a prompt needs from the Vim mode of its editor. */
export interface PromptHost {
    translate: Translate;
    /** Whether the completion list opens after a pause, without `Tab`. */
    areHintsEnabled(): boolean;
    /** Whether a search reads its pattern as a JavaScript regular expression. */
    isJavaScriptRegex(): boolean;
    getEditorCommands(): EditorCommandInfo[];
    /** Shows `hints` at the right end of the command line. */
    showHints(hints: VimHint[]): void;
}

/** The engine writes the prompt of `:s///c` as "replace with … (y/n/a/q/l)". */
const CONFIRM_PROMPT = /^replace with .*\(y\/n\/a\/q\/l\)$/su;

let listCount = 0;

/** The kind of the prompt that the engine opens with `prefix`. */
export function getPromptKind(prefix: string): PromptKind {
    if (prefix === ":") {
        return "command";
    }
    if (prefix === "/" || prefix === "?") {
        return "search";
    }
    return CONFIRM_PROMPT.test(prefix) ? "confirm" : "other";
}

/**
 * Assists a prompt of the command line: hints at its right end, and for `:` a list of the commands
 * and arguments that complete the text. The list opens after a pause or on `Tab`; `Tab`,
 * `Shift+Tab`, `↓` and `↑` walk it. `Enter` runs the text in the prompt, never a row.
 */
export class PromptAssistant {

    private list: HTMLElement | null = null;
    private rows: CompletionRow[] = [];
    private areArgumentRows = false;
    private selected = -1;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private text: string | null = null;
    /** The text of the prompt after the last `input` event, which the user's edits fire. */
    private typedText = "";
    /** Whether the last `↑` or `↓` brought back an earlier command. */
    private isRecalling = false;
    private isDestroyed = false;
    private readonly listId = `ck-vim-completion-${++listCount}`;

    constructor(
        private readonly kind: PromptKind,
        private readonly input: HTMLInputElement,
        private readonly element: HTMLElement,
        private readonly host: PromptHost
    ) {
        if (kind === "command") {
            input.setAttribute("aria-autocomplete", "list");
            input.setAttribute("aria-expanded", "false");
        }
    }

    /** Follows the text of the prompt, after it changed or when the prompt opens. */
    update() {
        const text = this.input.value;
        if (text === this.text || this.isDestroyed) {
            return;
        }
        this.text = text;
        const t = this.host.translate;
        switch (this.kind) {
            case "confirm":
                this.host.showHints(getConfirmHints(t));
                return;
            case "search":
                this.host.showHints(getSearchHints(text, this.host.isJavaScriptRegex(), t));
                return;
            case "command":
                this.host.showHints(getCommandLineHints(parseCommandLine(text), t));
                if (this.list) {
                    this.openList();
                } else {
                    this.waitForPause();
                }
                return;
            default:
                this.host.showHints([]);
        }
    }

    /** Follows an edit of the prompt by the user. */
    onInput() {
        this.typedText = this.input.value;
        this.isRecalling = false;
        this.update();
    }

    /**
     * Takes `Tab`, `Shift+Tab`, `↓` and `↑` in the prompt of `:`. Returns whether it took the key;
     * an arrow it leaves brings back an earlier command.
     */
    onKeyDown(event: KeyboardEvent): boolean {
        if (this.kind !== "command" || event.ctrlKey || event.altKey || event.metaKey) {
            return false;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            if (!this.list) {
                this.openList();
            }
            this.walk(event.shiftKey ? -1 : 1);
            return true;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" || event.shiftKey) {
            return false;
        }
        const isDown = event.key === "ArrowDown";
        if (!this.isWalkedByArrow(isDown)) {
            this.isRecalling = true;
            return false;
        }
        event.preventDefault();
        this.walk(isDown ? 1 : -1);
        return true;
    }

    destroy() {
        this.isDestroyed = true;
        this.clearTimer();
        this.closeList();
    }

    /** Opens the list after a pause, unless the hints are off. */
    private waitForPause() {
        this.clearTimer();
        if (this.host.areHintsEnabled()) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.openList();
            }, HINT_PAUSE);
        }
    }

    private clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Whether `↓` (`isDown`) or `↑` walks the open list. Until the user types or selects a row, `↑`
     * brings back earlier commands, as in Vim, and so does `↓` after it.
     */
    private isWalkedByArrow(isDown: boolean): boolean {
        if (!this.list) {
            return false;
        }
        const value = this.input.value;
        const isTyped = value !== "" && value === this.typedText;
        return this.selected !== -1 || isTyped || isDown && !this.isRecalling;
    }

    /** Selects the next row, or the previous one for a negative `step`, wrapping at the ends. */
    private walk(step: 1 | -1) {
        const count = this.rows.length;
        if (count) {
            const start = this.selected === -1 && step < 0 ? count : this.selected;
            this.select((start + step + count) % count);
        }
    }

    /** Shows the rows for the text typed, or closes the list once the name is complete. */
    private openList() {
        this.clearTimer();
        const parts = parseCommandLine(this.input.value);
        const t = this.host.translate;
        const argumentRows = getArgumentRows(parts, t, () => this.host.getEditorCommands());
        const rows = argumentRows ?? (parts.rest ? [] : getCommandRows(parts, t));
        if (!rows.length) {
            this.closeList();
            return;
        }
        this.rows = rows;
        this.areArgumentRows = !!argumentRows;
        this.selected = -1;
        this.renderList();
    }

    /** Selects the row at `index` and writes it in the prompt, as `Tab` does. */
    private select(index: number) {
        const row = this.rows[index];
        if (!row || row.isMuted && !this.areArgumentRows) {
            return;
        }
        this.selected = index;
        this.isRecalling = false;
        this.input.value = fillIn(this.input.value, row.value, this.areArgumentRows);
        this.text = this.input.value;
        this.host.showHints(
            getCommandLineHints(parseCommandLine(this.input.value), this.host.translate));
        const list = this.list as HTMLElement;
        for (const [ rowIndex, element ] of [ ...list.children ].entries()) {
            element.setAttribute("aria-selected", String(rowIndex === index));
        }
        const selectedElement = list.children[index] as HTMLElement;
        this.input.setAttribute("aria-activedescendant", selectedElement.id);
        selectedElement.scrollIntoView?.({ block: "nearest" });
    }

    private renderList() {
        const list = this.list ?? document.createElement("div");
        if (!this.list) {
            list.className = "ck-vim-completion";
            list.id = this.listId;
            list.setAttribute("role", "listbox");
            list.addEventListener("mousedown", (event) => event.preventDefault());
            document.body.append(list);
            this.list = list;
            this.input.setAttribute("aria-controls", this.listId);
            this.input.setAttribute("aria-expanded", "true");
        }
        list.replaceChildren(...this.rows.map((row, index) => this.createRow(row, index)));
        this.input.removeAttribute("aria-activedescendant");
        const rect = this.element.getBoundingClientRect();
        list.style.left = `${rect.left}px`;
        list.style.bottom = `${window.innerHeight - rect.top}px`;
    }

    private createRow(row: CompletionRow, index: number): HTMLElement {
        const element = document.createElement("div");
        element.className = "ck-vim-completion__row";
        element.classList.toggle("ck-vim-completion__row_muted", !!row.isMuted);
        element.id = `${this.listId}-${index}`;
        element.setAttribute("role", "option");
        element.setAttribute("aria-selected", "false");
        const name = document.createElement("span");
        name.className = "ck-vim-completion__name";
        name.textContent = row.label;
        element.append(name);
        if (row.summary) {
            const summary = document.createElement("span");
            summary.className = "ck-vim-completion__summary";
            summary.textContent = row.summary;
            element.append(summary);
        }
        if (row.isDefault) {
            const mark = document.createElement("span");
            mark.className = "ck-vim-completion__default";
            mark.textContent = "⏎";
            element.append(mark);
        }
        element.addEventListener("click", () => this.select(index));
        return element;
    }

    private closeList() {
        this.list?.remove();
        this.list = null;
        this.rows = [];
        this.selected = -1;
        if (this.kind === "command") {
            this.input.setAttribute("aria-expanded", "false");
            this.input.removeAttribute("aria-controls");
            this.input.removeAttribute("aria-activedescendant");
        }
    }
}
