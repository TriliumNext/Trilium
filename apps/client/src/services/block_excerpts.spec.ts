import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import {
    getBlockExcerpt, getBlockReferenceLabel, getCachedBlockReferenceLabel, loadBlockReferenceLabel
} from "./block_excerpts.js";

vi.mock("./i18n.js", () => ({ t: (key: string) => key }));

const CONTENT = "<p data-trilium-block-id=\"a\">First   block\n text</p>"
    + "<ul><li><p data-trilium-block-id=\"b\">Second</p></li></ul>"
    + "<figure class=\"image\" data-trilium-block-id=\"img\"><img src=\"x.png\"></figure>";
const FIRST_LABEL = { text: "First block text", isBroken: false, isHeading: false };

describe("loadBlockReferenceLabel", () => {
    it("labels blocks by their text, and a missing block as broken", async () => {
        const note = buildNote({ title: "Source", content: CONTENT });

        expect(await loadBlockReferenceLabel(note, "a")).toEqual(FIRST_LABEL);
        expect(await loadBlockReferenceLabel(note, "a:b")).toEqual({
            text: "First block text … Second",
            isBroken: false,
            isHeading: false
        });
        expect(await loadBlockReferenceLabel(note, "img")).toEqual({
            text: "block_reference.untitled",
            isBroken: false,
            isHeading: false
        });
        expect(await loadBlockReferenceLabel(note, "a:gone")).toEqual({
            text: "block_reference.broken",
            isBroken: true,
            isHeading: false
        });
    });

    it("reads the content of a note once for each version of it", async () => {
        const note = buildNote({ title: "Source", content: CONTENT });
        const getBlob = vi.spyOn(note, "getBlob");

        expect(getCachedBlockReferenceLabel(note, "a")).toBeNull();
        await Promise.all([
            loadBlockReferenceLabel(note, "a"),
            loadBlockReferenceLabel(note, "b")
        ]);
        expect(getCachedBlockReferenceLabel(note, "a")).toEqual(FIRST_LABEL);
        expect(getBlob).toHaveBeenCalledTimes(1);

        note.blobId = "changed";
        expect(getCachedBlockReferenceLabel(note, "a")).toBeNull();
        await loadBlockReferenceLabel(note, "a");
        expect(getBlob).toHaveBeenCalledTimes(2);
    });

    it("reads nothing of a note that is not text or whose content is protected", async () => {
        const code = buildNote({ title: "Code", type: "code", content: CONTENT });
        const locked = buildNote({ title: "Locked", content: CONTENT });
        vi.spyOn(locked, "isContentAvailable").mockReturnValue(false);

        expect(await loadBlockReferenceLabel(code, "a")).toBeNull();
        expect(await loadBlockReferenceLabel(locked, "a")).toBeNull();
    });

    it("tries again after the content failed to load", async () => {
        const note = buildNote({ title: "Source", content: CONTENT });
        const getBlob = vi.spyOn(note, "getBlob").mockRejectedValueOnce(new Error("offline"));

        expect(await loadBlockReferenceLabel(note, "a")).toBeNull();
        expect(await loadBlockReferenceLabel(note, "a")).toEqual(FIRST_LABEL);
        expect(getBlob).toHaveBeenCalledTimes(2);
    });

    it("keeps the content of the 20 notes read last", async () => {
        const notes = Array.from({ length: 21 }, () =>
            buildNote({ title: "Source", content: CONTENT }));
        for (const note of notes) {
            await loadBlockReferenceLabel(note, "a");
        }

        expect(getCachedBlockReferenceLabel(notes[0], "a")).toBeNull();
        expect(getCachedBlockReferenceLabel(notes[20], "a")).not.toBeNull();
    });
});

describe("getBlockReferenceLabel", () => {
    it("labels the blocks of a content as it is, and a heading by all of its text", () => {
        const root = document.createElement("div");
        const long = "A heading " + "word ".repeat(20).trimEnd();
        root.innerHTML = `<h2 data-trilium-block-id="h">${long}</h2>`
            + "<p data-trilium-block-id=\"p\">Text</p><h3 data-trilium-block-id=\"empty\"></h3>";

        expect(getBlockReferenceLabel(root, "h")).toEqual({
            text: long, isBroken: false, isHeading: true
        });
        expect(getBlockReferenceLabel(root, "empty")).toEqual({
            text: "block_reference.untitled", isBroken: false, isHeading: true
        });
        // A range reads in document order, however its ends are written.
        const range = getBlockReferenceLabel(root, "p:h");
        expect(range).toEqual(getBlockReferenceLabel(root, "h:p"));
        expect(range).toMatchObject({ isBroken: false, isHeading: false });
        expect(range.text.endsWith("… … Text")).toBe(true);
        for (const block of [ "gone", "h:gone", "" ]) {
            expect(getBlockReferenceLabel(root, block)).toEqual({
                text: "block_reference.broken", isBroken: true, isHeading: false
            });
        }

        root.querySelector("h2")?.append(" renamed");
        expect(getBlockReferenceLabel(root, "h").text).toBe(`${long} renamed`);
    });

    it("leaves out the labels of block references, which can repeat the text itself", () => {
        const root = document.createElement("div");
        root.innerHTML = "<h2 data-trilium-block-id=\"a\">See "
            + "<a class=\"reference-link\" href=\"#root/n?block=a\">See Other</a> and "
            + "<a class=\"reference-link\" href=\"#root/n?block=b\">Other</a> in "
            + "<a class=\"reference-link\" href=\"#root/m\">Note</a></h2>"
            + "<h2 data-trilium-block-id=\"b\">Other "
            + "<a class=\"reference-link\" href=\"#root/n?block=a\">See and in Note</a></h2>";

        expect(getBlockReferenceLabel(root, "a").text).toBe("See and in Note");
        expect(getBlockReferenceLabel(root, "b").text).toBe("Other");
        expect(root.querySelectorAll("a")).toHaveLength(4);
    });
});

describe("getBlockExcerpt", () => {
    it("shortens a long text, sharing the length between the two ends of a range", () => {
        const long = document.createElement("p");
        long.textContent = "word ".repeat(30);
        const short = document.createElement("p");
        short.textContent = "end";

        const single = getBlockExcerpt(long, long);
        const range = getBlockExcerpt(long, short);

        expect(single).toHaveLength(60);
        expect(single.endsWith("word…")).toBe(true);
        expect(range).toBe(`${"word ".repeat(6).trimEnd()}… … end`);
    });

    it("names a tab by its title", () => {
        const container = document.createElement("div");
        container.innerHTML = "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">Linux</p>"
            + "<div class=\"trilium-tab-panel\"><p>Use the package.</p></div></section>";
        const tab = container.querySelector(".trilium-tab");
        expect(tab).not.toBeNull();

        expect(getBlockExcerpt(tab as Element, tab as Element)).toBe("Linux");
    });
});
