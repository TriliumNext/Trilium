import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import server from "./server.js";

// i18next is not initialized in the test env, so the real `t` returns undefined.
// Echo the key so titles are truthy (covers the title->header branch in
// getBuiltInTemplates and gives badges a stable title).
vi.mock("./i18n.js", () => ({
    t: (key: string) => key
}));

// Control the llmChat gating deterministically.
vi.mock("./experimental_features.js", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));

import { isExperimentalFeatureEnabled } from "./experimental_features.js";
import noteTypesService from "./note_types";

const llmFlag = vi.mocked(isExperimentalFeatureEnabled);

// Builds a fresh `_templates`-rooted tree for getBuiltInTemplates. Because froca and
// the module-level `_templates` note are singletons, we recreate it under a unique
// child set per test by overriding froca.getNote/getChildNotes for that note id.
type FakeNote = {
    noteId: string;
    title: string;
    type: string;
    hasLabel: (n: string) => boolean;
    getIcon: () => string;
    getChildNotes: () => Promise<FakeNote[]>;
};

function fakeTemplate(noteId: string, labels: string[], title = noteId): FakeNote {
    return {
        noteId,
        title,
        type: "text",
        hasLabel: (n: string) => labels.includes(n),
        getIcon: () => "tn-icon bx-x",
        getChildNotes: async () => []
    };
}

function withTemplatesRoot(children: FakeNote[] | null) {
    const realGetNote = froca.getNote.bind(froca);
    froca.getNote = (async (noteId: string, silent?: boolean) => {
        if (noteId === "_templates") {
            if (children === null) {
                return null;
            }
            return {
                noteId: "_templates",
                getChildNotes: async () => children
            };
        }
        return realGetNote(noteId, silent ?? false);
    }) as typeof froca.getNote;
    return () => {
        froca.getNote = realGetNote;
    };
}

describe("getBlankNoteTypes (via getNoteTypeItems)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
        // Empty templates root and no user templates so we only see blank types.
        server.get = vi.fn(async (url: string) => {
            if (url === "search-templates") return [];
            return undefined;
        }) as typeof server.get;
    });

    it("excludes reserved types, book, and llmChat (when feature disabled), and maps icons/badges", async () => {
        const restore = withTemplatesRoot([]);
        try {
            const items = await noteTypesService.getNoteTypeItems("note-types-command" as never);
            const cmdItems: any[] = items.filter((i: any) => i.type);

            const types = cmdItems.map((i: any) => i.type);
            // reserved types are removed
            for (const reserved of ["contentWidget", "doc", "file", "image", "launcher"]) {
                expect(types).not.toContain(reserved);
            }
            // book is removed, llmChat removed while feature disabled
            expect(types).not.toContain("book");
            expect(types).not.toContain("llmChat");
            // a few expected types survive
            expect(types).toContain("text");
            expect(types).toContain("mermaid");

            // every command item carries the passed command and a bx-prefixed icon
            for (const item of cmdItems) {
                expect(item.command).toBe("note-types-command");
                expect(item.uiIcon.startsWith("bx ")).toBe(true);
            }

            // the per-type `mime` is mapped through verbatim (note creation depends on it)
            const text = cmdItems.find((i: any) => i.type === "text");
            expect(text.mime).toBe("text/html");
            const spreadsheet = cmdItems.find((i: any) => i.type === "spreadsheet");
            expect(spreadsheet.mime).toBe("application/json");

            // isNew -> NEW badge, isBeta -> BETA badge. spreadsheet is both new+beta.
            expect(spreadsheet.badges).toHaveLength(2);
            // exactly one NEW badge (has the className) ...
            const newBadges = spreadsheet.badges.filter((b: any) => b.className === "new-note-type-badge");
            expect(newBadges).toHaveLength(1);
            // ... and exactly one BETA badge (the badge with only a title, no className).
            const betaBadges = spreadsheet.badges.filter((b: any) => b.className === undefined);
            expect(betaBadges).toHaveLength(1);
            expect(typeof betaBadges[0].title).toBe("string");
            expect(betaBadges[0].title.length).toBeGreaterThan(0);

            // text has no badges
            expect(text.badges).toEqual([]);
        } finally {
            restore();
        }
    });

    it("includes llmChat when the llm experimental feature is enabled", async () => {
        llmFlag.mockImplementation((id: string) => id === "llm");
        const restore = withTemplatesRoot([]);
        try {
            const items = await noteTypesService.getNoteTypeItems();
            const cmdItems: any[] = items.filter((i: any) => i.type);
            const types = cmdItems.map((i: any) => i.type);
            expect(types).toContain("llmChat");

            // llmChat is isBeta only -> exactly one BETA badge (title, no className).
            const llmChat = cmdItems.find((i: any) => i.type === "llmChat");
            expect(llmChat.badges).toHaveLength(1);
            expect(llmChat.badges[0].className).toBeUndefined();
            expect(typeof llmChat.badges[0].title).toBe("string");
            expect(llmChat.badges[0].title.length).toBeGreaterThan(0);
        } finally {
            restore();
        }
    });
});

describe("getBuiltInTemplates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
        server.get = vi.fn(async (url: string) => {
            if (url === "search-templates") return [];
            // notes/root returns an object WITHOUT dateCreated: exercises the
            // `"dateCreated" in rootNoteInfo` false branch AND keeps the module-level
            // rootCreationDate undefined for the following tests.
            if (url === "notes/root") return { id: "root" };
            // A recent built-in template ("tpl-plain") gets the "new" badge; everything
            // else is old.
            if (url === "notes/tpl-plain") return { dateCreated: new Date().toISOString() };
            return { dateCreated: "2000-01-02 00:00:00.000Z" };
        }) as typeof server.get;
    });

    it("warns and returns nothing when the templates root is missing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const restore = withTemplatesRoot(null);
        try {
            const items = await noteTypesService.getNoteTypeItems();
            // No header/separator coming from built-in templates -> only blank note types remain.
            expect(items.some((i: any) => i.kind === "separator")).toBe(false);
            expect(items.some((i: any) => i.kind === "header")).toBe(false);
            expect(warn).toHaveBeenCalled();
        } finally {
            restore();
            warn.mockRestore();
        }
    });

    it("returns nothing when the templates root has no children", async () => {
        const restore = withTemplatesRoot([]);
        try {
            const items = await noteTypesService.getNoteTypeItems();
            expect(items.some((i: any) => i.kind === "separator")).toBe(false);
            expect(items.some((i: any) => i.kind === "header")).toBe(false);
        } finally {
            restore();
        }
    });

    it("emits a separator for non-collection group and a header for the collections group, filtering by labels", async () => {
        // Children include: a plain template (non-collection), a collection template,
        // and a child that is neither a template nor matches -> skipped in both passes.
        const plain = fakeTemplate("tpl-plain", ["template"], "Plain");
        const collection = fakeTemplate("tpl-coll", ["template", "collection"], "Coll");
        const notTemplate = fakeTemplate("tpl-skip", ["collection"], "Skip"); // missing "template"
        const restore = withTemplatesRoot([plain, collection, notTemplate]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems("cmd" as never);

            // Non-collection pass (filterCollections=false, title=null) pushes a separator
            // then the plain template.
            const sepIdx = items.findIndex((i) => i.kind === "separator");
            expect(sepIdx).toBeGreaterThanOrEqual(0);
            expect(items.some((i) => i.templateNoteId === "tpl-plain")).toBe(true);

            // Collections pass (filterCollections=true, title set) pushes a header then
            // the collection template.
            const headerIdx = items.findIndex((i) => i.kind === "header");
            expect(headerIdx).toBeGreaterThanOrEqual(0);
            expect(items.some((i) => i.templateNoteId === "tpl-coll")).toBe(true);

            // The note missing the "template" label is never included.
            expect(items.some((i) => i.templateNoteId === "tpl-skip")).toBe(false);

            // Each template is emitted in EXACTLY ONE pass — the label filter must keep
            // tpl-plain out of the collections pass and tpl-coll out of the non-collection
            // pass. An inverted/broken filter would emit a template in both passes (a
            // duplicate), which `.some(...)` above would not catch.
            const plainIdx = items.findIndex((i) => i.templateNoteId === "tpl-plain");
            const collIdx = items.findIndex((i) => i.templateNoteId === "tpl-coll");
            expect(items.filter((i) => i.templateNoteId === "tpl-plain")).toHaveLength(1);
            expect(items.filter((i) => i.templateNoteId === "tpl-coll")).toHaveLength(1);

            // ...and the placement reflects which pass emitted them: tpl-plain (non-collection
            // pass) precedes the collections header; tpl-coll (collections pass) follows it.
            expect(plainIdx).toBeLessThan(headerIdx);
            expect(collIdx).toBeGreaterThan(headerIdx);

            // built-in template items carry command/type/icon/title.
            const plainItem = items.find((i) => i.templateNoteId === "tpl-plain");
            expect(plainItem.command).toBe("cmd");
            expect(plainItem.type).toBe("text");
            expect(plainItem.uiIcon).toBe("tn-icon bx-x");
            // tpl-plain has a recent creation date -> gets the "new" badge.
            expect(plainItem.badges).toHaveLength(1);
            expect(plainItem.badges[0].className).toBe("new-note-type-badge");
            // The old collection template is not marked new.
            const collItem = items.find((i) => i.templateNoteId === "tpl-coll");
            expect(collItem.badges).toBeUndefined();
        } finally {
            restore();
        }
    });
});

describe("getUserTemplates", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
    });

    it("returns nothing when there are no user template notes", async () => {
        server.get = vi.fn(async (url: string) => {
            if (url === "search-templates") return [];
            return undefined;
        }) as typeof server.get;
        const restore = withTemplatesRoot([]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems();
            // The user-templates header should not be present.
            expect(items.some((i) => i.kind === "header" && i.templateNoteId === undefined && i.title === "note_type_chooser.templates")).toBe(false);
        } finally {
            restore();
        }
    });

    it("adds a header and one item per user template, mapping note fields", async () => {
        const userTpl = buildNote({ title: "My Template", type: "text" });
        server.get = vi.fn(async (url: string) => {
            if (url === "search-templates") return [userTpl.noteId];
            if (url === "notes/root") throw new Error("no root");
            // Old creation date -> not "new".
            return { dateCreated: "2000-01-02 00:00:00.000Z" };
        }) as typeof server.get;
        const restore = withTemplatesRoot([]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems("cmd2" as never);
            expect(items.some((i) => i.kind === "header")).toBe(true);
            const tplItem = items.find((i) => i.templateNoteId === userTpl.noteId);
            expect(tplItem).toBeTruthy();
            expect(tplItem.title).toBe("My Template");
            expect(tplItem.command).toBe("cmd2");
            expect(tplItem.type).toBe("text");
            expect(typeof tplItem.uiIcon).toBe("string");
            // Old template -> no "new" badge.
            expect(tplItem.badges).toBeUndefined();
        } finally {
            restore();
        }
    });
});

describe("isNewTemplate (via getUserTemplates)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
    });

    async function runWithTemplate(noteId: string, getImpl: (url: string) => Promise<unknown>) {
        const tpl = buildNote({ id: noteId, title: noteId, type: "text" });
        server.get = vi.fn(getImpl) as typeof server.get;
        const restore = withTemplatesRoot([]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems();
            return items.find((i) => i.templateNoteId === tpl.noteId);
        } finally {
            restore();
        }
    }

    // NOTE on ordering: the module caches `rootCreationDate` on the FIRST successful
    // `notes/root` fetch and never resets it. To keep it `undefined` for the
    // age-based-branch tests, those tests make `notes/root` throw (a throw is caught,
    // leaving the date unset). The single test that sets a real root date — the "30s"
    // test — runs LAST so it cannot pollute the others.

    it("tolerates a failing notes/root fetch (root date stays unknown) and marks a recent template as new", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const recent = new Date().toISOString();
        // notes/root throws -> caught, rootCreationDate stays undefined; template fetched
        // with a recent date and no root date -> age check applies -> new badge.
        const item = await runWithTemplate("isnew-recent-1", async (url) => {
            if (url === "search-templates") return ["isnew-recent-1"];
            if (url === "notes/root") throw new Error("boom");
            return { dateCreated: recent };
        });
        expect(item.badges).toHaveLength(1);
        expect(item.badges[0].className).toBe("new-note-type-badge");
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("does not mark an old template as new (age check returns false)", async () => {
        // root fetch throws -> rootCreationDate undefined -> skips 30s check, reaches age check.
        const item = await runWithTemplate("isnew-old", async (url) => {
            if (url === "search-templates") return ["isnew-old"];
            if (url === "notes/root") throw new Error("no root");
            return { dateCreated: "1999-06-01 00:00:00.000Z" };
        });
        expect(item.badges).toBeUndefined();
    });

    it("returns no badge when the note fetch fails (creation date stays unknown)", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        // Template note fetch throws -> creationDate stays undefined -> returns false (no badge).
        const item = await runWithTemplate("isnew-nodate", async (url) => {
            if (url === "search-templates") return ["isnew-nodate"];
            if (url === "notes/root") throw new Error("no root");
            throw new Error("note fetch failed");
        });
        expect(item.badges).toBeUndefined();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("returns no badge when the note response has no dateCreated field", async () => {
        // notes/<id> returns an object without dateCreated -> creationDate stays
        // undefined -> returns false. Exercises the `"dateCreated" in noteInfo` false branch.
        const item = await runWithTemplate("isnew-nofield", async (url) => {
            if (url === "search-templates") return ["isnew-nofield"];
            if (url === "notes/root") throw new Error("no root");
            return { id: "isnew-nofield" };
        });
        expect(item.badges).toBeUndefined();
    });

    it("uses the cached creation date on a second lookup (no second notes/<id> fetch)", async () => {
        const recent = new Date().toISOString();
        const getImpl = vi.fn(async (url: string) => {
            if (url === "search-templates") return ["isnew-cached"];
            if (url === "notes/root") throw new Error("no root");
            return { dateCreated: recent };
        });
        buildNote({ id: "isnew-cached", title: "isnew-cached", type: "text" });
        server.get = getImpl as unknown as typeof server.get;
        const restore = withTemplatesRoot([]);
        try {
            await noteTypesService.getNoteTypeItems();
            const callsAfterFirst = getImpl.mock.calls.filter((c) => c[0] === "notes/isnew-cached").length;
            await noteTypesService.getNoteTypeItems();
            const callsAfterSecond = getImpl.mock.calls.filter((c) => c[0] === "notes/isnew-cached").length;
            // The per-note creation date is cached, so it is fetched at most once.
            expect(callsAfterFirst).toBe(1);
            expect(callsAfterSecond).toBe(1);
        } finally {
            restore();
        }
    });

    // MUST run before the "cached root date" test below: this is the only test that
    // lets `notes/root` resolve, which permanently caches `rootCreationDate` in the module.
    it("ignores templates created within 30s of the root note (no new badge)", async () => {
        const root = new Date();
        const justAfterRoot = new Date(root.getTime() + 10_000).toISOString();
        const item = await runWithTemplate("isnew-near-root", async (url) => {
            if (url === "search-templates") return ["isnew-near-root"];
            if (url === "notes/root") return { dateCreated: root.toISOString() };
            return { dateCreated: justAfterRoot };
        });
        expect(item.badges).toBeUndefined();
    });

    // MUST be last: relies on `rootCreationDate` already being cached by the test above.
    it("does not re-fetch notes/root once the root creation date is cached", async () => {
        const getImpl = vi.fn(async (url: string) => {
            if (url === "search-templates") return ["isnew-after-cached"];
            // notes/root must NOT be requested anymore; if it were, this would throw.
            if (url === "notes/root") throw new Error("root should not be fetched again");
            return { dateCreated: "1999-06-01 00:00:00.000Z" };
        });
        buildNote({ id: "isnew-after-cached", title: "isnew-after-cached", type: "text" });
        server.get = getImpl as unknown as typeof server.get;
        const restore = withTemplatesRoot([]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems();
            const item = items.find((i) => i.templateNoteId === "isnew-after-cached");
            // Old template -> not new regardless.
            expect(item.badges).toBeUndefined();
            // The cached root date means notes/root is never requested.
            expect(getImpl.mock.calls.some((c) => c[0] === "notes/root")).toBe(false);
        } finally {
            restore();
        }
    });
});
