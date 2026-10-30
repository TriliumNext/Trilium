// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { h } from "preact";
import { beforeAll, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { buildPresentationModel, PresentationModel } from "./model";

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
