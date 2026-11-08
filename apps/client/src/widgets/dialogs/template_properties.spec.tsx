import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import TemplatePropertiesDialog from "./template_properties";

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string, opts?: { result?: string }) => (opts?.result !== undefined ? `${key}:${opts.result}` : key)
}));
// The CodeMirror field has its own spec; a plain input stands in for it here.
vi.mock("../bulk_actions/TemplateField", async (importOriginal) => ({
    ...await importOriginal<typeof import("../bulk_actions/TemplateField")>(),
    default: ({ currentValue, onChange, onBlur, preview, variables }: {
        currentValue: string; onChange(value: string): void; onBlur?(): void; preview?: string;
        variables: Record<string, string>;
    }) => (<>
        <input
            className="title-template-stub" value={currentValue} data-variables={JSON.stringify(variables)}
            onInput={(e) => onChange(e.currentTarget.value)} onBlur={onBlur}
        />
        {preview !== undefined && <span className="title-template-stub-preview">{preview}</span>}
    </>)
}));

vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ noteId, noteIdChanged }: { noteId?: string; noteIdChanged?(noteId: string | undefined): void }) => (
        <input
            className="default-parent-stub" value={noteId ?? ""}
            onInput={(e) => noteIdChanged?.(e.currentTarget.value || undefined)}
        />
    )
}));

describe("TemplatePropertiesDialog", () => {
    // No server pushes entity changes here, so nothing would ever be waited for.
    beforeEach(() => {
        vi.spyOn(ws, "waitForMaxKnownEntityChangeId").mockResolvedValue();
    });

    it("saves the template's own #template:titleTemplate when the field loses focus", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue();
        const note = buildNote({ title: "Meeting", "#template": "", "#template:titleTemplate": "Old" });

        const { field } = await open(note.noteId);
        expect(field.value).toBe("Old");
        expect(JSON.parse(field.dataset.variables ?? "")).toEqual({ now: "date", parentNote: "note" });

        // Leaving the field unchanged writes nothing.
        await act(async () => {
            field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve));
        });
        expect(setLabel).not.toHaveBeenCalled();

        type(field, "Meeting ${now.format('YYYY-MM-DD')}");
        await act(async () => {
            field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        await vi.waitFor(() => expect(setLabel)
            .toHaveBeenCalledWith(note.noteId, "template:titleTemplate", "Meeting ${now.format('YYYY-MM-DD')}"));
        setLabel.mockRestore();
    });

    it("removes the label when the dialog closes on an emptied field", async () => {
        const remove = vi.spyOn(attributes, "removeOwnedLabelByName").mockResolvedValue(true);
        const note = buildNote({ title: "Meeting", "#template": "", "#template:titleTemplate": "Old" });

        const { container, field } = await open(note.noteId);
        type(field, "");
        await act(async () => {
            container.querySelector(".template-properties-dialog")
                ?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true }));
        });
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(note, "template:titleTemplate"));
        remove.mockRestore();
    });

    it("clears a title typed and saved while its first write is still under way", async () => {
        let finishWrite: () => void = () => {};
        const setLabel = vi.spyOn(attributes, "setLabel")
            .mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
        const remove = vi.spyOn(attributes, "removeOwnedLabelByName").mockResolvedValue(true);
        const note = buildNote({ title: "Meeting", "#template": "" });

        const { container, field } = await open(note.noteId);
        type(field, "Unwanted");
        await act(async () => {
            field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        type(field, "");
        await act(async () => {
            container.querySelector(".template-properties-dialog")
                ?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true }));
        });
        expect(remove).not.toHaveBeenCalled();

        await act(async () => finishWrite());
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(note, "template:titleTemplate"));
        expect(setLabel).toHaveBeenCalledTimes(1);
        setLabel.mockRestore();
        remove.mockRestore();
    });

    it("does not let a write still under way for one template skip the next template's", async () => {
        let finishWrite: () => void = () => {};
        const setLabel = vi.spyOn(attributes, "setLabel")
            .mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }))
            .mockResolvedValue();
        const first = buildNote({ title: "Meeting", "#template": "" });
        const second = buildNote({ title: "Call", "#template": "" });

        const { host, container, field } = await open(first.noteId);
        type(field, "Same");
        await act(async () => {
            field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            container.querySelector(".template-properties-dialog")
                ?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true }));
        });

        await act(async () => {
            const opened = host.handleEventInChildren("showTemplateProperties", { noteId: second.noteId });
            finishWrite();
            await opened;
        });
        const secondField = await vi.waitFor(() => {
            const input = container.querySelector<HTMLInputElement>(".template-properties-dialog .title-template-stub");
            if (!input) throw new Error("expected the second template's field");
            return input;
        });
        type(secondField, "Same");
        await act(async () => {
            secondField.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        await vi.waitFor(() => expect(setLabel).toHaveBeenCalledWith(second.noteId, "template:titleTemplate", "Same"));
        setLabel.mockRestore();
    });

    it("opens another template while a write waits on updates that never come, and reopens with what was typed", async () => {
        vi.spyOn(ws, "waitForMaxKnownEntityChangeId").mockReturnValue(new Promise<void>(() => {}));
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue();
        const first = buildNote({ title: "Meeting", "#template": "" });
        const second = buildNote({ title: "Call", "#template": "", "#template:titleTemplate": "Call notes" });

        const { host, container, field } = await open(first.noteId);
        type(field, "Typed");
        await act(async () => {
            field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        await vi.waitFor(() => expect(setLabel).toHaveBeenCalledWith(first.noteId, "template:titleTemplate", "Typed"));

        const fieldValue = async (noteId: string) => {
            await act(async () => {
                await host.handleEventInChildren("showTemplateProperties", { noteId });
            });
            return container.querySelector<HTMLInputElement>(".template-properties-dialog .title-template-stub")?.value;
        };
        expect(await fieldValue(second.noteId)).toBe("Call notes");
        // froca has not caught up with the first template's write, which the field shows anyway.
        expect(await fieldValue(first.noteId)).toBe("Typed");
        setLabel.mockRestore();
    });

    it("previews the title below the field, filled in against the template's parent", async () => {
        buildNote({
            title: "Projects", children: [ { id: "tplPreview", title: "Meeting", "#template": "" } ]
        });
        const parent = froca.notes["tplPreview"]?.getParentNotes()[0];
        expect(parent?.title).toBe("Projects");
        if (parent) vi.spyOn(parent, "getMetadata").mockResolvedValue({
            dateCreated: "2024-03-05 10:00:00.000+0100", dateModified: "2024-03-05 10:00:00.000+0100",
            utcDateCreated: "2024-03-05 09:00:00.000Z", utcDateModified: "2024-03-05 09:00:00.000Z"
        });

        const { container, field } = await open("tplPreview");
        const preview = () => container.querySelector(".template-properties-dialog .title-template-stub-preview");
        expect(preview()).toBeNull();

        type(field, "Notes for ${parentNote.title}");
        await vi.waitFor(() => expect(preview()?.textContent).toBe("Notes for Projects"));

        // A template the engine refuses has no preview.
        type(field, "${parentNote.constructor}");
        expect(preview()).toBeNull();
    });

    it("sets the template's own ~template:newNoteDefaultParent as a note is picked, and removes it when cleared", async () => {
        const setAttribute = vi.spyOn(attributes, "setAttribute").mockResolvedValue();
        const remove = vi.spyOn(attributes, "removeOwnedRelationByName").mockResolvedValue(true);
        const note = buildNote({ title: "Person", "#template": "", "~template:newNoteDefaultParent": "people" });

        const { container } = await open(note.noteId);
        const picker = container.querySelector<HTMLInputElement>(".template-properties-dialog .tn-card .default-parent-stub");
        expect(picker?.value).toBe("people");

        if (picker) type(picker, "contacts");
        await vi.waitFor(() => expect(setAttribute)
            .toHaveBeenCalledWith(note, "relation", "template:newNoteDefaultParent", "contacts"));

        if (picker) type(picker, "");
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(note, "template:newNoteDefaultParent"));
        setAttribute.mockRestore();
        remove.mockRestore();
    });

    it("leaves a value inherited from the template's ancestors out of the field", async () => {
        buildNote({
            title: "Templates", "#template:titleTemplate(inheritable)": "Inherited",
            children: [ { id: "tplPropsChild", title: "Meeting", "#template": "" } ]
        });

        const { field } = await open("tplPropsChild");
        expect(field.value).toBe("");
    });
});

async function open(noteId: string) {
    const host = new Component();
    const container = renderInto(
        <ParentComponent.Provider value={host}>
            <TemplatePropertiesDialog />
        </ParentComponent.Provider>
    );
    await act(async () => {
        await host.handleEventInChildren("showTemplateProperties", { noteId });
    });
    const field = await vi.waitFor(() => {
        const input = container.querySelector<HTMLInputElement>(
            ".template-properties-dialog .tn-card .title-template-stub");
        if (!input) throw new Error("expected the title template field in a card");
        return input;
    });
    return { host, container, field };
}

function type(field: HTMLInputElement, value: string) {
    act(() => {
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
