import { describe, expect, it } from "vitest";

import { buildNote } from "../../../test/easy-froca";
import { isSplitEditorForcedReadOnly, resolveDisplayMode } from "./split_editor_mode";

describe("resolveDisplayMode", () => {
    it("uses the #displayMode label when it names a valid mode, regardless of read-only", () => {
        expect(resolveDisplayMode("source", false)).toBe("source");
        expect(resolveDisplayMode("split", true)).toBe("split");
        expect(resolveDisplayMode("preview", false)).toBe("preview");
    });

    it("falls back to preview when read-only and split otherwise if the label is absent or invalid", () => {
        expect(resolveDisplayMode(undefined, true)).toBe("preview");
        expect(resolveDisplayMode(undefined, false)).toBe("split");
        expect(resolveDisplayMode(null, true)).toBe("preview");
        expect(resolveDisplayMode("", false)).toBe("split");
        expect(resolveDisplayMode("bogus", true)).toBe("preview");
    });
});

describe("isSplitEditorForcedReadOnly", () => {
    it("is true only for file-type icon packs (which can't be edited as text)", () => {
        const filePack = buildNote({ title: "fp", type: "file", "#iconPack": "fp" });
        filePack.mime = "application/json";
        expect(isSplitEditorForcedReadOnly(filePack)).toBe(true);

        const codePack = buildNote({ title: "cp", type: "code", "#iconPack": "cp" });
        codePack.mime = "application/json";
        expect(isSplitEditorForcedReadOnly(codePack)).toBe(false);

        expect(isSplitEditorForcedReadOnly(buildNote({ title: "plain", type: "file" }))).toBe(false);
    });
});
