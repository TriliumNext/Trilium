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

/** Stubs `search-templates`, the only endpoint the service talks to. */
function withTemplates(templateNoteIds: string[] = [], newTemplateNoteIds: string[] = []) {
    const get = vi.fn(async (url: string) => {
        if (url === "search-templates") return { templateNoteIds, newTemplateNoteIds };
        return undefined;
    });
    server.get = get as unknown as typeof server.get;
    return get;
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

describe("getNoteTypeOptions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
    });

    /**
     * What anything offering "make a new note of..." picks from: the note types the tree offers,
     * then the templates the app ships, then the reader's own, each named by an id that outlives
     * the list it came from.
     */
    it("lists the note types the tree offers, then every template", async () => {
        withTemplates([ "userTemplate" ]);
        const restore = withTemplatesRoot([
            fakeTemplate("shipped", [ "template" ], "Shipped"),
            fakeTemplate("notATemplate", [], "Not a template")
        ]);
        const user = buildNote({ id: "userTemplate", title: "Mine", "#template": "" });

        try {
            const options = await noteTypesService.getNoteTypeOptions();

            const types = options.filter(option => option.group === "type");
            expect(types.every(option => option.id.startsWith("type:"))).toBe(true);
            expect(types.some(option => option.id === "type:text:text/html")).toBe(true);
            expect(types.some(option => option.id.startsWith("type:book"))).toBe(false);
            expect(types.some(option => option.id.startsWith("type:image"))).toBe(false);

            // A note under `_templates` that carries no `#template` is not one.
            expect(options.map(option => option.id)).toContain("template:shipped");
            expect(options.map(option => option.id)).not.toContain("template:notATemplate");

            const mine = options.find(option => option.id === `template:${user.noteId}`);
            expect(mine?.group).toBe("user");
            expect(mine?.options).toEqual(expect.objectContaining({ templateNoteId: user.noteId }));

            // A note type is made from its type and mime, which is what `createNote` takes.
            expect(options.find(option => option.id === "type:canvas:application/json")?.options)
                .toEqual({ type: "canvas", mime: "application/json" });
        } finally {
            restore();
        }
    });

    it("offers the chat note type only where that feature is switched on", async () => {
        withTemplates();
        const restore = withTemplatesRoot([]);

        try {
            const isOffered = async () => (await noteTypesService.getNoteTypeOptions())
                .some(option => option.id.startsWith("type:llmChat"));

            expect(await isOffered()).toBe(false);
            llmFlag.mockReturnValue(true);
            expect(await isOffered()).toBe(true);
        } finally {
            restore();
        }
    });

    /** A stored list outlives what it names, and what is gone is left out rather than reported. */
    it("resolves stored ids in their own order, dropping what no longer exists", async () => {
        withTemplates();
        const restore = withTemplatesRoot([]);

        try {
            const available = await noteTypesService.getNoteTypeOptions();
            const offered = noteTypesService.resolveNoteTypeOptions(
                [ "type:canvas:application/json", "template:gone", "type:text:text/html" ],
                available);

            expect(offered.map(option => option.id))
                .toEqual([ "type:canvas:application/json", "type:text:text/html" ]);
        } finally {
            restore();
        }
    });
});

describe("getBlankNoteTypes (via getNoteTypeItems)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
        // Empty templates root and no user templates so we only see blank types.
        withTemplates();
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
        // The server reports "tpl-plain" as a new built-in template; everything else is old.
        withTemplates([], ["tpl-plain"]);
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
            // tpl-plain is reported as new by the server -> gets the "new" badge.
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
        withTemplates();
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
        // The template is not among the new ones -> no badge.
        withTemplates([userTpl.noteId]);
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

describe("new template badges", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        llmFlag.mockReturnValue(false);
    });

    it("badges exactly the templates the server reports as new", async () => {
        const isNew = buildNote({ id: "tpl-new", title: "New template", type: "text" });
        const isOld = buildNote({ id: "tpl-old", title: "Old template", type: "text" });
        const get = withTemplates([isNew.noteId, isOld.noteId], [isNew.noteId]);
        const restore = withTemplatesRoot([]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems();

            const newItem = items.find((i) => i.templateNoteId === isNew.noteId);
            expect(newItem.badges).toHaveLength(1);
            expect(newItem.badges[0].className).toBe("new-note-type-badge");

            const oldItem = items.find((i) => i.templateNoteId === isOld.noteId);
            expect(oldItem.badges).toBeUndefined();

            // The badges cost no request of their own: `search-templates` is the only
            // endpoint hit, no matter how many templates there are.
            expect(get.mock.calls.map((c) => c[0])).toEqual(["search-templates"]);
        } finally {
            restore();
        }
    });

    it("builds several menus from one fetch", async () => {
        // The tree context menu has two note type submenus. Building them from shared data
        // must not fetch the templates twice.
        const get = withTemplates();
        const restore = withTemplatesRoot([fakeTemplate("tpl-plain", ["template"], "Plain")]);
        try {
            const data = await noteTypesService.loadNoteTypeData();
            const first = noteTypesService.buildNoteTypeItems(data, "insertNoteAfter" as never);
            const second = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);

            expect(get.mock.calls.map((c) => c[0])).toEqual(["search-templates"]);
            // Same items, each bound to its own command.
            const ids = (items: any[]) => items.map((i) => i.templateNoteId);
            expect(ids(first)).toEqual(ids(second));
            expect(first.every((i: any) => !i.type || i.command === "insertNoteAfter")).toBe(true);
            expect(second.every((i: any) => !i.type || i.command === "insertChildNote")).toBe(true);
        } finally {
            restore();
        }
    });
});
