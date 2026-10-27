import { afterEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../components/note_context";
import type FNote from "../entities/fnote";
import { buildNote } from "../test/easy-froca";
import NoteWrapperWidget, {
    hasBackgroundEffects, isAlwaysFullWidthByType, isFullWidthNote, markVisibleSplits
} from "./note_wrapper";

describe("NoteWrapperWidget", () => {
    it("preserves the classes owned by SplitNoteContainer in refresh()", () => {
        const widget = new NoteWrapperWidget();
        widget.render();
        widget.$widget.addClass("active last-visible");
        widget.toggleExt(false);

        widget.refresh();

        expect(widget.$widget.hasClass("active")).toBe(true);
        expect(widget.$widget.hasClass("last-visible")).toBe(true);
        expect(widget.$widget.hasClass("hidden-ext")).toBe(true);
        // Without a note context, the split renders as empty — the note-derived classes still apply.
        expect(widget.$widget.hasClass("note-split")).toBe(true);
        expect(widget.$widget.hasClass("empty-note")).toBe(true);
    });

    it("changes no class when a refresh produces the same classes", () => {
        const widget = new NoteWrapperWidget();
        widget.render();
        showNote(widget, buildNote({ title: "Styled", type: "text", "#cssClass": "first second" }));
        widget.$widget.addClass("active");

        const observer = new MutationObserver(() => {});
        observer.observe(widget.$widget[0], { attributes: true, attributeFilter: [ "class" ] });
        widget.refresh();
        const records = observer.takeRecords();
        observer.disconnect();

        expect(records).toHaveLength(0);
        for (const cls of [ "active", "visible", "note-split", "type-text", "first", "second" ]) {
            expect(widget.$widget.hasClass(cls)).toBe(true);
        }
    });

    it("drops the classes of the previous note and keeps those of SplitNoteContainer", () => {
        const widget = new NoteWrapperWidget();
        widget.render();
        showNote(widget, buildNote({ title: "Styled", type: "text", "#cssClass": "first second" }));
        widget.$widget.addClass("active last-visible");

        showNote(widget, buildNote({ title: "Plain", type: "code" }));

        expect(widget.$widget.hasClass("first")).toBe(false);
        expect(widget.$widget.hasClass("type-text")).toBe(false);
        expect(widget.$widget.hasClass("type-code")).toBe(true);
        expect(widget.$widget.hasClass("active")).toBe(true);
        expect(widget.$widget.hasClass("last-visible")).toBe(true);
    });

    it("adds the classes of a note split at any whitespace", () => {
        // A browser refuses a class with whitespace in `classList.add()`; happy-dom accepts it.
        const add = vi.spyOn(Object.getPrototypeOf(document.body.classList) as DOMTokenList, "add");
        const widget = new NoteWrapperWidget();
        widget.render();
        showNote(widget, buildNote({ title: "Styled", type: "text", "#cssClass": "a\tb\nc\r\nd" }));
        const added = add.mock.calls.flat();
        add.mockRestore();

        expect(added).toEqual(expect.arrayContaining([ "a", "b", "c", "d", "type-text" ]));
        expect(added.filter((cls) => /\s/.test(cls))).toEqual([]);
    });

    it("marks the split as translucent (bgfx) for the note types that render on a bare background", () => {
        expect(hasBackgroundEffects(buildNote({ title: "Photo", type: "image" }))).toBe(true);

        const pdf = buildNote({ title: "PDF", type: "file" });
        pdf.mime = "application/pdf";
        expect(hasBackgroundEffects(pdf)).toBe(true);

        const audio = buildNote({ title: "Audio", type: "file" });
        audio.mime = "audio/mpeg";
        expect(hasBackgroundEffects(audio)).toBe(true);

        expect(hasBackgroundEffects(buildNote({ title: "Grid", type: "book", "#viewType": "grid" }))).toBe(true);
        // The board lays its columns on a bare surface, the way the grid lays its cards.
        expect(hasBackgroundEffects(
            buildNote({ title: "Board", type: "book", "#viewType": "board" }))).toBe(true);

        // Notes whose content paints its own background stay opaque.
        expect(hasBackgroundEffects(buildNote({ title: "Plain", type: "text" }))).toBe(false);
        expect(hasBackgroundEffects(buildNote({ title: "Calendar", type: "book", "#viewType": "calendar" }))).toBe(false);

        const doc = buildNote({ title: "Doc", type: "file" });
        doc.mime = "application/msword";
        expect(hasBackgroundEffects(doc)).toBe(false);
    });

    it("updates the body classes of the outer splits when its note changes translucency", () => {
        const container = document.createElement("div");
        const widget = new NoteWrapperWidget();
        widget.render();
        container.append(widget.$widget[0]);

        showNote(widget, buildNote({ title: "Photo", type: "image" }));
        expect(document.body.classList.contains("first-split-bgfx")).toBe(true);
        expect(document.body.classList.contains("last-split-bgfx")).toBe(true);

        showNote(widget, buildNote({ title: "Plain", type: "text" }));
        expect(document.body.classList.contains("first-split-bgfx")).toBe(false);
        expect(document.body.classList.contains("last-split-bgfx")).toBe(false);
    });
});

describe("markVisibleSplits", () => {
    afterEach(() => {
        document.body.classList.remove("first-split-bgfx", "last-split-bgfx");
    });

    function buildContainer(...splitClasses: string[]) {
        const container = document.createElement("div");
        for (const classes of splitClasses) {
            const split = document.createElement("div");
            split.className = `note-split ${classes}`;
            container.append(split);
        }
        return container;
    }

    it("marks the last visible split, multiple splits and the translucent outer splits", () => {
        const container = buildContainer("bgfx", "", "bgfx hidden-ext last-visible");
        const [ first, second, hidden ] = container.children;

        markVisibleSplits(container);
        expect(first.classList.contains("last-visible")).toBe(false);
        expect(second.classList.contains("last-visible")).toBe(true);
        expect(hidden.classList.contains("last-visible")).toBe(false);
        expect(container.classList.contains("multiple-splits")).toBe(true);
        expect(document.body.classList.contains("first-split-bgfx")).toBe(true);
        expect(document.body.classList.contains("last-split-bgfx")).toBe(false);

        second.classList.add("hidden-ext");
        markVisibleSplits(container);
        expect(first.classList.contains("last-visible")).toBe(true);
        expect(container.classList.contains("multiple-splits")).toBe(false);
        expect(document.body.classList.contains("last-split-bgfx")).toBe(true);
    });
});

describe("isAlwaysFullWidthByType", () => {
    it("is false for a regular text note regardless of the fullContentWidth label", () => {
        expect(isAlwaysFullWidthByType(buildNote({ title: "Plain", type: "text" }))).toBe(false);
        expect(isAlwaysFullWidthByType(buildNote({ title: "Wide", type: "text", "#fullContentWidth": "" }))).toBe(false);
    });

    it("is true for layout-heavy types, media/PDF files and non-list/grid searches", () => {
        expect(isAlwaysFullWidthByType(buildNote({ title: "Canvas", type: "canvas" }))).toBe(true);
        expect(isAlwaysFullWidthByType(buildNote({ title: "Relations", type: "relationMap" }))).toBe(true);

        const pdf = buildNote({ title: "PDF", type: "file" });
        pdf.mime = "application/pdf";
        expect(isAlwaysFullWidthByType(pdf)).toBe(true);

        expect(isAlwaysFullWidthByType(buildNote({ title: "Calendar", type: "search", "#viewType": "calendar" }))).toBe(true);
        expect(isAlwaysFullWidthByType(buildNote({ title: "List", type: "search", "#viewType": "list" }))).toBe(false);
    });

    it("is true for icon packs, including the file-type variant that isn't media/PDF", () => {
        const filePack = buildNote({ title: "File pack", type: "file", "#iconPack": "fp" });
        filePack.mime = "application/json";
        expect(isAlwaysFullWidthByType(filePack)).toBe(true);

        // A plain JSON file (no #iconPack) stays constrained.
        const plainJson = buildNote({ title: "Config", type: "file" });
        plainJson.mime = "application/json";
        expect(isAlwaysFullWidthByType(plainJson)).toBe(false);
    });
});

describe("isFullWidthNote", () => {
    it("opts a regular text note into full width via the fullContentWidth label", () => {
        expect(isFullWidthNote(buildNote({ title: "Plain", type: "text" }))).toBe(false);
        expect(isFullWidthNote(buildNote({ title: "Wide", type: "text", "#fullContentWidth": "" }))).toBe(true);
        // An explicit "false" value disables it again.
        expect(isFullWidthNote(buildNote({ title: "Narrow", type: "text", "#fullContentWidth": "false" }))).toBe(false);
    });

    it("treats layout-heavy note types as full width regardless of the label", () => {
        for (const type of ["code", "image", "mermaid", "book", "render", "canvas", "webView", "noteMap", "mindMap", "spreadsheet"] as const) {
            expect(isFullWidthNote(buildNote({ title: type, type }))).toBe(true);
        }
    });

    it("treats media and PDF files as full width but leaves other files constrained", () => {
        const pdf = buildNote({ title: "PDF", type: "file" });
        pdf.mime = "application/pdf";
        expect(isFullWidthNote(pdf)).toBe(true);

        const video = buildNote({ title: "Video", type: "file" });
        video.mime = "video/mp4";
        expect(isFullWidthNote(video)).toBe(true);

        const audio = buildNote({ title: "Audio", type: "file" });
        audio.mime = "audio/mpeg";
        expect(isFullWidthNote(audio)).toBe(true);

        const doc = buildNote({ title: "Doc", type: "file" });
        doc.mime = "application/msword";
        expect(isFullWidthNote(doc)).toBe(false);
    });

    it("only constrains list/grid search views", () => {
        expect(isFullWidthNote(buildNote({ title: "List", type: "search", "#viewType": "list" }))).toBe(false);
        expect(isFullWidthNote(buildNote({ title: "Grid", type: "search", "#viewType": "grid" }))).toBe(false);
        // Default (no viewType) behaves like a list and stays constrained.
        expect(isFullWidthNote(buildNote({ title: "Default", type: "search" }))).toBe(false);
        // Any other view (e.g. calendar) goes full width.
        expect(isFullWidthNote(buildNote({ title: "Calendar", type: "search", "#viewType": "calendar" }))).toBe(true);
    });
});

function showNote(widget: NoteWrapperWidget, note: FNote) {
    const noteContext = { note, viewScope: { viewMode: "default" } } as unknown as NoteContext;
    widget.setNoteContextEvent({ noteContext });
}
