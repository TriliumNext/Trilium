import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import TemplateField, { noteTemplateVariables, TemplatePreviewNoteContext } from "./TemplateField";

vi.mock("../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/i18n")>(),
    t: (key: string, opts?: { result?: string }) => (opts?.result !== undefined ? `${key}:${opts.result}` : key)
}));

const METADATA = {
    dateCreated: "2024-03-05 10:00:00.000+0100",
    dateModified: "2024-04-01 09:00:00.000+0100",
    utcDateCreated: "2024-03-05 09:00:00.000Z",
    utcDateModified: "2024-04-01 08:00:00.000Z"
};

describe("noteTemplateVariables", () => {
    it("gives the note what the server's BNote gives a template", async () => {
        const note = buildNote({ title: "Meeting", "#author": "Ada", "#tag": [ "a", "b" ] });
        const { evaluateTemplate } = await import("@triliumnext/commons");

        expect(evaluateTemplate(
            "${note.title} ${note.dateCreatedObj.format('MM-DD')} ${note.getLabelValue('author')} ${note.type}",
            noteTemplateVariables(note, METADATA)
        )).toBe("Meeting 03-05 Ada text");
        // Every method the engine allows on a note, so that a template it accepts has a preview.
        expect(evaluateTemplate(
            "${note.getLabelValues('tag')}",
            noteTemplateVariables(note, METADATA)
        )).toBe("a,b");
    });
});

describe("TemplateField", () => {
    it("shows the template filled in for the preview note, and nothing for a refused one", async () => {
        const note = buildNote({ title: "Meeting" });
        vi.spyOn(note, "getMetadata").mockResolvedValue(METADATA);

        const container = await mount("NEW: ${note.title}", note.noteId);
        expect(container.querySelector(".template-field-preview")?.textContent)
            .toBe("template_field.preview:NEW: Meeting");

        const refused = await mount("NEW: ${note.constructor}", note.noteId);
        expect(refused.querySelector(".cm-editor")).not.toBeNull();
        expect(refused.querySelector(".template-field-preview")).toBeNull();
    });

    it("shows the preview its caller gives, over the note's", async () => {
        const note = buildNote({ title: "Meeting" });
        vi.spyOn(note, "getMetadata").mockResolvedValue(METADATA);

        let container: HTMLElement | undefined;
        await act(async () => {
            container = renderInto(
                <TemplatePreviewNoteContext.Provider value={note.noteId}>
                    <TemplateField currentValue="${note.title}" preview="Given" onChange={() => {}} variables={{ note: "note" }} />
                </TemplatePreviewNoteContext.Provider>
            );
        });
        expect(container?.querySelector(".template-field-preview")?.textContent).toBe("template_field.preview:Given");
    });

    it("shows no preview without a note to preview against", async () => {
        const container = await mount("NEW: ${note.title}", undefined);
        expect(container.querySelector(".cm-editor")).not.toBeNull();
        expect(container.querySelector(".template-field-preview")).toBeNull();
    });
});

async function mount(value: string, noteId: string | undefined) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <TemplatePreviewNoteContext.Provider value={noteId}>
                <TemplateField currentValue={value} onChange={() => {}} variables={{ note: "note" }} />
            </TemplatePreviewNoteContext.Provider>
        );
    });
    // The note and its metadata are read asynchronously.
    for (let attempt = 0; attempt < 5; attempt++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
        });
    }
    if (!container) throw new Error("Not rendered.");
    return container;
}
