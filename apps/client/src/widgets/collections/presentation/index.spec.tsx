import { act } from "preact/test-utils";
import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import LoadResults from "../../../services/load_results";
import note_create from "../../../services/note_create";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import type { ViewModeMedia } from "../interface";
import PresentationView from "./index";
import {
    buildPresentationModel, createSlide, deleteSlide, duplicateSlide, getNewSlideTypes, moveSlideNote,
    type PresentationModel, type SlideMove
} from "./model";
import type SlideSidebar from "./sidebar";
import type SlideEditor from "./slide_editor";
import type { Presentation } from "./slides";

type PresentationProps = Parameters<typeof Presentation>[0];
type SlideSidebarProps = Parameters<typeof SlideSidebar>[0];
type SlideEditorProps = Parameters<typeof SlideEditor>[0];

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
    return {
        ...actual,
        buildPresentationModel: vi.fn(actual.buildPresentationModel),
        createSlide: vi.fn(actual.createSlide),
        duplicateSlide: vi.fn(actual.duplicateSlide),
        deleteSlide: vi.fn(actual.deleteSlide),
        moveSlideNote: vi.fn(actual.moveSlideNote)
    };
});

/** The props of the stubbed slides, sidebar and slide editor, as they last rendered. */
const rendered = vi.hoisted(() => ({
    slides: undefined as PresentationProps | undefined,
    sidebar: undefined as SlideSidebarProps | undefined,
    editor: undefined as SlideEditorProps | undefined
}));

vi.mock("./slides", () => ({
    Presentation: (props: PresentationProps) => {
        rendered.slides = props;
        return null;
    },
    CollectionSlides: () => null
}));

vi.mock("./sidebar", () => ({
    default: (props: SlideSidebarProps) => {
        rendered.sidebar = props;
        return null;
    }
}));

vi.mock("./slide_editor", () => ({
    default: (props: SlideEditorProps) => {
        rendered.editor = props;
        return null;
    }
}));

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

        // The controls stand on the stage, which an empty presentation has none of.
        expect(container.querySelector(".presentation-controls")).toBeNull();
        const sidebarToggle = container.querySelector<HTMLButtonElement>("button.bx-sidebar");
        expect(sidebarToggle?.disabled).toBe(true);
        expect(sidebarToggle?.classList.contains("active")).toBe(false);

        const button = container.querySelector<HTMLButtonElement>(".no-items button");
        expect(button).not.toBeNull();
        await act(async () => button?.click());
        expect(createNote).toHaveBeenCalledWith(note.noteId, expect.objectContaining({ type: "text", activate: false }));
    });

    it("creates a canvas slide from the menu beside the placeholder's new slide button", async () => {
        const createNote = vi.spyOn(note_create, "createNote")
            .mockResolvedValue({ note: { noteId: "first" } } as Awaited<ReturnType<typeof note_create.createNote>>);
        const { note, container } = await renderEmpty();

        const toggle = container.querySelector<HTMLElement>(".no-items .dropdown button");
        expect(toggle).not.toBeNull();
        await act(async () => toggle?.click());
        const items = await vi.waitFor(() => {
            const found = [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ];
            expect(found.map(item => item.textContent?.trim())).toEqual([
                "Text", "Canvas", "Board", "Table", "Mermaid Diagram", "Web View", "Code", "Spreadsheet"
            ]);
            // The slides edited in place come first, apart from the others.
            expect(found[2].previousElementSibling?.classList.contains("dropdown-divider")).toBe(true);
            return found;
        });
        await act(async () => items[1].click());
        expect(createNote).toHaveBeenCalledWith(note.noteId, expect.objectContaining({ type: "canvas" }));
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

describe("changing slides from the view", () => {
    const actualBuild = vi.mocked(buildPresentationModel).getMockImplementation();

    afterEach(() => {
        vi.mocked(buildPresentationModel).mockImplementation(actualBuild ?? (async () => ({ slides: [] })));
        vi.restoreAllMocks();
        rendered.slides = undefined;
        rendered.sidebar = undefined;
        rendered.editor = undefined;
    });

    /** Renders a deck of a slide with a vertical slide below it and a second slide, on a stubbed Reveal.js. */
    async function renderDeck() {
        options.set("presentationSidebarVisible", "true");
        for (const id of [ "first", "below", "second", "added" ]) buildNote({ id, title: id, type: "text" });
        const note = buildNote({ title: "Deck", type: "book", "#viewType": "presentation" });
        const model: PresentationModel = { slides: [
            { noteId: "first", type: "text", content: { __html: "" }, verticalSlides: [
                { noteId: "below", type: "text", content: { __html: "" } }
            ] },
            { noteId: "second", type: "text", content: { __html: "" }, verticalSlides: undefined }
        ] };
        vi.mocked(buildPresentationModel).mockImplementation(async () => model);
        const onReady = vi.fn();
        renderPresentation(note, onReady);
        const slides = await vi.waitFor(() => {
            expect(rendered.slides?.presentation).toBe(model);
            return rendered.slides as PresentationProps;
        });

        const reveal = createReveal([ "first", "below", "second", "added" ]);
        act(() => slides.setApi(reveal.api));
        await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
        return { note, model, reveal, props: () => rendered.slides as PresentationProps, sidebar: () => rendered.sidebar as SlideSidebarProps };
    }

    it("edits a slide from its menu, and finishes when another slide, the overview or full-screen shows", async () => {
        const { reveal, props, sidebar } = await renderDeck();
        const edit = (noteId: string) => act(() => sidebar().slideMenuActions?.onEdit?.(noteId));

        reveal.isOverview = true;
        edit("second");
        expect(reveal.api.toggleOverview).toHaveBeenCalledWith(false);
        expect(reveal.api.slide).toHaveBeenLastCalledWith(2, 0, undefined);
        expect(props().editedNoteId).toBe("second");
        expect(props().isEditorReady).toBe(false);

        // The editor mounts in the host that the slide gives it.
        const host = document.createElement("div");
        act(() => props().onEditorHost(host));
        const editor = await vi.waitFor(() => {
            expect(rendered.editor?.note.noteId).toBe("second");
            return rendered.editor as SlideEditorProps;
        });
        act(() => editor.onReady());
        expect(props().isEditorReady).toBe(true);
        act(() => editor.onClose("<p>typed</p>", new Promise(() => {})));

        // Moving within the edited slide keeps the edit, and another slide ends it.
        act(() => reveal.emit("slidechanged", "second"));
        expect(props().editedNoteId).toBe("second");
        act(() => reveal.emit("slidechanged", "first"));
        expect(props().editedNoteId).toBeUndefined();

        edit("first");
        act(() => reveal.emit("overviewshown"));
        expect(props().editedNoteId).toBeUndefined();
        edit("first");
        act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
        expect(props().editedNoteId).toBeUndefined();
    });

    it("goes to an added or duplicated slide, and starts editing it as its type asks", async () => {
        const { note, props, sidebar } = await renderDeck();
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(async () => {});
        const changes = () => {
            const found = sidebar().slideMenuActions?.changes;
            expect(found).toBeDefined();
            return found as NonNullable<NonNullable<SlideSidebarProps["slideMenuActions"]>["changes"]>;
        };
        const types = getNewSlideTypes().flat();
        const text = types.find(type => type.type === "text");
        const mermaid = types.find(type => type.type === "mermaid");
        if (!text || !mermaid) throw new Error("The text and Mermaid slide types are missing.");

        vi.mocked(createSlide).mockResolvedValueOnce("added").mockResolvedValueOnce("added");
        await act(async () => changes().addSlideAfter("first", text));
        expect(createSlide).toHaveBeenLastCalledWith({ parentNoteId: note.noteId, afterNoteId: "first" }, "text", undefined);
        expect(props().pendingNoteId).toBe("added");
        act(() => props().onPendingSlideShown("added"));
        expect(props().pendingNoteId).toBeUndefined();
        expect(props().editedNoteId).toBe("added");

        await act(async () => changes().addVerticalSlide("first", mermaid));
        expect(createSlide).toHaveBeenLastCalledWith({ parentNoteId: "first", afterNoteId: "below" }, mermaid.type, mermaid.mime);
        act(() => props().onPendingSlideShown("added"));
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "added" });

        vi.mocked(duplicateSlide).mockResolvedValueOnce("added");
        await act(async () => changes().duplicate("second"));
        expect(props().pendingNoteId).toBe("added");
        act(() => props().onPendingSlideShown("added"));
        expect(props().pendingNoteId).toBeUndefined();
        expect(triggerCommand).toHaveBeenCalledOnce();

        // A slide that was not created leaves nothing to go to.
        vi.mocked(createSlide).mockResolvedValueOnce(undefined);
        vi.mocked(duplicateSlide).mockResolvedValueOnce(undefined);
        await act(async () => changes().addSlideAfter("first", text));
        await act(async () => changes().duplicate("second"));
        expect(props().pendingNoteId).toBeUndefined();
    });

    it("finishes editing a deleted slide, or one below it", async () => {
        const { props, sidebar } = await renderDeck();
        const remove = (noteId: string) => act(async () => sidebar().slideMenuActions?.changes?.delete(noteId));
        const edit = (noteId: string) => act(() => sidebar().slideMenuActions?.onEdit?.(noteId));

        vi.mocked(deleteSlide).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
        edit("second");
        await remove("first");
        expect(props().editedNoteId).toBe("second");
        await remove("second");
        expect(props().editedNoteId).toBeUndefined();

        edit("below");
        await remove("first");
        expect(props().editedNoteId).toBeUndefined();

        // A slide that was not deleted keeps its edit.
        vi.mocked(deleteSlide).mockResolvedValueOnce(false);
        edit("second");
        await remove("second");
        expect(props().editedNoteId).toBe("second");
    });

    it("moves a slide at once, and builds the slides again when the server does not follow", async () => {
        const { props, sidebar, model } = await renderDeck();
        const move: SlideMove = { noteId: "second", targetNoteId: "first", position: "before" };
        const order = () => props().presentation.slides.map(slide => slide.noteId);
        expect(sidebar().planSlideMove?.("second", 0, 0)).toBeDefined();

        let confirm: (isMoved: boolean) => void = () => {};
        vi.mocked(moveSlideNote).mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
        const builds = vi.mocked(buildPresentationModel).mock.calls.length;
        act(() => sidebar().onMoveSlide?.(move));
        expect(order()).toStrictEqual([ "second", "first" ]);
        await act(async () => confirm(true));
        expect(buildPresentationModel).toHaveBeenCalledTimes(builds);

        // A rejected move puts back the model that the server holds.
        vi.mocked(moveSlideNote).mockResolvedValueOnce(false);
        await act(async () => sidebar().onMoveSlide?.(move));
        expect(buildPresentationModel).toHaveBeenCalledTimes(builds + 1);
        await vi.waitFor(() => expect(order()).toStrictEqual(model.slides.map(slide => slide.noteId)));

        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(moveSlideNote).mockRejectedValueOnce(new Error("offline"));
        await act(async () => sidebar().onMoveSlide?.(move));
        expect(buildPresentationModel).toHaveBeenCalledTimes(builds + 2);

        // A vertical slide made top-level is built anew, which drops its editor.
        vi.mocked(moveSlideNote).mockResolvedValueOnce(true);
        act(() => sidebar().slideMenuActions?.onEdit?.("below"));
        await act(async () => sidebar().onMoveSlide?.({ noteId: "below", targetNoteId: "second", position: "after" }));
        expect(props().editedNoteId).toBeUndefined();
    });

    it("prints the slides without the stage, asking Reveal.js for its print layout", async () => {
        const location = window.location.href;
        const model: PresentationModel = { slides: [
            { noteId: "first", type: "text", content: { __html: "" }, verticalSlides: undefined }
        ] };
        vi.mocked(buildPresentationModel).mockImplementation(async () => model);
        const note = buildNote({ title: "Deck", type: "book", "#viewType": "presentation" });
        const container = renderPresentation(note, vi.fn(), { media: "print" });

        await vi.waitFor(() => expect(rendered.slides?.presentation).toBe(model));
        expect(new URL(window.location.href).searchParams.has("print-pdf")).toBe(true);
        expect(container.querySelector(".presentation-view, .presentation-container")).toBeNull();
        window.history.replaceState({}, "", location);
    });

    it("goes to a slide picked in the sidebar", async () => {
        const { reveal, sidebar } = await renderDeck();
        act(() => sidebar().onSelectSlide("second"));
        expect(reveal.api.slide).toHaveBeenLastCalledWith(2, 0, undefined);
    });
});

/** A stand-in for Reveal.js over sections of the given notes, at their index as the horizontal position. */
function createReveal(noteIds: string[]) {
    const element = document.createElement("div");
    for (const noteId of noteIds) {
        const section = document.createElement("section");
        section.id = `slide-${noteId}`;
        section.dataset.noteId = noteId;
        element.append(section);
    }
    const listeners = new Map<string, Set<(e: Event) => void>>();
    let currentNoteId = noteIds[0];
    const reveal = {
        isOverview: false,
        api: {
            on: (name: string, listener: (e: Event) => void) => {
                listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
            },
            off: (name: string, listener: (e: Event) => void) => listeners.get(name)?.delete(listener),
            isOverview: () => reveal.isOverview,
            toggleOverview: vi.fn((isShown?: boolean) => { reveal.isOverview = isShown ?? !reveal.isOverview; }),
            getRevealElement: () => element,
            getCurrentSlide: () => element.querySelector(`#slide-${currentNoteId}`),
            getIndices: (slide?: HTMLElement) => ({ h: slide ? noteIds.indexOf(slide.dataset.noteId ?? "") : 0, v: 0 }),
            getScale: () => 1,
            slide: vi.fn()
        } as unknown as RevealApi & { toggleOverview: Mock; slide: Mock },
        emit(name: string, noteId?: string) {
            if (noteId) currentNoteId = noteId;
            const event = Object.assign(new Event(name), { currentSlide: element.querySelector(`#slide-${currentNoteId}`) });
            for (const listener of listeners.get(name) ?? []) listener(event);
        }
    };
    return reveal;
}

function renderPresentation(
    note: FNote, onReady: () => void,
    { parent = new Component(), noteIds = [], media = "screen" }: {
        parent?: Component; noteIds?: string[]; media?: ViewModeMedia
    } = {}
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
                    media={media}
                    onReady={onReady}
                />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}
