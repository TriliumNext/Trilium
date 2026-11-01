import { DEFAULT_CUSTOM_TASK_STATES, DEFAULT_TASK_STATES, DONE_STATE_ID, DONE_TASK_STATE, isAnchorState, NONE_STATE_ID, NONE_TASK_STATE, TASK_STATES_CONTAINER_ID, type TaskStateDef, validateTaskStates } from "@triliumnext/commons";
import Color from "color";
import { t } from "i18next";

import { getBecca } from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import type BNote from "../becca/entities/bnote.js";
import { getIconPacks } from "./icon_packs.js";
import noteService from "./notes.js";

/**
 * Returns the task states from the `_taskStates` hidden subtree, in note order.
 * The `none`/`done` anchor notes map to their fixed built-in definitions; other
 * children are read from their promoted attributes. Invalid custom states are
 * dropped. Falls back to {@link DEFAULT_TASK_STATES} when the container is
 * missing or empty.
 */
export function getTaskStates(): TaskStateDef[] {
    const container = getBecca().notes[TASK_STATES_CONTAINER_ID];
    if (!container) {
        return DEFAULT_TASK_STATES;
    }

    const states = container.getChildNotes()
        .map((note): TaskStateDef | null => {
            if (note.noteId === NONE_STATE_ID) {
                return NONE_TASK_STATE;
            }
            if (note.noteId === DONE_STATE_ID) {
                return DONE_TASK_STATE;
            }
            // Archived definition notes are completely ignored — never enumerated.
            if (note.isArchived) {
                return null;
            }
            return {
                id: note.noteId,
                name: note.getLabelValue("stateId") ?? "",
                title: note.title,
                markdownSymbol: note.getLabelValue("markdownSymbol") ?? "",
                isCompleted: note.getLabelValue("isCompleted") === "true",
                color: note.getLabelValue("color") ?? "",
                icon: note.getLabelValue("iconClass") ?? "",
                isHidden: note.getLabelValue("isHidden") === "true"
            };
        })
        .filter((state): state is TaskStateDef => state !== null);

    const {valid} = validateTaskStates(states);
    return valid.length ? valid : DEFAULT_TASK_STATES;
}

/**
 * Creates a single task-state definition note under the `_taskStates` container,
 * with its promoted attributes. Reusable for seeding and for adding states from
 * any feature (text editor, kanban, todo collection view).
 */
export function createTaskStateNote(state: TaskStateDef, options: {noteId?: string; title?: string} = {}): BNote {
    const {note} = noteService.createNewNote({
        noteId: options.noteId,
        title: options.title ?? state.title,
        type: "doc",
        parentNoteId: TASK_STATES_CONTAINER_ID,
        content: "",
        ignoreForbiddenParents: true
    });

    const labels: Record<string, string | undefined> = {
        iconClass: state.icon,
        stateId: state.name,
        markdownSymbol: state.markdownSymbol,
        isCompleted: String(state.isCompleted),
        color: state.color,
        docName: "task_state"
    };

    for (const [name, value] of Object.entries(labels)) {
        new BAttribute({
            attributeId: `${note.noteId}_l${name}`,
            noteId: note.noteId,
            type: "label",
            name,
            value
        }).save();
    }

    return note;
}

/**
 * Seeds the customizable default task states under the `_taskStates` container
 * and applies the default ordering across all states (anchors included). Called
 * exactly once — when the container is first created — so user changes stick.
 */
export function seedDefaultTaskStates() {
    const titleKeys: Record<string, string> = {
        doing: "hidden-subtree.task-state-doing",
        maybe: "hidden-subtree.task-state-maybe",
        cancelled: "hidden-subtree.task-state-cancelled"
    };

    for (const state of DEFAULT_CUSTOM_TASK_STATES) {
        createTaskStateNote(state, {noteId: state.id, title: t(titleKeys[state.name])});
    }

    // Apply the default ordering (None, Doing, Done, Maybe, Cancelled) across all states.
    DEFAULT_TASK_STATES.forEach((state, index) => {
        const note = state.id ? getBecca().notes[state.id] : undefined;
        const branch = note?.getParentBranches().find((b) => b.parentNoteId === TASK_STATES_CONTAINER_ID);
        if (branch) {
            branch.notePosition = index * 10;
            branch.save();
        }
    });
}

function escapeCssString(value: string): string {
    return value.replace(/[\\"]/g, "\\$&");
}

/**
 * Resolves an icon class (e.g. `bx bx-cancel`) to its font glyph and family
 * using the icon-pack manifests — the same data that powers the icon picker.
 * Works for any installed pack without a browser or font-CSS parsing.
 */
function resolveIconGlyph(iconClass: string): {glyph: string; fontFamily: string} | null {
    const parts = iconClass.trim().split(/\s+/);
    if (parts.length < 2) {
        return null;
    }
    const [prefix, name] = parts;
    for (const pack of getIconPacks()) {
        if (pack.prefix !== prefix) {
            continue;
        }
        const icon = pack.manifest.icons[name];
        if (!icon) {
            return null;
        }
        return {
            glyph: icon.glyph,
            fontFamily: pack.builtin ? pack.fontAttachmentId : `trilium-icon-pack-${pack.prefix}`
        };
    }
    return null;
}

/**
 * Returns the HSL hue (0–360) of a color, or `undefined` for grayscale colors
 * (zero saturation) — mirrors `getHue` in the client's `css_class_manager`.
 * Accepts any CSS color the `color` library understands (hex, `rgb()`, names…).
 */
function computeHue(color: string): number | undefined {
    try {
        const hsl = Color(color).hsl();
        return hsl.saturationl() > 0 ? hsl.hue() : undefined;
    } catch {
        // Not a valid color — no hue.
        return undefined;
    }
}

/**
 * Generates the CSS that renders each task state's icon on its `data-trilium-task-state`
 * checkbox. Resolution is a plain manifest lookup, so this works server-side and
 * the same stylesheet can be served to both the app and shared notes.
 */
export function generateTaskStateCss(): string {
    const rules: string[] = [];
    for (const state of getTaskStates()) {
        if (isAnchorState(state.name) || !state.icon) {
            continue;
        }
        const resolved = resolveIconGlyph(state.icon);
        if (!resolved) {
            continue;
        }
        const name = escapeCssString(state.name);
        const hue = (state.color) ? computeHue(state.color) : undefined;
        
        rules.push(`[data-trilium-task-state="${name}"], .tn-task-checkbox[data-trilium-task-state="${name}"] {
            --task-state-glyph: "${resolved.glyph}";
            --task-state-glyph-font-family: "${resolved.fontFamily}";
            --task-state-color: ${state.color || "inherit"};
            --task-state-hue: ${hue ?? "unset"};
        }`);
    }
    return rules.join("\n");
}
