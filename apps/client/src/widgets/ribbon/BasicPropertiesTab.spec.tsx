import type { MimeType } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

// i18next is not initialized in the test env; echo the key so titles are what the spec reads.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key,
    getAvailableLocales: () => [],
    getLocaleById: () => undefined
}));

import { codeLanguageItems } from "./BasicPropertiesTab";

describe("codeLanguageItems", () => {
    const mimeTypes = [
        { title: "Plain text", mime: "text/plain", icon: "bx bx-file" },
        { title: "C++ <templates>", mime: "text/x-c++src" }
    ] as MimeType[];

    it("lists the languages, ticks the note's own, and ends with the options when asked", () => {
        const changeNoteType = vi.fn();
        const onConfigure = vi.fn();
        const items = codeLanguageItems({ currentMimeType: "text/x-c++src", mimeTypes, changeNoteType, onConfigure });

        // Titles are HTML in a menu, so a language's name is escaped.
        expect(items.map((item) => ("kind" in item ? item.kind : item.title))).toEqual([
            "Plain text", "C++ &lt;templates&gt;", "separator", "basic_properties.configure_code_notes"
        ]);
        expect(items.map((item) => "checked" in item && item.checked)).toEqual([ false, true, false, false ]);
        // A language's own icon, or the code note type's when it has none, as the note tree shows it.
        expect(items.slice(0, 2).map((item) => "uiIcon" in item && item.uiIcon)).toEqual([ "bx bx-file", "bx bx-code" ]);

        const [ plain, , , configure ] = items;
        if ("kind" in plain || "kind" in configure) throw new Error("expected rows");
        plain.handler?.(plain, new MouseEvent("click"));
        expect(changeNoteType).toHaveBeenCalledWith("code", "text/plain");
        configure.handler?.(configure, new MouseEvent("click"));
        expect(onConfigure).toHaveBeenCalledTimes(1);
        expect(configure.uiIcon).toBe("bx bx-cog");

        // Without a way to open the options, there is no row for them.
        expect(codeLanguageItems({ mimeTypes, changeNoteType })).toHaveLength(2);
    });
});
