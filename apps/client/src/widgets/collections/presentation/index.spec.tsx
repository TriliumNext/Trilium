import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import LoadResults from "../../../services/load_results";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import PresentationView from "./index";
import { buildPresentationModel } from "./model";

// i18next is never initialized under test, so `t()` looks keys up in the English catalog itself.
vi.mock("../../../services/i18n", async (importOriginal) => {
    const { default: english } = await import("../../../translations/en/translation.json");
    return {
        ...await importOriginal<typeof import("../../../services/i18n")>(),
        t: (key: string) => key.split(".").reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part], english
        )
    };
});

vi.mock("./model", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./model")>();
    return { ...actual, buildPresentationModel: vi.fn(actual.buildPresentationModel) };
});

vi.mock("./themes", async (importOriginal) => ({
    ...await importOriginal<typeof import("./themes")>(),
    loadPresentationTheme: async () => ""
}));

describe("an empty presentation", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function renderEmpty(labels: Record<string, string> = {}) {
        options.set("presentationSidebarVisible", "true");
        const note = buildNote({ title: "Deck", type: "book", "#viewType": "presentation", ...labels });
        const onReady = vi.fn();
        const container = renderPresentation(note, onReady);
        await vi.waitFor(() => expect(container.querySelector(".no-items")).not.toBeNull());
        return { note, container, onReady };
    }

    it("shows, in place of the slides and their sidebar, a way to create the first", async () => {
        const createNote = vi.spyOn(note_create, "createNote")
            .mockResolvedValue({ note: { noteId: "first" } } as Awaited<ReturnType<typeof note_create.createNote>>);
        const { note, container, onReady } = await renderEmpty();

        expect(container.querySelector(".presentation-sidebar")).toBeNull();
        expect(container.querySelector(".presentation-container")).toBeNull();
        expect(onReady).toHaveBeenCalled();

        const toolbarButton = (icon: string) => container.querySelector<HTMLButtonElement>(`button.${icon}`);
        for (const icon of [ "bx-sidebar", "bx-edit", "bx-palette", "bx-grid-horizontal", "bx-fullscreen" ]) {
            expect(toolbarButton(icon)?.disabled, icon).toBe(true);
        }
        expect(toolbarButton("bx-sidebar")?.classList.contains("active")).toBe(false);
        expect(toolbarButton("bx-plus")?.disabled).toBe(false);

        const button = container.querySelector<HTMLButtonElement>(".no-items button");
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(createNote).toHaveBeenCalledWith(note.noteId, expect.objectContaining({ type: "text", activate: false }));
    });

    it("creates a canvas slide from the menu beside the toolbar's and the placeholder's new slide button", async () => {
        const createNote = vi.spyOn(note_create, "createNote")
            .mockResolvedValue({ note: { noteId: "first" } } as Awaited<ReturnType<typeof note_create.createNote>>);
        const { note, container } = await renderEmpty();

        for (const split of [ ".presentation-new-slide", ".no-items" ]) {
            createNote.mockClear();
            const toggle = container.querySelector<HTMLElement>(`${split} .dropdown button`);
            expect(toggle, split).not.toBeNull();
            await act(async () => toggle?.click());
            const items = await vi.waitFor(() => {
                const found = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
                expect(found.map(item => item.textContent?.trim())).toEqual([
                    "Text", "Canvas", "Board", "Table", "Web View", "Code", "Spreadsheet"
                ]);
                // The slides edited in place come first, apart from the others.
                expect(found[2].previousElementSibling?.classList.contains("dropdown-divider")).toBe(true);
                return found;
            });
            await act(async () => items[1].click());
            expect(createNote).toHaveBeenCalledWith(note.noteId, expect.objectContaining({ type: "canvas" }));
        }
    });

    it("offers no way to create a slide in a read-only presentation", async () => {
        const { container } = await renderEmpty({ "#readOnly": "" });
        expect(container.querySelector(".no-items button")).toBeNull();
    });
});

describe("reloading the presentation", () => {
    it("builds the slides again when an attachment of a slide changes, as a canvas's picture does", async () => {
        const note = buildNote({ title: "Deck", type: "book", "#viewType": "presentation" });
        const parent = new Component();
        const container = renderPresentation(note, vi.fn(), { parent, noteIds: [ "drawing" ] });
        await vi.waitFor(() => expect(container.querySelector(".no-items")).not.toBeNull());
        const builds = vi.mocked(buildPresentationModel).mock.calls.length;

        const attachmentChanged = (ownerId: string) => {
            const loadResults = new LoadResults([]);
            loadResults.addAttachmentRow({
                attachmentId: `picture-of-${ownerId}`, ownerId, role: "image", mime: "image/svg+xml", title: "canvas-export.svg"
            });
            return loadResults;
        };
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: attachmentChanged("elsewhere") });
        });
        expect(buildPresentationModel).toHaveBeenCalledTimes(builds);

        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: attachmentChanged("drawing") });
        });
        expect(buildPresentationModel).toHaveBeenCalledTimes(builds + 1);
    });
});

function renderPresentation(
    note: FNote, onReady: () => void,
    { parent = new Component(), noteIds = [] }: { parent?: Component; noteIds?: string[] } = {}
) {
    const noteContext = new NoteContext("ntx-presentation");
    noteContext.noteId = note.noteId;
    return renderInto(
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <PresentationView
                    note={note}
                    notePath={note.noteId}
                    noteIds={noteIds}
                    highlightedTokens={undefined}
                    viewConfig={undefined}
                    saveConfig={() => {}}
                    media="screen"
                    onReady={onReady}
                />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}
