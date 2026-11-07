import type { EditedNotesResponse } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import LoadResults from "../../services/load_results";
import options from "../../services/options";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import NoteTitleActions from "./NoteTitleActions";

// The attribute grid has a spec of its own; here one cell is enough for the section to show.
vi.mock("../PromotedAttributes", () => ({
    usePromotedAttributeData: () => [ [ { uniqueId: "cell" } ], () => {} ],
    PromotedAttributesContent: () => <div className="promoted-attributes-stub" />
}));
vi.mock("../NoteDetail", () => ({
    getExtendedWidgetType: async () => "text",
    checkFullHeight: () => true
}));
vi.mock("./NoteTypeSwitcher", () => ({ default: () => null }));
vi.mock("./PinnedAttachments", () => ({ default: () => null }));

afterEach(() => {
    vi.restoreAllMocks();
});

describe("NoteTitleActions", () => {
    it("toggles the promoted attributes on their shortcut only for its own note context", async () => {
        const note = buildNote({ title: "Text", type: "text" });
        const { container, parent } = await mount(note, "ntx-split-2");
        const expanded = () => container.querySelector("[aria-expanded]")
            ?.getAttribute("aria-expanded");
        expect(expanded()).toBe("false");

        await act(async () => { await parent.handleEvent("toggleRibbonTabPromotedAttributes", { ntxId: "ntx-split-1" }); });
        expect(expanded()).toBe("false");

        await act(async () => { await parent.handleEvent("toggleRibbonTabPromotedAttributes", { ntxId: "ntx-split-2" }); });
        expect(expanded()).toBe("true");
    });

    it("refetches the edited notes on an option change, keeping the newest reply", async () => {
        const chat = buildNote({ title: "Chat", type: "llmChat" });
        const text = buildNote({ title: "Edited text" });
        const dayNote = buildNote({ title: "04 - Wednesday", "#dateNote": "2026-11-04" });
        options.set("editedNotesOpenInRibbon", "true");
        options.set("editedNotesIncludeLlmChats", "true");

        const replies: Array<(notes: EditedNotesResponse) => void> = [];
        const isEditedNotes = (url: string) => url.startsWith("edited-notes/");
        const get = vi.spyOn(server, "get").mockImplementation(((url: string) => (isEditedNotes(url)
            ? new Promise((resolve) => { replies.push(resolve); })
            : Promise.resolve({}))) as never);
        const editedNotesRequests = () => get.mock.calls.filter(([ url ]) => isEditedNotes(url));

        const { container, parent } = await mount(dayNote, "ntx-day");
        expect(editedNotesRequests()).toEqual([ [ "edited-notes/2026-11-04" ] ]);

        options.set("editedNotesIncludeLlmChats", "false");
        const loadResults = new LoadResults([]);
        loadResults.addOption("editedNotesIncludeLlmChats");
        await act(async () => { await parent.handleEvent("entitiesReloaded", { loadResults }); });
        expect(editedNotesRequests()).toHaveLength(2);

        await act(async () => {
            replies[1]?.(reply(text));
            await new Promise((resolve) => setTimeout(resolve, 0));
            replies[0]?.(reply(chat, text));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const badges = [ ...container.querySelectorAll(".edited-notes a.badge") ];
        expect(badges.map((a) => a.getAttribute("href"))).toEqual([ `#${text.noteId}` ]);
    });
});

async function mount(note: FNote, ntxId: string) {
    const noteContext = new NoteContext(ntxId);
    noteContext.noteId = note.noteId;
    noteContext.viewScope = { viewMode: "default" };
    const parent = new Component();
    let container: HTMLElement = document.createElement("div");
    await act(async () => {
        container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <NoteTitleActions />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        );
    });
    return { container, parent };
}

function reply(...notes: FNote[]): EditedNotesResponse {
    return notes.map((note) => ({ noteId: note.noteId, isDeleted: false }));
}
