import { describe, expect, it } from "vitest";

import { buildMessageDictionary, MESSAGE_KEY_PREFIX, MESSAGE_OVERRIDES, slugify, translateMessage } from "./messages.js";

describe("slugify", () => {
    // The punctuation cases matter: `.` separates key paths in i18next, and `"`/`%0` would be
    // awkward in a catalog, so a message id must survive being written as natural English.
    it.each([
        [ "Admonition", "admonition" ],
        [ "Insert a table.", "insert-a-table" ],
        [ "Show all emoji...", "show-all-emoji" ],
        [ "No templates were found matching \"%0\".", "no-templates-were-found-matching-0" ],
        [ "Copy formatting", "copy-formatting" ]
    ])("derives the key for %j", (message, expected) => {
        expect(slugify(message)).toBe(expected);
    });
});

describe("buildMessageDictionary", () => {
    const ENGLISH = { admonition: "Admonition", warning: "Warning" };

    it("maps each English message to its translation", () => {
        const dictionary = buildMessageDictionary(ENGLISH, (key) => `translated:${key}`);

        expect(dictionary.Admonition).toBe(`translated:${MESSAGE_KEY_PREFIX}admonition`);
        expect(dictionary.Warning).toBe(`translated:${MESSAGE_KEY_PREFIX}warning`);
    });

    // Trilium calls CKEditor's bookmarks "anchors". The dictionary has to be keyed by the upstream
    // message id for CKEditor to find it, while the text comes from our entry for the replacement —
    // which is what makes the rename translatable rather than English-only.
    it("renames CKEditor's own strings, in the locale's own words", () => {
        const dictionary = buildMessageDictionary(
            { anchor: "Anchor" },
            (key) => (key === `${MESSAGE_KEY_PREFIX}anchor` ? "Ancoră" : key)
        );

        expect(dictionary.Bookmark).toBe("Ancoră");
    });

    // A rename is not a translation: the English replacement is itself the point, so it has to
    // stand in even where the locale has nothing — otherwise the editor says "Bookmark" again.
    it("applies a rename even when nothing resolves", () => {
        const dictionary = buildMessageDictionary({}, (key) => key);

        expect(dictionary.Bookmark).toBe("Anchor");
        expect(dictionary["Edit bookmark"]).toBe("Edit anchor");
    });

    // i18next echoes the key back when an entry is missing. Putting that in the dictionary would
    // render `text-editor.ck.admonition` at the user; leaving the message out lets CKEditor fall
    // back to the message id, which is the English text. Only the renames remain.
    it("omits messages whose key the translator does not resolve", () => {
        for (const translate of [ (key: string) => key, () => "" ]) {
            const dictionary = buildMessageDictionary(ENGLISH, translate);

            expect(dictionary).not.toHaveProperty("Admonition");
            expect(dictionary).not.toHaveProperty("Warning");
            expect(Object.keys(dictionary)).toEqual(Object.keys(MESSAGE_OVERRIDES));
        }
    });
});

describe("translateMessage", () => {
    it("resolves a message id through the host translator", () => {
        expect(translateMessage((key) => `translated:${key}`, "Warning"))
            .toBe(`translated:${MESSAGE_KEY_PREFIX}warning`);
    });

    // The counterpart of `editor.t()`'s fallback, for the code that has no editor: an unresolved
    // key must render the English message id, never `text-editor.ck.…`.
    it("falls back to the English message id", () => {
        expect(translateMessage((key) => key, "Warning")).toBe("Warning");
        expect(translateMessage(() => "", "Warning")).toBe("Warning");
    });

    // `%0`-style placeholders are what CKEditor's own translation function substitutes, so a message
    // reads the same either way — including when it falls back to English.
    it("substitutes %0-style placeholders, in the translation and in the fallback alike", () => {
        expect(translateMessage(() => "Șablon „%0” (%1)", "Template \"%0\" (%1)", [ "Flowchart", "2" ]))
            .toBe("Șablon „Flowchart” (2)");
        expect(translateMessage((key) => key, "Insert %0", [ "Flowchart" ])).toBe("Insert Flowchart");
    });

    // A placeholder with no value is left alone rather than blanked, so a mismatched translation
    // shows the gap instead of silently dropping text.
    it("leaves a placeholder with no corresponding value untouched", () => {
        expect(translateMessage((key) => key, "Insert %0 into %1", [ "Flowchart" ]))
            .toBe("Insert Flowchart into %1");
    });
});
