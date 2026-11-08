import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import contextMenu, { type MenuCommandItem } from "../../menus/context_menu";
import bulk_action, { ACTION_GROUPS } from "../../services/bulk_action";
import froca from "../../services/froca";
import noteAttributeCache from "../../services/note_attribute_cache";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import BulkActionsDialog from "./bulk_actions";

const server = vi.hoisted(() => ({
    get: vi.fn(async (_url: string): Promise<string[]> => []),
    post: vi.fn(),
    put: vi.fn(async (_url: string, _body: { value: string }) => {}),
    remove: vi.fn(async () => {}),
    getMaxKnownEntityChangeId: () => 0
}));

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key)
}));
vi.mock("../../services/server", () => ({ default: server }));
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath }: { notePath: string }) => <span className="note-link">{notePath}</span>
}));

describe("BulkActionsDialog", () => {
    let host: Component;
    let container: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        server.post.mockResolvedValue({ affectedNoteCount: 0 });
        delete noteAttributeCache.attributes._bulkAction;
        buildNote({ id: "_bulkAction", title: "Bulk action" });
        host = new Component();
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <BulkActionsDialog />
            </ParentComponent.Provider>
        );
    });

    async function open(selectedOrActiveNoteIds: string[]) {
        await act(async () => {
            await host.handleEventInChildren("openBulkActionsDialog", { selectedOrActiveNoteIds });
        });
    }

    function chipNoteIds() {
        return [ ...container.querySelectorAll(".note-chips .tn-chip .note-link") ]
            .map((el) => el.textContent);
    }

    function lastAffectedNotesRequest() {
        return server.post.mock.calls.filter(([ url ]) => url === "bulk-action/affected-notes").at(-1)?.[1];
    }

    function actionAttributeIds() {
        return [ ...(froca.notes._bulkAction?.attributes ?? []) ];
    }

    /** Removes the action as the server does, then sends the change back as the WebSocket would. */
    async function deleteActionOnServer(attributeId: string) {
        const note = froca.notes._bulkAction;
        if (!note) throw new Error("No _bulkAction note.");
        note.attributes = note.attributes.filter((id) => id !== attributeId);
        delete noteAttributeCache.attributes._bulkAction;
        const loadResults = {
            getAttributeRows: () => [ { attributeId, type: "label", name: "action", noteId: "_bulkAction" } ]
        };
        await act(async () => {
            await host.handleEventInChildren("entitiesReloaded", { loadResults } as never);
        });
    }

    function labelNameInputs() {
        return [ ...container.querySelectorAll<HTMLInputElement>(".bulk-action input.bulk-action-name") ];
    }

    /** The chosen actions, each a segment of the actions card. */
    function chosenActionRows() {
        return [ ...container.querySelectorAll<HTMLElement>(
            ".bulk-actions-chosen-actions > .tn-card-body > .tn-card-section.bulk-action") ];
    }

    /** Types `value` into `input`, lets the debounced lookup run and returns the suggestion rows. Needs fake timers. */
    async function typeAndSuggest(input: HTMLInputElement | undefined, value: string) {
        if (!input) throw new Error("No such field.");
        await act(async () => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown li") ];
    }

    /** Runs the row's debounced save, so it lands in this test, and returns the saved action. */
    async function savedAction() {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });
        const value = server.put.mock.calls.at(-1)?.[1]?.value;
        return value === undefined ? undefined : JSON.parse(value);
    }

    it("shows the first selected notes as chips and the rest on demand", async () => {
        const noteIds = [ "n1", "n2", "n3", "n4", "n5", "n6", "n7" ];
        await open(noteIds);
        expect(chipNoteIds()).toStrictEqual([ "n1", "n2", "n3", "n4", "n5" ]);

        const more = container.querySelector<HTMLElement>(".note-chips .note-chips-more");
        expect(more?.textContent).toBe("note_chips.more:2");
        await act(async () => more?.click());

        expect(chipNoteIds()).toStrictEqual(noteIds);
        expect(container.querySelector(".note-chips-more")).toBeNull();
    });

    it("says so when no action is chosen yet", async () => {
        await open([ "n1" ]);
        expect(container.querySelector(".bulk-actions-chosen-actions .no-items")?.textContent)
            .toBe("bulk_actions.none_yet");
    });

    it("adds the action picked from the add row's menu at the foot of the card", async () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
        await open([ "n1" ]);
        const adder = container.querySelector<HTMLButtonElement>(".bulk-actions-chosen-actions"
            + " > .tn-card-body > .tn-card-adders:last-child > .tn-card-adder");
        expect(adder?.textContent).toContain("bulk_actions.add_action");
        await act(async () => adder?.click());
        await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());

        const { anchor, items } = show.mock.calls[0][0];
        expect(anchor).toBe(adder);
        expect(items.flatMap((item) => ("kind" in item && item.kind === "header"
            ? [ item.title ]
            : [])))
            .toStrictEqual(ACTION_GROUPS.map(({ title }) => title));
        expect(items[0]).toMatchObject({ kind: "header" });

        const item = items.find((entry): entry is MenuCommandItem<unknown> =>
            !("kind" in entry) && entry.title === "move_note.move_note");
        expect(item).toMatchObject({
            uiIcon: "bx bx-note bulk-action-marker-move",
            tooltip: "move_note.description"
        });
        await act(async () => item?.handler?.(item, new MouseEvent("click")));

        expect(server.post).toHaveBeenCalledWith("notes/_bulkAction/attributes", {
            type: "label",
            name: "action",
            value: JSON.stringify({ name: "moveNote" })
        });
    });

    it("marks each chosen action with its icon", async () => {
        buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteNote" }) });
        await open([ "n1" ]);
        expect(chosenActionRows()).toHaveLength(1);

        const icon = container.querySelector(".bulk-action .bulk-action-icon");
        expect(icon?.classList.contains("bx-note")).toBe(true);
        expect(icon?.classList.contains("bulk-action-marker-delete")).toBe(true);
        expect(icon?.classList.contains("destructive-action-icon")).toBe(true);
        expect(container.querySelector(".bulk-action .tn-chip-remove, .bulk-action .search-option-del"))
            .not.toBeNull();
        expect(container.querySelector(".bulk-action .help-dropdown")).toBeNull();
    });

    it("names each chosen action by its menu title alone, with an arrow only between two fields", async () => {
        buildNote({
            id: "_bulkAction",
            title: "Bulk action",
            "#action": bulk_action.ACTION_CLASSES.map(({ actionName }) => JSON.stringify({ name: actionName }))
        });
        await open([ "n1" ]);
        const rows = chosenActionRows();
        expect(rows).toHaveLength(bulk_action.ACTION_CLASSES.length);

        for (const [ index, ActionClass ] of bulk_action.ACTION_CLASSES.entries()) {
            const row = rows[index];
            const content = row.children[0].cloneNode(true) as HTMLElement;
            for (const field of content.querySelectorAll("select, .template-field")) field.remove();
            expect(content.textContent?.trim(), ActionClass.actionName).toBe(ActionClass.actionTitle);
            expect(row.querySelectorAll(".tn-icon:not(.bulk-action-arrow)"), ActionClass.actionName).toHaveLength(1);

            const arrow = row.querySelector(".bulk-action-arrow");
            const fieldCount = row.querySelectorAll("input:not([type=hidden]), select, .template-field").length;
            expect(!!arrow, ActionClass.actionName).toBe(fieldCount === 2);
        }
    });

    it("lays each row out as title, fields and remove button, with the fields it needs marked required", async () => {
        // For each action, its fields in order: whether each is required, and whether it holds a name.
        const expected: Record<string, { required: boolean[]; names: boolean[] }> = {
            addLabel: { required: [ true, false ], names: [ true, false ] },
            updateLabelValue: { required: [ true, false ], names: [ true, false ] },
            renameLabel: { required: [ true, true ], names: [ true, true ] },
            deleteLabel: { required: [ true ], names: [ true ] },
            addRelation: { required: [ true, true ], names: [ true, false ] },
            updateRelationTarget: { required: [ true, true ], names: [ true, false ] },
            renameRelation: { required: [ true, true ], names: [ true, true ] },
            deleteRelation: { required: [ true ], names: [ true ] },
            renameNote: { required: [], names: [] },
            moveNote: { required: [ true ], names: [ false ] },
            convertNote: { required: [ true ], names: [ false ] },
            deleteNote: { required: [], names: [] },
            saveRevision: { required: [ false ], names: [ false ] },
            deleteRevisions: { required: [], names: [] },
            executeScript: { required: [], names: [] }
        };
        buildNote({
            id: "_bulkAction",
            title: "Bulk action",
            "#action": bulk_action.ACTION_CLASSES.map(({ actionName }) => JSON.stringify({ name: actionName }))
        });
        await open([ "n1" ]);
        const rows = chosenActionRows();
        expect(rows).toHaveLength(bulk_action.ACTION_CLASSES.length);

        for (const [ index, ActionClass ] of bulk_action.ACTION_CLASSES.entries()) {
            const { actionName, actionDescription } = ActionClass;
            const row = rows[index];
            expect([ ...row.children ].map((child) => child.className), actionName)
                .toStrictEqual([
                    "bulk-action-title",
                    "bulk-action-fields",
                    "help-remove-buttons bulk-action-actions"
                ]);

            const fields = [
                ...row.children[1].querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select")
            ];
            expect(fields.map((field) => field.required), actionName).toStrictEqual(expected[actionName].required);
            expect(fields.map((field) => field.classList.contains("bulk-action-name")), actionName)
                .toStrictEqual(expected[actionName].names);
            expect(row.querySelector("[style*='flex-shrink']"), actionName).toBeNull();

            const hasFields = row.querySelector(".bulk-action-fields > *:not(.bulk-action-description)");
            expect(row.querySelector(".bulk-action-description")?.textContent, actionName)
                .toBe(hasFields ? undefined : actionDescription);
        }

        expect(container.querySelector("form")?.checkValidity()).toBe(false);
    });

    it("names the note count on the execute button and enables it only with actions and notes to run on", async () => {
        function executeButton() {
            const button = container.querySelector<HTMLButtonElement>(".modal-footer button[name='execute-bulk-actions']");
            if (!button) throw new Error("No execute button.");
            return button;
        }

        server.post.mockResolvedValue({ affectedNoteCount: 3 });
        await open([ "n1", "n2" ]);
        expect(executeButton().textContent).toContain("bulk_actions.execute_bulk_actions:3");
        expect(executeButton().disabled).toBe(true);

        buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteRevisions" }) });
        await open([ "n1", "n2" ]);
        expect(executeButton().disabled).toBe(false);

        server.post.mockResolvedValue({ affectedNoteCount: 0 });
        await open([ "gone" ]);
        expect(executeButton().textContent).toContain("bulk_actions.execute_bulk_actions:0");
        expect(executeButton().disabled).toBe(true);
    });

    it("keeps the execute button disabled until the count for a changed selection arrives", async () => {
        buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteRevisions" }) });
        server.post.mockResolvedValue({ affectedNoteCount: 1 });
        await open([ "n1" ]);
        const button = container.querySelector<HTMLButtonElement>("button[name='execute-bulk-actions']");
        expect(button?.disabled).toBe(false);

        let respond = (_count: number) => {};
        server.post.mockImplementation(() => new Promise((resolve) => {
            respond = (affectedNoteCount) => resolve({ affectedNoteCount });
        }));
        const toggle = container.querySelector<HTMLInputElement>("input.switch-toggle");
        if (!toggle) throw new Error("No include-descendants toggle.");
        await act(async () => {
            toggle.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(lastAffectedNotesRequest()).toStrictEqual({ noteIds: [ "n1" ], includeDescendants: true });
        expect(button?.disabled).toBe(true);

        await act(async () => respond(300));
        expect(button?.textContent).toContain("bulk_actions.execute_bulk_actions:300");
        expect(button?.disabled).toBe(false);
    });

    it("runs the actions once, however often the execute button is pressed", async () => {
        buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteRevisions" }) });
        server.post.mockResolvedValue({ affectedNoteCount: 1 });
        await open([ "n1" ]);

        let finish = () => {};
        server.post.mockImplementation((url: string) => (url === "bulk-action/execute"
            ? new Promise<void>((resolve) => { finish = resolve; })
            : Promise.resolve({ affectedNoteCount: 1 })));
        const form = container.querySelector("form");
        if (!form) throw new Error("The dialog has no form.");
        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        expect(server.post.mock.calls.filter(([ url ]) => url === "bulk-action/execute")).toHaveLength(1);
        expect(container.querySelector<HTMLButtonElement>("button[name='execute-bulk-actions']")?.disabled).toBe(true);
        await act(async () => finish());
    });

    it("drops a removed chip from the notes the actions apply to, keeping the last one", async () => {
        await open([ "n1", "n2" ]);
        expect(lastAffectedNotesRequest()).toStrictEqual({ noteIds: [ "n1", "n2" ], includeDescendants: false });

        const removeButtons = container.querySelectorAll<HTMLButtonElement>(".note-chips .tn-chip-remove");
        expect(removeButtons).toHaveLength(2);
        await act(async () => removeButtons[0].click());

        expect(chipNoteIds()).toStrictEqual([ "n2" ]);
        expect(lastAffectedNotesRequest()).toStrictEqual({ noteIds: [ "n2" ], includeDescendants: false });
        expect(container.querySelector<HTMLButtonElement>(".tn-chip-remove")?.disabled).toBe(true);
    });

    it("completes a relation name against the names in use", async () => {
        vi.useFakeTimers();
        try {
            server.get.mockImplementation(async (url) =>
                (url.startsWith("attribute-names/?type=relation&query=au") ? [ "author" ] : []));
            buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteRelation" }) });
            await open([ "n1" ]);

            const suggestions = await typeAndSuggest(labelNameInputs()[0], "au");
            expect(suggestions.map((li) => li.textContent)).toStrictEqual([ "author" ]);

            await act(async () => suggestions[0].click());
            expect(labelNameInputs()[0].value).toBe("author");
            expect(await savedAction()).toStrictEqual({ name: "deleteRelation", relationName: "author" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("completes a label value against the values the label already has", async () => {
        vi.useFakeTimers();
        try {
            server.get.mockImplementation(async (url) =>
                (url === "attribute-values/status" ? [ "done", "doing", "todo" ] : []));
            buildNote({
                id: "_bulkAction", title: "Bulk action",
                "#action": JSON.stringify({ name: "updateLabelValue", labelName: "status" })
            });
            await open([ "n1" ]);

            const valueInput = container.querySelector<HTMLInputElement>(
                ".bulk-action .bulk-action-fields input:not(.bulk-action-name)");
            const suggestions = await typeAndSuggest(valueInput ?? undefined, "doi");
            expect(suggestions.map((li) => li.textContent)).toStrictEqual([ "doing" ]);
            expect(await savedAction()).toStrictEqual({ name: "updateLabelValue", labelName: "status", labelValue: "doi" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("saves an action only when its fields change", async () => {
        vi.useFakeTimers();
        try {
            buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteLabel", labelName: "a" }) });
            await open([ "n1" ]);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(2000);
            });
            expect(server.put).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("drops an edit still waiting to be saved when its action is removed", async () => {
        vi.useFakeTimers();
        try {
            buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteLabel", labelName: "a" }) });
            const [ attributeId ] = actionAttributeIds();
            await open([ "n1" ]);

            const [ input ] = labelNameInputs();
            expect(input).toBeDefined();
            await act(async () => {
                input.value = "ab";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
            const remove = container.querySelector<HTMLElement>(".bulk-action .search-option-del");
            expect(remove).not.toBeNull();
            await act(async () => remove?.click());
            expect(server.remove).toHaveBeenCalledWith(`notes/_bulkAction/attributes/${attributeId}`);
            await deleteActionOnServer(attributeId);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(2000);
            });
            expect(server.put).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps saving an action whose removal failed", async () => {
        vi.useFakeTimers();
        try {
            buildNote({ id: "_bulkAction", title: "Bulk action", "#action": JSON.stringify({ name: "deleteLabel", labelName: "a" }) });
            const [ attributeId ] = actionAttributeIds();
            await open([ "n1" ]);

            server.remove.mockRejectedValueOnce(new Error("offline"));
            await act(async () => container.querySelector<HTMLElement>(".bulk-action .search-option-del")?.click());
            expect(server.remove).toHaveBeenCalledOnce();

            const [ input ] = labelNameInputs();
            expect(input).toBeDefined();
            await act(async () => {
                input.value = "ab";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(2000);
            });
            expect(server.put).toHaveBeenCalledWith("notes/_bulkAction/attribute", expect.objectContaining({
                attributeId,
                value: JSON.stringify({ name: "deleteLabel", labelName: "ab" })
            }));
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps each row's fields with its own action when an earlier one is removed", async () => {
        buildNote({
            id: "_bulkAction",
            title: "Bulk action",
            "#action": [
                JSON.stringify({ name: "deleteLabel", labelName: "a" }),
                JSON.stringify({ name: "deleteLabel", labelName: "b" })
            ]
        });
        await open([ "n1" ]);
        expect(labelNameInputs().map((input) => input.value)).toStrictEqual([ "a", "b" ]);

        await deleteActionOnServer(actionAttributeIds()[0]);
        expect(labelNameInputs().map((input) => input.value)).toStrictEqual([ "b" ]);
    });

    it("lists a note selected through two of its clones once", async () => {
        await open([ "n1", "n1", "n2" ]);
        expect(chipNoteIds()).toStrictEqual([ "n1", "n2" ]);
        expect(lastAffectedNotesRequest()).toStrictEqual({ noteIds: [ "n1", "n2" ], includeDescendants: false });

        await open([ "n1", "n1" ]);
        expect(chipNoteIds()).toStrictEqual([ "n1" ]);
        expect(container.querySelector<HTMLButtonElement>(".tn-chip-remove")?.disabled).toBe(true);
    });
});
