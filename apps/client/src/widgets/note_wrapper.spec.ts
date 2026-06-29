import { describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca";
import { isAlwaysFullWidthByType, isFullWidthNote } from "./note_wrapper";

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
