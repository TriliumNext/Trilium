import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import { buildNoteHint } from "./note_hint.js";

describe("buildNoteHint", () => {
    beforeEach(() => becca.reset());

    it("sends other notes to the tools before it offers the preview of the open note", () => {
        buildNote({ id: "open1", title: "Pangram (English)", content: "The quick brown fox" });

        const hint = buildNoteHint("open1", false) ?? "";
        expect(hint).toContain("noteId: open1");
        const toTools = hint.indexOf("read it with the note tools");
        expect(toTools).toBeGreaterThan(-1);
        expect(toTools).toBeLessThan(hint.indexOf("contentPreview"));
        expect(hint).not.toContain("without calling tools");
        expect(buildNoteHint("missing", false)).toBeNull();
    });
});
