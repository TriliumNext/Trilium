import { describe, expect, it } from "vitest";

import { codeToSiblingDirection, getParentFromNotePath, getSiblingNavigation, isInteractiveTarget, isTextEntryTarget, sameRoleAttachments } from "./sibling_navigation";

describe("getParentFromNotePath", () => {
    it("splits the in-tab path into parent path + parent note id", () => {
        expect(getParentFromNotePath("root/abc/def/xyz")).toEqual({ parentPath: "root/abc/def", parentNoteId: "def" });
        expect(getParentFromNotePath("root/xyz")).toEqual({ parentPath: "root", parentNoteId: "root" });
    });

    it("returns null for a rootless or empty path", () => {
        expect(getParentFromNotePath("xyz")).toBeNull();
        expect(getParentFromNotePath("")).toBeNull();
        expect(getParentFromNotePath(null)).toBeNull();
        expect(getParentFromNotePath(undefined)).toBeNull();
    });
});

describe("getSiblingNavigation", () => {
    it("returns the adjacent and edge siblings with a 1-based index and total", () => {
        expect(getSiblingNavigation([ "a", "b", "c" ], "b")).toEqual({ previous: "a", next: "c", first: "a", last: "c", index: 2, total: 3 });
    });

    it("wraps prev/next around infinitely while first/last stay absolute", () => {
        expect(getSiblingNavigation([ "a", "b", "c" ], "a")).toEqual({ previous: "c", next: "b", first: "a", last: "c", index: 1, total: 3 });
        expect(getSiblingNavigation([ "a", "b", "c" ], "c")).toEqual({ previous: "b", next: "a", first: "a", last: "c", index: 3, total: 3 });
    });

    it("wraps to the other sibling with exactly two", () => {
        expect(getSiblingNavigation([ "a", "b" ], "a")).toEqual({ previous: "b", next: "b", first: "a", last: "b", index: 1, total: 2 });
    });

    it("returns null with fewer than two siblings or when the note is absent", () => {
        expect(getSiblingNavigation([ "a" ], "a")).toBeNull();
        expect(getSiblingNavigation([], "a")).toBeNull();
        expect(getSiblingNavigation([ "a", "b" ], "x")).toBeNull();
    });
});

describe("codeToSiblingDirection", () => {
    it("maps PageUp/PageDown (prev/next) and Home/End (first/last) by default", () => {
        expect(codeToSiblingDirection("PageUp", [], [])).toBe("previous");
        expect(codeToSiblingDirection("PageDown", [], [])).toBe("next");
        expect(codeToSiblingDirection("Home", [], [])).toBe("first");
        expect(codeToSiblingDirection("End", [], [])).toBe("last");
    });

    it("ignores the Previous/Next Track media keys (OS media-key integration is video/audio-only)", () => {
        expect(codeToSiblingDirection("MediaTrackPrevious", [], [])).toBeNull();
        expect(codeToSiblingDirection("MediaTrackNext", [], [])).toBeNull();
    });

    it("honors caller-provided extra keys (e.g. the image viewer's Backspace/Space)", () => {
        expect(codeToSiblingDirection("Backspace", [ "Backspace" ], [ "Space" ])).toBe("previous");
        expect(codeToSiblingDirection("Space", [ "Backspace" ], [ "Space" ])).toBe("next");
    });

    it("returns null for unrelated keys", () => {
        expect(codeToSiblingDirection("Space", [], [])).toBeNull();
        expect(codeToSiblingDirection("KeyA", [ "Backspace" ], [ "Space" ])).toBeNull();
    });

    it("omits Home/End when edge keys are disabled, keeping PageUp/PageDown", () => {
        expect(codeToSiblingDirection("Home", [], [], false)).toBeNull();
        expect(codeToSiblingDirection("End", [], [], false)).toBeNull();
        expect(codeToSiblingDirection("PageUp", [], [], false)).toBe("previous");
        expect(codeToSiblingDirection("PageDown", [], [], false)).toBe("next");
    });
});

describe("isTextEntryTarget", () => {
    it("is true for text-entry elements", () => {
        expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
        expect(isTextEntryTarget({ tagName: "textarea" })).toBe(true);
        expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    });

    it("is false for non-text targets and nullish input", () => {
        expect(isTextEntryTarget({ tagName: "DIV" })).toBe(false);
        expect(isTextEntryTarget({ tagName: "BUTTON" })).toBe(false);
        expect(isTextEntryTarget(null)).toBe(false);
    });
});

describe("isInteractiveTarget", () => {
    it("is true for buttons, links and role=button", () => {
        expect(isInteractiveTarget({ tagName: "BUTTON" })).toBe(true);
        expect(isInteractiveTarget({ tagName: "a" })).toBe(true);
        expect(isInteractiveTarget({ tagName: "DIV", getAttribute: () => "button" })).toBe(true);
    });

    it("is false for plain elements and nullish input", () => {
        expect(isInteractiveTarget({ tagName: "DIV", getAttribute: () => null })).toBe(false);
        expect(isInteractiveTarget({ tagName: "IMG" })).toBe(false);
        expect(isInteractiveTarget(null)).toBe(false);
    });
});

describe("sameRoleAttachments", () => {
    const attachments = [
        { attachmentId: "a", role: "image", title: "A" },
        { attachmentId: "b", role: "file", title: "B" },
        { attachmentId: "c", role: "image", title: "C" }
    ];

    it("keeps only attachments sharing the current one's role, in order, as { id, title }", () => {
        expect(sameRoleAttachments(attachments, "a")).toEqual([ { id: "a", title: "A" }, { id: "c", title: "C" } ]);
        expect(sameRoleAttachments(attachments, "b")).toEqual([ { id: "b", title: "B" } ]);
    });

    it("returns empty when the current attachment is absent or unset", () => {
        expect(sameRoleAttachments(attachments, "x")).toEqual([]);
        expect(sameRoleAttachments(attachments, undefined)).toEqual([]);
        expect(sameRoleAttachments([], "a")).toEqual([]);
    });

    it("narrows the role to a mime prefix, so a player only cycles what it can play", () => {
        // Audio, video, PDFs and archives all share the "file" role — only the mime tells them apart.
        const files = [
            { attachmentId: "a", role: "file", title: "A", mime: "audio/mpeg" },
            { attachmentId: "b", role: "file", title: "B", mime: "application/pdf" },
            { attachmentId: "c", role: "file", title: "C", mime: "audio/ogg" },
            { attachmentId: "d", role: "image", title: "D", mime: "image/png" },
            { attachmentId: "e", role: "file", title: "E" }
        ];
        expect(sameRoleAttachments(files, "a", "audio/")).toEqual([ { id: "a", title: "A" }, { id: "c", title: "C" } ]);
        // Without a prefix the role alone decides, as it does for the image viewer.
        expect(sameRoleAttachments(files, "a")).toEqual([ { id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }, { id: "e", title: "E" } ]);
        // An attachment the prefix excludes drops out of its own list; the engine, which needs the current
        // id to be in it, then reports no navigation at all rather than jumping somewhere unplayable.
        expect(sameRoleAttachments(files, "b", "audio/").some((sibling) => sibling.id === "b")).toBe(false);
    });
});
