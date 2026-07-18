import { describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca";
import NoteWrapperWidget, { hasBackgroundEffects, isAlwaysFullWidthByType, isFullWidthNote } from "./note_wrapper";

describe("NoteWrapperWidget", () => {
    it("preserves the classes owned by SplitNoteContainer through the class reset in refresh()", () => {
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

    it("marks the split as translucent (bgfx) for the note types that render on a bare background", () => {
        expect(hasBackgroundEffects(buildNote({ title: "Photo", type: "image" }))).toBe(true);

        const pdf = buildNote({ title: "PDF", type: "file" });
        pdf.mime = "application/pdf";
        expect(hasBackgroundEffects(pdf)).toBe(true);

        const audio = buildNote({ title: "Audio", type: "file" });
        audio.mime = "audio/mpeg";
        expect(hasBackgroundEffects(audio)).toBe(true);

        expect(hasBackgroundEffects(buildNote({ title: "Grid", type: "book", "#viewType": "grid" }))).toBe(true);

        // Notes whose content paints its own background stay opaque.
        expect(hasBackgroundEffects(buildNote({ title: "Plain", type: "text" }))).toBe(false);
        expect(hasBackgroundEffects(buildNote({ title: "Calendar", type: "book", "#viewType": "calendar" }))).toBe(false);

        const doc = buildNote({ title: "Doc", type: "file" });
        doc.mime = "application/msword";
        expect(hasBackgroundEffects(doc)).toBe(false);
    });
});

describe("isAlwaysFullWidthByType", () => {
    it("is false for a regular text note regardless of the fullContentWidth label", () => {
        expect(isAlwaysFullWidthByType(buildNote({ title: "Plain", type: "text" }))).toBe(false);
        expect(isAlwaysFullWidthByType(buildNote({ title: "Wide", type: "text", "#fullContentWidth": "" }))).toBe(false);
    });

    it("is true for layout-heavy types, media/PDF files and non-list/grid searches", () => {
        expect(isAlwaysFullWidthByType(buildNote({ title: "Canvas", type: "canvas" }))).toBe(true);

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
