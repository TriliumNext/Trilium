import {
    DEFAULT_TASK_STATES,
    DONE_STATE_ID,
    DONE_TASK_STATE,
    NONE_STATE_ID,
    NONE_TASK_STATE,
    TASK_STATES_CONTAINER_ID
} from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import { buildNote } from "../test/easy-froca.js";
import froca from "./froca.js";
import toastService from "./toast.js";

vi.mock("./i18n.js", () => ({
    // Echo the key so assertions stay on stable keys, not translated strings.
    t: (key: string) => key
}));

vi.mock("./toast.js", () => ({
    default: {
        showPersistent: vi.fn(),
        closePersistent: vi.fn()
    }
}));

const { getTaskStateDefinitions, openCustomTaskStateConfig } = await import("./task_states.js");

/** Repoints froca's `_taskStates` lookup at a freshly built container note. */
function useContainer(children: Parameters<typeof buildNote>[0]["children"]) {
    const id = `_ts_${Math.random().toString(36).slice(2)}`;
    const container = buildNote({ id, title: "Container", children });
    froca.notes[TASK_STATES_CONTAINER_ID] = container;
    return container;
}

describe("getTaskStateDefinitions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete froca.notes[TASK_STATES_CONTAINER_ID];
    });

    it("falls back to the defaults when the container note is missing", async () => {
        const original = froca.getNote;
        froca.getNote = vi.fn(async () => null) as typeof froca.getNote;
        try {
            expect(await getTaskStateDefinitions()).toBe(DEFAULT_TASK_STATES);
        } finally {
            froca.getNote = original;
        }
    });

    it("maps anchors, drops archived states and reads every custom label", async () => {
        useContainer([
            { id: NONE_STATE_ID, title: "None src" },
            { id: DONE_STATE_ID, title: "Done src" },
            { title: "Archived state", "#archived": "true" },
            {
                id: "_taskStateDoing",
                title: "Doing",
                "#stateId": "doing",
                "#markdownSymbol": "/",
                "#isCompleted": "true",
                "#color": "#e6a23c",
                "#iconClass": "bx bx-loader",
                "#isHidden": "true"
            }
        ]);

        const result = await getTaskStateDefinitions();

        // Anchors are replaced by their canonical hardcoded definitions.
        expect(result).toContain(NONE_TASK_STATE);
        expect(result).toContain(DONE_TASK_STATE);
        // The archived child is never enumerated.
        expect(result.some((s) => s.title === "Archived state")).toBe(false);
        // No validation errors for a fully valid set.
        expect(toastService.showPersistent).not.toHaveBeenCalled();

        expect(result.find((s) => s.id === "_taskStateDoing")).toEqual({
            id: "_taskStateDoing",
            name: "doing",
            title: "Doing",
            markdownSymbol: "/",
            isCompleted: true,
            color: "#e6a23c",
            icon: "bx bx-loader",
            isHidden: true
        });
    });

    it("defaults the optional custom labels to falsy when they are absent", async () => {
        // Valid (has stateId/title/icon) but omits the optional labels, so the
        // nullish/equality fallbacks all resolve to their falsy defaults.
        useContainer([
            {
                id: "_taskStateBare",
                title: "Bare",
                "#stateId": "bare",
                "#iconClass": "bx bx-x"
            }
        ]);

        const result = await getTaskStateDefinitions();
        expect(toastService.showPersistent).not.toHaveBeenCalled();
        expect(result.find((s) => s.id === "_taskStateBare")).toEqual({
            id: "_taskStateBare",
            name: "bare",
            title: "Bare",
            markdownSymbol: "",
            isCompleted: false,
            color: "",
            icon: "bx bx-x",
            isHidden: false
        });
    });

    it("reports dropped states in one persistent toast, deduplicates, re-reports on change and clears when fixed", async () => {
        // Two non-archived states missing stateId/iconClass map to empty name/icon
        // (covering the nullish-left branches), then get dropped by validation.
        useContainer([
            { id: "_taskBadA", title: "Bad A" },
            { id: "_taskBadB", title: "Bad B" }
        ]);

        const result = await getTaskStateDefinitions();
        // No valid custom states remain -> falls back to the defaults.
        expect(result).toBe(DEFAULT_TASK_STATES);

        // A single persistent toast lists both dropped notes, each annotated with its reason.
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        const options = vi.mocked(toastService.showPersistent).mock.calls[0][0];
        expect(options.id).toBe("task-states-validation");
        expect(options.notes).toEqual([
            { noteId: "_taskBadA", description: "text-editor.validation-errors.undefined-name" },
            { noteId: "_taskBadB", description: "text-editor.validation-errors.undefined-name" }
        ]);

        // Its button opens the task-states config popup and dismisses the toast.
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => undefined);
        const dismissToast = vi.fn();
        options.buttons?.[0].onClick({ dismissToast });
        expect(triggerCommand).toHaveBeenCalledWith("openInTreePopup", expect.objectContaining({
            noteIdOrPath: TASK_STATES_CONTAINER_ID
        }));
        expect(dismissToast).toHaveBeenCalled();
        triggerCommand.mockRestore();

        // An unchanged error set is not re-reported...
        await getTaskStateDefinitions();
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);

        // ...but a different one is...
        useContainer([{ id: "_taskBadC", title: "Bad C" }]);
        await getTaskStateDefinitions();
        expect(toastService.showPersistent).toHaveBeenCalledTimes(2);

        // ...and a clean set closes the toast without re-showing it.
        useContainer([{ id: "_taskStateOk", title: "Ok", "#stateId": "ok", "#iconClass": "bx bx-x" }]);
        await getTaskStateDefinitions();
        expect(toastService.closePersistent).toHaveBeenCalledWith("task-states-validation");
        expect(toastService.showPersistent).toHaveBeenCalledTimes(2);
    });
});

describe("openCustomTaskStateConfig", () => {
    it("opens the task-states container hoisted in the tree popup", () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => undefined);

        openCustomTaskStateConfig();

        expect(triggerCommand).toHaveBeenCalledWith("openInTreePopup", {
            noteIdOrPath: TASK_STATES_CONTAINER_ID,
            hoistedNoteId: TASK_STATES_CONTAINER_ID
        });
        triggerCommand.mockRestore();
    });
});
