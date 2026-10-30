// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { h } from "preact";
import { beforeAll, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import ws from "../../../services/ws";
import { buildNote } from "../../../test/easy-froca";
import {
    applySlideMove, buildPresentationModel, createSlide, deleteSlide, duplicateSlide, getNewSlidePosition,
    canEditSlideInPlace, getNewSlideTypes, getNewVerticalSlidePosition, getSlideMove, isSlideRebuilt, moveSlideNote, PresentationModel,
    type PresentationSlideBaseModel, renderSlideContent
} from "./model";

// The code languages enabled in the code note options, in their order.
vi.mock("../../../services/mime_types", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../services/mime_types")>();
    return {
        default: {
            ...actual.default,
            loadMimeTypes: () => {},
            getEnabledMimeTypes: () => [
                { mime: "text/plain", title: "Plain text" },
                { mime: "text/x-python", title: "Python", icon: "bx bxl-python" }
            ]
        }
    };
});

vi.mock("../../type_widgets/llm_chat/ChatPreview", () => ({
    default: ({ messages }: { messages: { content: string }[] }) =>
        h("p", { class: "chat-preview" }, messages.map((message) => message.content).join(", "))
}));

let presentationNote!: FNote;
let data!: PresentationModel;

describe("Presentation model", () => {
    beforeAll(async () => {
        presentationNote = buildNote({
            title: "Presentation",
            id: "presentation",
            "#viewType": "presentation",
            "children": [
                {
                    id: "slide1",
                    title: "First slide",
                    children: [
                        {
                            id: "slide2",
                            title: "First-sub",
                            content: `<p>Go to&nbsp;<a class="reference-link" href="#root/other">Other note</a>.</p>`
                        }
                    ]
                },
                {
                    title: "Second slide",
                    id: "slide3",
                    content: `<p>Go to&nbsp;<a class="reference-link" href="#root/presentation/slide1">First slide</a>.</p>`,
                    children: [
                        {
                            id: "slide4",
                            title: "Second-sub",
                            content: `<p>Go to&nbsp;<a class="reference-link" href="#root/presentation/slide2">First-sub</a>.</p>`,
                        }
                    ]
                }
            ]
        });
        buildNote({
            id: "other",
            title: "Other note"
        });
        data = await buildPresentationModel(presentationNote);
    });

    it("it correctly maps horizontal and vertical slides", () => {
        expect(data).toMatchObject({
            slides: [
                {
                    noteId: "slide1",
                    verticalSlides: [
                        {
                            noteId: "slide2"
                        }
                    ]
                },
                {
                    noteId: "slide3",
                    verticalSlides: [
                        {
                            noteId: "slide4"
                        }
                    ]
                }
            ]
        });
    });

    it("empty slides don't render children", () => {
        expect(data.slides[0].content.__html).toStrictEqual("");
    });

    it("rewrites links to other slides", () => {
        expect(data.slides[1].content.__html).toStrictEqual(`<div class="ck-content"><p>Go to&nbsp;<a class="reference-link" href="#/slide-slide1"><span><span class="tn-icon bx bx-folder"></span>First slide</span></a>.</p></div>`);
        expect(data.slides[1].verticalSlides![0].content.__html).toStrictEqual(`<div class="ck-content"><p>Go to&nbsp;<a class="reference-link" href="#/slide-slide2"><span><span class="tn-icon bx bx-note"></span>First-sub</span></a>.</p></div>`);
    });

    it("rewrites links even if they are not part of the slideshow", () => {
        expect(data.slides[0].verticalSlides![0].content.__html).toStrictEqual(`<div class="ck-content"><p>Go to&nbsp;<a class="reference-link" href="#/slide-other"><span><span class="tn-icon bx bx-note"></span>Other note</span></a>.</p></div>`);
    });

    it("keeps the content of a slide that mounts a component", async () => {
        const messages = [ { id: "m0", role: "user", content: "Hello", createdAt: "2026-01-01" } ];
        const chatPresentation = buildNote({
            title: "Chat presentation",
            "#viewType": "presentation",
            children: [ {
                title: "Chat",
                type: "llmChat",
                content: JSON.stringify({ version: 1, messages })
            } ]
        });

        const { slides } = await buildPresentationModel(chatPresentation);

        expect(slides[0].content.__html).toStrictEqual(
            `<div class="note-detail-llm-chat-preview"><p class="chat-preview">Hello</p></div>`
        );
    });
});

describe("Presentation model with web views", () => {
    it("shows a web view in the slide background, but only for an http or https URL", async () => {
        const presentation = buildNote({
            title: "Web views",
            "#viewType": "presentation",
            children: [
                { id: "webHttps", title: "Site", type: "webView", "#webViewSrc": "https://example.com/page" },
                { id: "webScript", title: "Script", type: "webView", "#webViewSrc": "javascript:alert(1)" },
                { id: "webBlank", title: "Blank", type: "webView" }
            ]
        });

        const { slides } = await buildPresentationModel(presentation);

        expect(slides.map(({ noteId, webViewSrc, content }) => ({ noteId, webViewSrc, content }))).toStrictEqual([
            { noteId: "webHttps", webViewSrc: "https://example.com/page", content: { __html: "" } },
            { noteId: "webScript", webViewSrc: undefined, content: { __html: "" } },
            { noteId: "webBlank", webViewSrc: undefined, content: { __html: "" } }
        ]);
    });
});

describe("Presentation model with collections", () => {
    it("shows a board or table collection on one slide, and keeps the child notes of other collections as vertical slides", async () => {
        const presentation = buildNote({
            title: "Collections",
            "#viewType": "presentation",
            children: [
                {
                    id: "boardSlide", title: "Board", type: "book", "#viewType": "board",
                    children: [ { id: "boardCard", title: "Card", content: "<p>Card</p>" } ]
                },
                {
                    id: "tableSlide", title: "Table", type: "book", "#viewType": "table",
                    children: [ { id: "tableRow", title: "Row", content: "<p>Row</p>" } ]
                },
                {
                    id: "chapterSlide", title: "Chapter", type: "book", "#viewType": "grid",
                    children: [ { id: "chapterChild", title: "Child", content: "<p>Child</p>" } ]
                }
            ]
        });

        const { slides } = await buildPresentationModel(presentation);

        expect(slides.map(({ noteId, isCollection, content, verticalSlides }) => ({
            noteId,
            isCollection,
            content,
            verticalSlides: verticalSlides?.map(slide => slide.noteId)
        }))).toStrictEqual([
            { noteId: "boardSlide", isCollection: true, content: { __html: "" }, verticalSlides: undefined },
            { noteId: "tableSlide", isCollection: true, content: { __html: "" }, verticalSlides: undefined },
            { noteId: "chapterSlide", isCollection: undefined, content: expect.any(Object), verticalSlides: [ "chapterChild" ] }
        ]);
    });
});

describe("Presentation model with read-only slides", () => {
    it("marks the slides of read-only notes", async () => {
        const presentation = buildNote({
            title: "Read-only",
            "#viewType": "presentation",
            children: [
                { id: "lockedSlide", title: "Locked", content: "<p>Locked</p>", "#readOnly": "" },
                { id: "openSlide", title: "Open", content: "<p>Open</p>" }
            ]
        });

        const { slides } = await buildPresentationModel(presentation);

        expect(slides.map(({ noteId, isReadOnly }) => ({ noteId, isReadOnly }))).toStrictEqual([
            { noteId: "lockedSlide", isReadOnly: true },
            { noteId: "openSlide", isReadOnly: undefined }
        ]);
    });
});

describe("renderSlideContent", () => {
    it("renders the content an editor held, with its links pointing at slides", async () => {
        const note = buildNote({ id: "editedSlide", title: "Edited", content: "<p>Saved</p>" });

        const link = `<a class="reference-link" href="#root/presentation/slide1">Link</a>`;
        const content = await renderSlideContent(note, `<p>Typed&nbsp;${link}</p>`);

        expect(content.__html).toContain("Typed");
        expect(content.__html).not.toContain("Saved");
        expect(content.__html).toContain(`href="#/slide-slide1"`);
    });
});

describe("getNewSlidePosition", () => {
    const model: PresentationModel = {
        slides: [
            { noteId: "a", type: "text", content: { __html: "" }, verticalSlides: [
                { noteId: "a1", type: "text", content: { __html: "" } },
                { noteId: "a2", type: "text", content: { __html: "" } }
            ] },
            { noteId: "b", type: "text", content: { __html: "" }, verticalSlides: undefined }
        ]
    };

    it("places a new slide after the slide being shown, at its level", () => {
        // After a top-level slide, past its vertical slides.
        expect(getNewSlidePosition(model, "deck", "a")).toEqual({ parentNoteId: "deck", afterNoteId: "a" });
        expect(getNewSlidePosition(model, "deck", "b")).toEqual({ parentNoteId: "deck", afterNoteId: "b" });
        // Among the vertical slides of a slide.
        expect(getNewSlidePosition(model, "deck", "a1")).toEqual({ parentNoteId: "a", afterNoteId: "a1" });
        // At the end, when no slide is shown.
        expect(getNewSlidePosition(model, "deck", undefined)).toEqual({ parentNoteId: "deck", afterNoteId: undefined });
        expect(getNewSlidePosition(model, "deck", "gone")).toEqual({ parentNoteId: "deck", afterNoteId: undefined });
    });
});

describe("canEditSlideInPlace", () => {
    it("edits text, canvas and collection slides in place, unless their note is read-only", () => {
        const slide = (props: Partial<PresentationSlideBaseModel>): PresentationSlideBaseModel => ({
            noteId: "slide", type: "text", content: { __html: "" }, ...props
        });
        expect(canEditSlideInPlace(slide({}))).toBe(true);
        expect(canEditSlideInPlace(slide({ type: "canvas" }))).toBe(true);
        expect(canEditSlideInPlace(slide({ type: "book", isCollection: true }))).toBe(true);
        expect(canEditSlideInPlace(slide({ type: "code" }))).toBe(false);
        expect(canEditSlideInPlace(slide({ type: "webView", webViewSrc: "https://example.com/" }))).toBe(false);
        expect(canEditSlideInPlace(slide({ isReadOnly: true }))).toBe(false);
    });
});

describe("getNewSlideTypes", () => {
    it("lists the slides edited in place, then the others that a slide shows, with how each starts editing", () => {
        expect(getNewSlideTypes().map(group => group.map(({ type, startsEditing }) => [ type, startsEditing ])))
            .toEqual([
                [ [ "text", "inPlace" ], [ "canvas", "inPlace" ] ],
                [
                    [ "board", "inPlace" ], [ "table", "inPlace" ], [ "mermaid", "quickEdit" ],
                    [ "webView", undefined ], [ "code", undefined ], [ "spreadsheet", undefined ]
                ]
            ]);
    });

    it("offers a code slide in each code language that the code note options enable", () => {
        const code = getNewSlideTypes().flat().find(({ type }) => type === "code");
        expect(code?.languages?.map(({ type, mime, title, icon }) => ({ type, mime, title, icon }))).toEqual([
            { type: "code", mime: "text/plain", title: "Plain text", icon: "bx bx-code" },
            { type: "code", mime: "text/x-python", title: "Python", icon: "bx bxl-python" }
        ]);
    });
});

describe("createSlide", () => {
    it("creates a text or canvas note after a slide under its parent, or at the end", async () => {
        buildNote({ id: "deck", title: "Deck", children: [ { id: "a", title: "A" } ] });
        const getBranchId = vi.spyOn(froca, "getBranchId").mockResolvedValue("deck_a");
        const createNote = vi.spyOn(note_create, "createNote")
            .mockResolvedValue({ note: { noteId: "created" } } as Awaited<ReturnType<typeof note_create.createNote>>);

        await expect(createSlide({ parentNoteId: "deck", afterNoteId: "a" })).resolves.toBe("created");
        expect(getBranchId).toHaveBeenCalledWith("deck", "a");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "text", activate: false, target: "after", targetBranchId: "deck_a"
        }));

        await createSlide({ parentNoteId: "deck", afterNoteId: undefined });
        expect(createNote.mock.lastCall?.[1]).not.toHaveProperty("targetBranchId");

        await createSlide({ parentNoteId: "deck", afterNoteId: undefined }, "canvas");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "canvas", mime: "application/json"
        }));

        // A board or a table is a collection made from its built-in template, as the app makes one.
        await createSlide({ parentNoteId: "deck", afterNoteId: undefined }, "board");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "book", templateNoteId: "_template_board"
        }));
        await createSlide({ parentNoteId: "deck", afterNoteId: undefined }, "code");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "code", mime: "text/plain"
        }));
        await createSlide({ parentNoteId: "deck", afterNoteId: undefined }, "code", "text/x-python");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "code", mime: "text/x-python"
        }));
        await createSlide({ parentNoteId: "deck", afterNoteId: undefined }, "mermaid");
        expect(createNote).toHaveBeenLastCalledWith("deck", expect.objectContaining({
            type: "mermaid", mime: "text/mermaid"
        }));

        getBranchId.mockRestore();
        createNote.mockRestore();
    });
});

describe("getNewVerticalSlidePosition", () => {
    it("places a new vertical slide after the last vertical slide of a slide, or as its first", () => {
        const model: PresentationModel = {
            slides: [
                { noteId: "a", type: "text", content: { __html: "" }, verticalSlides: [
                    { noteId: "a1", type: "text", content: { __html: "" } },
                    { noteId: "a2", type: "text", content: { __html: "" } }
                ] },
                { noteId: "b", type: "text", content: { __html: "" }, verticalSlides: undefined }
            ]
        };
        expect(getNewVerticalSlidePosition(model, "a")).toEqual({ parentNoteId: "a", afterNoteId: "a2" });
        expect(getNewVerticalSlidePosition(model, "b")).toEqual({ parentNoteId: "b", afterNoteId: undefined });
    });
});

describe("duplicating and deleting slides", () => {
    const model: PresentationModel = {
        slides: [
            { noteId: "a", type: "text", content: { __html: "" }, verticalSlides: [
                { noteId: "a1", type: "text", content: { __html: "" } }
            ] }
        ]
    };

    it("duplicates a slide with its vertical slides, right after it, without opening the copy", async () => {
        vi.spyOn(froca, "getBranchId").mockImplementation(async (parentNoteId, childNoteId) => `${parentNoteId}_${childNoteId}`);
        const post = vi.spyOn(server, "post").mockResolvedValue({ note: { noteId: "copy" }, branch: { branchId: "a_copy" } });
        vi.spyOn(ws, "waitForMaxKnownEntityChangeId").mockResolvedValue(undefined);
        const moveAfter = vi.spyOn(branches, "moveAfterBranch").mockResolvedValue(undefined);

        await expect(duplicateSlide(model, "deck", "a1")).resolves.toBe("copy");
        expect(post).toHaveBeenCalledWith("notes/a1/duplicate/a");
        expect(moveAfter).toHaveBeenCalledWith([ "a_copy" ], "a_a1");

        await expect(duplicateSlide(model, "deck", "gone")).resolves.toBeUndefined();
        expect(post).toHaveBeenCalledOnce();
        vi.restoreAllMocks();
    });

    it("deletes a slide's branch through the delete dialog, staying in the presentation", async () => {
        vi.spyOn(froca, "getBranchId").mockImplementation(async (parentNoteId, childNoteId) => `${parentNoteId}_${childNoteId}`);
        const deleteNotes = vi.spyOn(branches, "deleteNotes").mockResolvedValue(true);

        await expect(deleteSlide(model, "deck", "a")).resolves.toBe(true);
        expect(deleteNotes).toHaveBeenCalledWith([ "deck_a" ], false, false);

        // A canceled dialog.
        deleteNotes.mockResolvedValue(false);
        await expect(deleteSlide(model, "deck", "a")).resolves.toBe(false);
        vi.restoreAllMocks();
    });
});

describe("moving slides", () => {
    const slide = (noteId: string, extra = {}) => ({ noteId, type: "text" as const, content: { __html: "" }, ...extra });
    // In sidebar order: a, a1, a2, a3, b, c, board.
    const model: PresentationModel = {
        slides: [
            { ...slide("a"), verticalSlides: [ slide("a1"), slide("a2"), slide("a3") ] },
            { ...slide("b"), verticalSlides: undefined },
            { ...slide("c"), verticalSlides: undefined },
            { ...slide("board", { isCollection: true }), verticalSlides: undefined }
        ]
    };
    const unsorted = () => false;
    const move = (
        noteId: string, gap: number, levelShift: -1 | 0 | 1 = 0,
        isSorted: (parentNoteId: string) => boolean = unsorted
    ) => (
        getSlideMove(model, "deck", noteId, gap, levelShift, isSorted)
    );

    it("keeps the level of a slide dragged straight", () => {
        // A top-level slide goes before the next top-level slide, past a stack it is over.
        expect(move("c", 0)).toEqual({ noteId: "c", targetNoteId: "a", position: "before" });
        expect(move("c", 2)).toEqual({ noteId: "c", targetNoteId: "b", position: "before" });
        expect(move("a", 7)).toEqual({ noteId: "a", targetNoteId: "board", position: "after" });
        // A vertical slide stays vertical: after the slide above the gap, or as the first vertical slide
        // of a top-level slide without any.
        expect(move("a3", 2)).toEqual({ noteId: "a3", targetNoteId: "a1", position: "after" });
        expect(move("a1", 5)).toEqual({ noteId: "a1", targetNoteId: "b", position: "into" });
    });

    it("changes the level of a slide dragged sideways", () => {
        expect(move("c", 4, 1)).toEqual({ noteId: "c", targetNoteId: "a3", position: "after" });
        expect(move("c", 1, 1)).toEqual({ noteId: "c", targetNoteId: "a1", position: "before" });
        expect(move("c", 5, 1)).toEqual({ noteId: "c", targetNoteId: "b", position: "into" });
        expect(move("a2", 4, -1)).toEqual({ noteId: "a2", targetNoteId: "b", position: "before" });
        expect(move("a2", 2, -1)).toEqual({ noteId: "a2", targetNoteId: "b", position: "before" });
    });

    it("refuses a drop that changes nothing, breaks the two levels, or goes where order is not kept", () => {
        // No change.
        expect(move("b", 4)).toBeUndefined();
        expect(move("b", 5)).toBeUndefined();
        expect(move("a2", 2)).toBeUndefined();
        expect(move("a2", 3)).toBeUndefined();
        expect(move("a1", 1)).toBeUndefined();
        // Into itself.
        expect(move("b", 5, 1)).toBeUndefined();
        // A slide with vertical slides of its own stays top-level.
        expect(move("a", 7, 1)).toBeUndefined();
        // A board or table slide shows its own children.
        expect(move("c", 7, 1)).toBeUndefined();
        // Above the first slide there is no slide to be vertical under.
        expect(move("a2", 0)).toBeUndefined();
        // The children of a #sorted note.
        expect(move("a3", 1, 0, (parentNoteId) => parentNoteId === "a")).toBeUndefined();
        expect(move("c", 4, 1, (parentNoteId) => parentNoteId === "a")).toBeUndefined();
        expect(move("c", 0, 0, (parentNoteId) => parentNoteId === "a")).not.toBeUndefined();
    });

    it("applies a move to the model, keeping a slide's vertical slides with it", () => {
        const order = (presentation: PresentationModel) => presentation.slides.map(s => [
            s.noteId, ...s.verticalSlides?.map(v => v.noteId) ?? []
        ].join(" "));

        expect(order(applySlideMove(model, { noteId: "a", targetNoteId: "c", position: "after" })))
            .toEqual([ "b", "c", "a a1 a2 a3", "board" ]);
        expect(order(applySlideMove(model, { noteId: "a3", targetNoteId: "a1", position: "before" })))
            .toEqual([ "a a3 a1 a2", "b", "c", "board" ]);
        // Between levels: a stack loses its last slide, or a slide gains its first.
        expect(order(applySlideMove(applySlideMove(model, { noteId: "c", targetNoteId: "b", position: "into" }),
            { noteId: "b", targetNoteId: "a", position: "before" }))).toEqual([ "b c", "a a1 a2 a3", "board" ]);
        expect(order(applySlideMove(applySlideMove(model, { noteId: "c", targetNoteId: "b", position: "into" }),
            { noteId: "c", targetNoteId: "board", position: "before" }))).toEqual([ "a a1 a2 a3", "b", "c", "board" ]);
        expect(applySlideMove(model, { noteId: "a2", targetNoteId: "b", position: "before" }).slides[1])
            .toEqual({ ...slide("a2"), verticalSlides: undefined });
        // The model it was given stays as it was.
        expect(order(model)).toEqual([ "a a1 a2 a3", "b", "c", "board" ]);
    });

    it("tells whether a move rebuilds the section of a slide", () => {
        const into = applySlideMove(model, { noteId: "c", targetNoteId: "b", position: "into" });
        expect(isSlideRebuilt(model, into, "c")).toBe(true);
        expect(isSlideRebuilt(model, into, "b")).toBe(true);
        expect(isSlideRebuilt(model, into, "a")).toBe(false);
        const reordered = applySlideMove(model, { noteId: "a3", targetNoteId: "a1", position: "before" });
        expect(isSlideRebuilt(model, reordered, "a3")).toBe(false);
    });

    it("moves the slide's branch next to the target's, or under the target", async () => {
        const getBranchId = vi.spyOn(froca, "getBranchId")
            .mockImplementation(async (parentNoteId, childNoteId) => `${parentNoteId}_${childNoteId}`);
        const moveBefore = vi.spyOn(branches, "moveBeforeBranch").mockResolvedValue(undefined);
        const moveAfter = vi.spyOn(branches, "moveAfterBranch").mockResolvedValue(undefined);
        const moveTo = vi.spyOn(branches, "moveToParentNote").mockResolvedValue(undefined);

        await expect(moveSlideNote(model, "deck", { noteId: "c", targetNoteId: "a", position: "before" }))
            .resolves.toBe(true);
        expect(moveBefore).toHaveBeenCalledWith([ "deck_c" ], "deck_a");

        // To another level, next to a slide under another parent.
        await moveSlideNote(model, "deck", { noteId: "c", targetNoteId: "a3", position: "after" });
        expect(moveAfter).toHaveBeenCalledWith([ "deck_c" ], "a_a3");

        await moveSlideNote(model, "deck", { noteId: "a1", targetNoteId: "b", position: "into" });
        expect(moveTo).toHaveBeenCalledWith([ "a_a1" ], "deck_b");

        // A branch that froca cannot find moves nothing.
        getBranchId.mockResolvedValue(null);
        moveBefore.mockClear();
        await expect(moveSlideNote(model, "deck", { noteId: "c", targetNoteId: "a", position: "before" }))
            .resolves.toBe(false);
        expect(moveBefore).not.toHaveBeenCalled();

        vi.restoreAllMocks();
    });
});
