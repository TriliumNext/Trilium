import type { TaskStateDef, TaskStateValidationError } from "@triliumnext/commons";
import {
    DEFAULT_TASK_STATES, DONE_STATE_ID, DONE_TASK_STATE, NONE_STATE_ID, NONE_TASK_STATE,
    TASK_STATES_CONTAINER_ID, validateTaskStates
} from "@triliumnext/commons/src/lib/task_states.js";

import appContext from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import froca from "./froca.js";
import { t } from "./i18n.js";
import toastService from "./toast.js";

const VALIDATION_TOAST_ID = "task-states-validation";

/** The last reported error set, so the toast only re-surfaces when the situation changes. */
let lastReportedSignature: string | null = null;

/**
 * Surfaces dropped-task-state warnings as a single persistent toast listing the offending
 * definition notes as reference links, each annotated with its rejection reason. Re-shown only
 * when the error set changes; closed as soon as validation comes back clean, so fixing the
 * definitions gives immediate feedback.
 */
function reportValidationErrors(errors: TaskStateValidationError[]) {
    const signature = errors.map((error) => `${error.id}:${error.reason}`).sort().join(",");
    if (signature === lastReportedSignature) {
        return;
    }
    lastReportedSignature = signature;

    if (errors.length === 0) {
        toastService.closePersistent(VALIDATION_TOAST_ID);
        return;
    }

    toastService.showPersistent({
        id: VALIDATION_TOAST_ID,
        icon: "bx bx-list-check",
        title: t("text-editor.task-state-dropped-title"),
        message: t("text-editor.task-state-dropped-message", { count: errors.length }),
        notesHeading: t("text-editor.task-state-dropped-heading"),
        notes: errors
            .filter((error) => error.id)
            .map((error) => ({
                noteId: error.id,
                description: t(`text-editor.validation-errors.${error.reason}`)
            })),
        wide: true,
        timeout: 60_000,
        buttons: [
            {
                text: t("text-editor.task-state-dropped-configure"),
                onClick: ({ dismissToast }) => {
                    openCustomTaskStateConfig();
                    dismissToast();
                }
            }
        ]
    });
}

/**
 * Enumerates the configured task states from the `_taskStates` hidden subtree,
 * dropping invalid definitions and reporting them once. Shared by the text
 * editor, kanban and the todo collection view.
 */
export async function getTaskStateDefinitions(): Promise<TaskStateDef[]> {
    const container = await getContainer();
    if (!container) {
        return DEFAULT_TASK_STATES;
    }

    const states = (await container.getChildNotes())
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

    const {valid, errors} = validateTaskStates(states);
    reportValidationErrors(errors);
    return valid.length ? valid : DEFAULT_TASK_STATES;
}

/** Opens the "Task States" configuration subtree in a tree-sidebar popup, hoisted to it. */
export function openCustomTaskStateConfig(): void {
    void appContext.triggerCommand("openInTreePopup", {
        noteIdOrPath: TASK_STATES_CONTAINER_ID,
        hoistedNoteId: TASK_STATES_CONTAINER_ID
    });
}

/** The load of {@link getContainer} while it is under way. */
let containerLoad: Promise<FNote | null> | undefined;

/**
 * The `_taskStates` note with its children in froca. Neither is in the initial tree, so they come in
 * one request for the subtree rather than one for the note and another for its children.
 */
async function getContainer() {
    await froca.initializedPromise.catch(() => {});
    const cached = froca.notes[TASK_STATES_CONTAINER_ID];
    if (cached?.children.every((noteId) => noteId in froca.notes)) return cached;

    containerLoad ??= froca.loadSubTree(TASK_STATES_CONTAINER_ID)
        .then((note) => note ?? null, () => null)
        .finally(() => {
            containerLoad = undefined;
        });
    return await containerLoad;
}
