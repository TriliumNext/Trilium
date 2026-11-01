import { env } from "ckeditor5";
import { afterEach, describe, expect, it } from "vitest";

import { createMarkerPattern, findMarkerMatch } from "./marker_pattern.js";

/** Convenience: the query the pattern extracts, or `null` when it does not match. */
function query(pattern: RegExp, text: string) {
    return pattern.exec(text)?.[2] ?? null;
}

describe("createMarkerPattern", () => {
    const unicodePropertiesSupported = env.features.isRegExpUnicodePropertySupported;

    afterEach(() => {
        env.features.isRegExpUnicodePropertySupported = unicodePropertiesSupported;
    });

    it("matches a marker at the start of the block, after a space and after opening punctuation", () => {
        const pattern = createMarkerPattern("#");

        expect(query(pattern, "#foo")).toBe("foo");
        expect(query(pattern, "bar #foo")).toBe("foo");
        expect(query(pattern, "(#foo")).toBe("foo");
        expect(query(pattern, "\"#foo")).toBe("foo");
        // The bare marker is enough when `minimumCharacters` is 0.
        expect(query(pattern, "#")).toBe("");
    });

    it("does not match a marker glued to preceding word characters", () => {
        const pattern = createMarkerPattern("#");

        expect(query(pattern, "foo#bar")).toBeNull();
        expect(query(pattern, "a#")).toBeNull();
    });

    it("opens after '=' so a marker can follow an attribute assignment", () => {
        expect(query(createMarkerPattern("~"), "#foo=~bar")).toBe("bar");
    });

    it("stops matching once the query would contain '=' — past an assignment we are in a value", () => {
        expect(query(createMarkerPattern("#"), "#foo=bar")).toBeNull();
        expect(query(createMarkerPattern("@", { allowSpaces: true }), "@foo=bar")).toBeNull();
    });

    it("stops matching at a space unless the feed allows spaces", () => {
        expect(query(createMarkerPattern("#"), "#foo bar")).toBeNull();
        expect(query(createMarkerPattern("@", { allowSpaces: true }), "@My meeting notes")).toBe("My meeting notes");
    });

    it("honours minimumCharacters", () => {
        const pattern = createMarkerPattern("@", { minimumCharacters: 2 });

        expect(query(pattern, "@")).toBeNull();
        expect(query(pattern, "@a")).toBeNull();
        expect(query(pattern, "@ab")).toBe("ab");
    });

    it("escapes characters that are special inside a character class", () => {
        for (const marker of [ "]", "\\", "^", "-", "@", "#", "~", "$", "." ]) {
            const pattern = createMarkerPattern(marker);

            expect(query(pattern, `${marker}foo`)).toBe("foo");
        }
    });

    it("falls back to an ASCII opening set where Unicode property escapes are unsupported", () => {
        env.features.isRegExpUnicodePropertySupported = true;
        // U+201C is `\p{Pi}`, so it only opens a marker while the property escapes are available.
        expect(query(createMarkerPattern("#"), "“#foo")).toBe("foo");

        env.features.isRegExpUnicodePropertySupported = false;
        const pattern = createMarkerPattern("#");

        expect(query(pattern, "“#foo")).toBeNull();

        // Everything the ASCII set does spell out keeps working.
        expect(query(pattern, "#foo")).toBe("foo");
        expect(query(pattern, "bar #foo")).toBe("foo");
        expect(query(pattern, "(#foo")).toBe("foo");
        expect(query(pattern, "[#foo")).toBe("foo");
        expect(query(pattern, "{#foo")).toBe("foo");
        expect(query(pattern, "\"#foo")).toBe("foo");
        expect(query(createMarkerPattern("~"), "#foo=~bar")).toBe("bar");
        expect(query(pattern, "foo#bar")).toBeNull();
    });

    it("no longer needs a sentinel character to stop matching", () => {
        // The removed pnpm patch excluded U+2002 from the query so an inserted en-space could break
        // the match. Nothing is special about it any more — it is just an ordinary space.
        expect(query(createMarkerPattern("#"), "#foo ")).toBeNull();
    });
});

describe("findMarkerMatch", () => {
    const feeds = [
        { marker: "#", pattern: createMarkerPattern("#") },
        { marker: "~", pattern: createMarkerPattern("~") },
        { marker: "@", pattern: createMarkerPattern("@", { allowSpaces: true }) }
    ];

    it("returns the feed whose marker is closest to the caret", () => {
        expect(findMarkerMatch(feeds, "#foo ~bar")).toMatchObject({ query: "bar", feed: { marker: "~" } });
        expect(findMarkerMatch(feeds, "~foo #bar")).toMatchObject({ query: "bar", feed: { marker: "#" } });
    });

    it("prefers the nearest marker even when an earlier space-allowing feed also matches", () => {
        // `@` allows spaces, so `@foo #bar` matches for both feeds; `#` is nearer the caret.
        expect(findMarkerMatch(feeds, "@foo #bar")).toMatchObject({ query: "bar", feed: { marker: "#" } });
    });

    it("returns null when no feed matches", () => {
        expect(findMarkerMatch(feeds, "plain text")).toBeNull();
        expect(findMarkerMatch(feeds, "foo#bar")).toBeNull();
        // The marker is present but the query broke the pattern.
        expect(findMarkerMatch(feeds, "#foo bar")).toBeNull();
    });

    it("matches a marker sitting at offset 0", () => {
        expect(findMarkerMatch(feeds, "#foo")).toMatchObject({ query: "foo", feed: { marker: "#" } });
    });
});
