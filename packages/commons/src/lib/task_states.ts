/**
 * Definition of a todo-list task state.
 *
 * States are ordered. Two of them are built-in, non-customizable **anchors**:
 * `none` (unchecked) and `done` (checked) — CKEditor's native checkbox states.
 * They exist as notes only so the user can position them relative to the
 * customizable states for toolbar order and keyboard cycling.
 */
export interface TaskStateDef {
    /** The state note's id (used in validation messages; absent on hardcoded fallbacks). */
    id?: string;
    /** The `stateId` label value — used verbatim as the `data-trilium-task-state` attribute. */
    name: string;
    /** Human-readable display name (the state note's title). */
    title: string;
    /** Single-character markdown marker, e.g. `/` for `- [/]`. */
    markdownSymbol: string;
    /** Indicates whether the task is completed in this state. */
    isCompleted: boolean;
    /** CSS color associated with the state, e.g. `#e6a23c`. */
    color: string;
    /** Icon class, e.g. `bx bx-loader`. */
    icon: string;
    /** The `isHidden` label — kept for CSS/round-trip, but hidden from the toolbar and keyboard cycle. */
    isHidden?: boolean;
}

/** Reserved name of the built-in unchecked anchor state. */
export const NONE_STATE_NAME = "none";
/** Reserved name of the built-in checked anchor state. */
export const DONE_STATE_NAME = "done";

/** Hidden-subtree note that contains the task state definitions. */
export const TASK_STATES_CONTAINER_ID = "_taskStates";
/** Note id of the built-in unchecked anchor state. */
export const NONE_STATE_ID = "_taskStateNone";
/** Note id of the built-in checked anchor state. */
export const DONE_STATE_ID = "_taskStateDone";

/** Whether `name` is a built-in anchor state (`none`/`done`) rather than a customizable one. */
export function isAnchorState(name: string): boolean {
    return name === NONE_STATE_NAME || name === DONE_STATE_NAME;
}

/** The built-in unchecked anchor state. */
export const NONE_TASK_STATE: TaskStateDef = {
    id: NONE_STATE_ID, name: NONE_STATE_NAME, title: "None", markdownSymbol: " ", isCompleted: false, color: "", icon: "bx bx-checkbox"
};

/** The built-in checked anchor state. */
export const DONE_TASK_STATE: TaskStateDef = {
    id: DONE_STATE_ID, name: DONE_STATE_NAME, title: "Done", markdownSymbol: "x", isCompleted: true, color: "#4de64d", icon: "bx bx-check"
};

/**
 * The user-customizable default states, seeded under `_taskStates` on a fresh
 * installation.
 */
export const DEFAULT_CUSTOM_TASK_STATES: TaskStateDef[] = [
    {id: "_taskStateDoing", name: "doing", title: "Doing", markdownSymbol: "/", isCompleted: false, color: "#e6a23c", icon: "bx bx-loader"},
    {id: "_taskStateMaybe", name: "maybe", title: "Maybe", markdownSymbol: "?", isCompleted: false, color: "#4d4de6", icon: "bx bx-question-mark"},
    {id: "_taskStateCancelled", name: "cancelled", title: "Cancelled", markdownSymbol: "-", isCompleted: false, color: "#e64d4d", icon: "bx bx-block"}
];

/**
 * The full default ordered sequence — `None, Doing, Done, Maybe, Cancelled`.
 * Used as the fallback wherever the user-defined states are not reachable.
 */
export const DEFAULT_TASK_STATES: TaskStateDef[] = [
    NONE_TASK_STATE,
    DEFAULT_CUSTOM_TASK_STATES[0],
    DONE_TASK_STATE,
    DEFAULT_CUSTOM_TASK_STATES[1],
    DEFAULT_CUSTOM_TASK_STATES[2]
];

/** Stable identifier of why a custom task state failed validation. */
export type TaskStateValidationReason =
    | "undefined-name"
    | "invalid-name"
    | "duplicate-name"
    | "missing-title"
    | "missing-icon"
    | "invalid-symbol"
    | "duplicate-symbol";

/** A custom task state that failed validation and was dropped. */
export interface TaskStateValidationError {
    /** The dropped state note's id. */
    id: string;
    /** The dropped state's title (falls back to its name). */
    title: string;
    /** Stable reason key — the caller localizes it for display. */
    reason: TaskStateValidationReason;
}

export interface TaskStateValidationResult {
    /** The accepted states (anchors plus valid custom states), in input order. */
    valid: TaskStateDef[];
    /** Dropped custom states with their reasons. */
    errors: TaskStateValidationError[];
}

/** The `stateId` is embedded in HTML attributes, CSS selectors and JSON — keep it strictly safe. */
const VALID_STATE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Symbols reserved by the markdown task-list syntax `- [ ]` / `- [x]`. */
const FORBIDDEN_MARKDOWN_SYMBOLS = new Set(["[", "]", " ", "x", "X"]);

function checkCustomState(
    state: TaskStateDef,
    seenNames: Set<string>,
    seenSymbols: Set<string>
): TaskStateValidationReason | null {
    if (!state.name) {
        return "undefined-name";
    }
    if (!VALID_STATE_NAME_PATTERN.test(state.name)) {
        return "invalid-name";
    }
    if (seenNames.has(state.name)) {
        return "duplicate-name";
    }
    if (!state.title) {
        return "missing-title";
    }
    if (!state.icon) {
        return "missing-icon";
    }
    if (state.markdownSymbol) {
        if (state.markdownSymbol.length !== 1 || FORBIDDEN_MARKDOWN_SYMBOLS.has(state.markdownSymbol)) {
            return "invalid-symbol";
        }
        if (seenSymbols.has(state.markdownSymbol)) {
            return "duplicate-symbol";
        }
    }
    return null;
}

/**
 * Validates custom task states, dropping invalid ones. Anchor states (`none`/`done`)
 * pass through untouched. Single pass — O(n) over a small set.
 */
export function validateTaskStates(states: TaskStateDef[]): TaskStateValidationResult {
    const valid: TaskStateDef[] = [];
    const errors: TaskStateValidationError[] = [];
    // Seed with the reserved anchor names so a custom state may not reuse them.
    const seenNames = new Set<string>([NONE_STATE_NAME, DONE_STATE_NAME]);
    const seenSymbols = new Set<string>();

    for (const state of states) {
        if (state.id === NONE_STATE_ID || state.id === DONE_STATE_ID) {
            valid.push(state);
            continue;
        }

        const reason = checkCustomState(state, seenNames, seenSymbols);
        if (reason) {
            errors.push({
                id: state.id ?? "",
                title: state.title || state.name || "",
                reason
            });
            continue;
        }

        seenNames.add(state.name);
        if (state.markdownSymbol) {
            seenSymbols.add(state.markdownSymbol);
        }
        valid.push(state);
    }

    return { valid, errors };
}
