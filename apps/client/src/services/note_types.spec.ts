import { beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import options from "./options";
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
import noteTypesService, { isCurrentNoteType, selectableNoteTypes } from "./note_types";

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

            const llmChat = cmdItems.find((i: any) => i.type === "llmChat");
            expect(llmChat.badges).toEqual([]);
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

    /** Every item, those in submenus included. */
    const allItems = (items: any[]): any[] => items.flatMap((i) => [ i, ...allItems(i.items ?? []) ]);
    const builtInSubmenus = (items: any[]) => items
        .filter((i) => i.title === "note_types.book")
        .map((i) => i.title);

    it("warns and offers no built-in templates when the templates root is missing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const restore = withTemplatesRoot(null);
        try {
            const items = await noteTypesService.getNoteTypeItems();
            expect(allItems(items).some((i) => i.templateNoteId)).toBe(false);
            expect(builtInSubmenus(items)).toEqual([]);
            expect(warn).toHaveBeenCalled();
        } finally {
            restore();
            warn.mockRestore();
        }
    });

    it("offers no built-in templates when the templates root has no children", async () => {
        const restore = withTemplatesRoot([]);
        try {
            const items = await noteTypesService.getNoteTypeItems();
            expect(allItems(items).some((i) => i.templateNoteId)).toBe(false);
            expect(builtInSubmenus(items)).toEqual([]);
        } finally {
            restore();
        }
    });

    it("puts a template of no group after a separator and a collection in its submenu, filtering by labels", async () => {
        // A plain template, a collection template, and a child that is not a template at all.
        const plain = fakeTemplate("tpl-plain", ["template"], "Plain");
        const collection = fakeTemplate("tpl-coll", ["template", "collection"], "Coll");
        const notTemplate = fakeTemplate("tpl-skip", ["collection"], "Skip"); // missing "template"
        const restore = withTemplatesRoot([plain, collection, notTemplate]);
        try {
            const items: any[] = await noteTypesService.getNoteTypeItems("cmd" as never);

            // The plain template stands at the top level, after a separator.
            const plainIdx = items.findIndex((i) => i.templateNoteId === "tpl-plain");
            expect(plainIdx).toBeGreaterThan(0);
            expect(items[plainIdx - 1].kind).toBe("separator");

            // The collection template is in the collections submenu, and only there.
            const collections = items.find((i) => i.title === "note_types.book");
            expect(collections.items.map((i: any) => i.templateNoteId)).toEqual([ "tpl-coll" ]);
            expect(allItems(items).filter((i) => i.templateNoteId === "tpl-coll")).toHaveLength(1);
            expect(allItems(items).filter((i) => i.templateNoteId === "tpl-plain")).toHaveLength(1);

            // The note missing the "template" label is never included.
            expect(allItems(items).some((i) => i.templateNoteId === "tpl-skip")).toBe(false);

            // Built-in template items carry command/type/icon/title.
            const plainItem = items[plainIdx];
            expect(plainItem.command).toBe("cmd");
            expect(plainItem.type).toBe("text");
            expect(plainItem.uiIcon).toBe("tn-icon bx-x");
            // tpl-plain is reported as new by the server -> gets the "new" badge.
            expect(plainItem.badges).toHaveLength(1);
            expect(plainItem.badges[0].className).toBe("new-note-type-badge");
            // The old collection template is not marked new.
            expect(collections.items[0].badges).toBeUndefined();
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

    it("puts the collections in a submenu of the menu", async () => {
        withTemplates([], [ "tpl-coll" ]);
        const restore = withTemplatesRoot([
            fakeTemplate("tpl-plain", [ "template" ], "Plain"),
            fakeTemplate("tpl-coll", [ "template", "collection" ], "Coll")
        ]);
        try {
            const data = await noteTypesService.loadNoteTypeData();
            const menu: any[] = noteTypesService.buildNoteTypeItems(data, "insertNoteAfter" as never);

            const submenu = menu.find((i) => i.title === "note_types.book");
            expect(submenu).toBeDefined();
            expect(submenu.kind).toBeUndefined();
            expect(submenu.command).toBeUndefined();
            expect(submenu.items.map((i: any) => i.templateNoteId)).toEqual([ "tpl-coll" ]);
            expect(submenu.items[0].command).toBe("insertNoteAfter");
            expect(submenu.items[0].badges).toHaveLength(1);
            // The collections are only in the submenu, and the menu has no header left for them.
            expect(menu.some((i) => i.templateNoteId === "tpl-coll")).toBe(false);
            expect(menu.some((i) => i.kind === "header")).toBe(false);
            expect(menu.some((i) => i.templateNoteId === "tpl-plain")).toBe(true);

        } finally {
            restore();
        }
    });

    it("puts the snippets and the AI quick action under More, after its note types", async () => {
        withTemplates();
        const restore = withTemplatesRoot([
            fakeTemplate("tpl-text-snippet", [ "template", "textSnippet" ], "Text snippet"),
            fakeTemplate("tpl-code-snippet", [ "template", "snippet" ], "Code snippet"),
            fakeTemplate("tpl-ai", [ "template", "aiQuickAction" ], "AI quick action")
        ]);
        const titles = (items: any[]) => items.map((i) => i.templateNoteId ?? i.type ?? i.kind);
        try {
            llmFlag.mockReturnValue(true);
            const data = await noteTypesService.loadNoteTypeData();
            const menu: any[] = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);

            // Notes the text editor reads, created as rarely as the other entries of More.
            expect(titles(menu).filter((title) => String(title).startsWith("tpl-"))).toEqual([]);
            const more = menu.find((i) => i.title === "note_types.more");
            // After the note types it holds, as the templates follow the note types everywhere in the menu.
            expect(titles(more.items).slice(-4)).toEqual([ "separator", "tpl-text-snippet", "tpl-code-snippet", "tpl-ai" ]);
            expect(more.items.slice(-3).every((i: any) => i.command === "insertChildNote")).toBe(true);


            // Without the AI features, neither the chat nor the quick action is offered.
            llmFlag.mockReturnValue(false);
            const withoutAiMenu: any[] = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);
            const withoutAi = titles([ ...withoutAiMenu, ...withoutAiMenu.at(-1).items ]);
            expect(withoutAiMenu.at(-1).title).toBe("note_types.more");
            expect(withoutAi).not.toContain("llmChat");
            expect(withoutAi).not.toContain("tpl-ai");
            expect(withoutAi.slice(-3)).toEqual([ "separator", "tpl-text-snippet", "tpl-code-snippet" ]);
        } finally {
            restore();
        }
    });

    it("puts the scripting presets at the top of Code, above its languages", async () => {
        withTemplates();
        const restore = withTemplatesRoot([ fakeTemplate("tpl-code-snippet", [ "template", "snippet" ], "Code snippet") ]);
        const key = (i: any) => i.notePreset ?? i.templateNoteId ?? i.mime ?? i.kind;
        const original = options.get("codeNotesMimeTypes");
        try {
            options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python" ]));
            const data = await noteTypesService.loadNoteTypeData();
            const menu: any[] = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);

            const code = menu.find((i) => i.type === "code" && i.mime === "text/plain");
            expect(code.items.map(key)).toEqual([
                "appCss", "widget", "backendScript",
                "separator",
                "text/plain", "text/x-python",
                "separator",
                undefined
            ]);
            expect(code.items.slice(0, 3).every((i: any) => i.command === "insertChildNote")).toBe(true);

            // Neither the top level nor More offers them a second time.
            const more = menu.find((i) => i.title === "note_types.more");
            expect([ ...menu, ...more.items ].some((i) => i.notePreset)).toBe(false);
            expect(more.items.map(key).slice(-2)).toEqual([ "separator", "tpl-code-snippet" ]);
        } finally {
            options.set("codeNotesMimeTypes", original);
            restore();
        }
    });

    it("groups the note types of the menu by kind, common ones first, and offers each exactly once", async () => {
        withTemplates();
        const restore = withTemplatesRoot([ fakeTemplate("tpl-ai", [ "template", "aiQuickAction" ], "AI quick action") ]);
        const key = (i: any) => i.kind ?? (i.mime === "text/x-markdown" ? "markdown" : i.type) ?? i.title;
        try {
            llmFlag.mockReturnValue(true);
            const data = await noteTypesService.loadNoteTypeData();
            const menu: any[] = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);
            expect(menu.map(key)).toEqual([
                "text", "markdown", "code", "spreadsheet", "llmChat",
                "separator",
                "canvas", "mermaid", "mindMap", "relationMap",
                "separator",
                "note_types.more"
            ]);

            // No creatable type is left out or offered twice, at the top level and under More.
            const offered = [ ...menu, ...menu.at(-1).items ]
                .filter((i) => i.command && !i.templateNoteId && !i.notePreset).map(key);
            const creatable = selectableNoteTypes(false).filter((nt) => nt.type !== "book")
                .map((nt) => (nt.mime === "text/x-markdown" ? "markdown" : nt.type));
            expect([ ...offered ].sort()).toEqual([ ...creatable, "noteMap", "search" ].sort());

            // Without AI, the chat is left out of its group.
            llmFlag.mockReturnValue(false);
            const withoutAi = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never).map(key);
            expect(withoutAi.slice(0, 5)).toEqual([ "text", "markdown", "code", "spreadsheet", "separator" ]);

        } finally {
            restore();
        }
    });

    it("puts the rarely created note types in a More submenu of the menu, after the collections", async () => {
        withTemplates();
        const restore = withTemplatesRoot([
            fakeTemplate("tpl-snippet", [ "template", "snippet" ], "Snippet"),
            fakeTemplate("tpl-coll", [ "template", "collection" ], "Coll")
        ]);
        const rare = [ "noteMap", "render", "search", "webView" ];
        try {
            const data = await noteTypesService.loadNoteTypeData();
            const menu: any[] = noteTypesService.buildNoteTypeItems(data, "insertNoteAfter" as never);

            const more = menu.find((i) => i.title === "note_types.more");
            expect(more).toBeDefined();
            expect(more.command).toBeUndefined();
            expect(more.items.slice(0, rare.length).map((i: any) => i.type)).toEqual(rare);
            expect(more.items.every((i: any) => i.kind === "separator" || i.command === "insertNoteAfter")).toBe(true);
            expect(menu.some((i) => rare.includes(i.type))).toBe(false);
            const submenus = menu.filter((i) => i.items && i.type === undefined).map((i) => i.title);
            expect(submenus).toEqual([ "note_types.book", "note_types.more" ]);

        } finally {
            restore();
        }
    });

    it("escapes template titles, as a menu renders them as HTML", async () => {
        const user = buildNote({ id: "userTemplateHtml", title: "<img src=x onerror=alert(1)>", "#template": "" });
        withTemplates([ user.noteId ]);
        const restore = withTemplatesRoot([
            fakeTemplate("tpl-snippet", [ "template", "snippet" ], "A & <b>B</b>"),
            fakeTemplate("tpl-coll", [ "template", "collection" ], "<i>Board</i>")
        ]);
        const all = (items: any[]): any[] => items.flatMap((i) => [ i, ...all(i.items ?? []) ]);
        const titleOf = (items: any[], templateNoteId: string) =>
            all(items).find((i) => i.templateNoteId === templateNoteId)?.title;
        try {
            const data = await noteTypesService.loadNoteTypeData();
            const menu = noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never);
            /** What `Menu` shows for a title: the title as HTML, here as its elements and its text. */
            const rendered = (title: string) => {
                const element = document.createElement("span");
                element.innerHTML = title;
                return { elements: element.children.length, text: element.textContent };
            };
            expect(rendered(titleOf(menu, user.noteId))).toEqual({ elements: 0, text: "<img src=x onerror=alert(1)>" });
            expect(rendered(titleOf(menu, "tpl-snippet"))).toEqual({ elements: 0, text: "A & <b>B</b>" });
            expect(rendered(titleOf(menu, "tpl-coll"))).toEqual({ elements: 0, text: "<i>Board</i>" });

        } finally {
            restore();
        }
    });

    it("offers the enabled code languages in a submenu of Code, as they stand when the menu opens", async () => {
        withTemplates();
        const restore = withTemplatesRoot([]);
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(async () => undefined);
        const original = options.get("codeNotesMimeTypes");
        try {
            const data = await noteTypesService.loadNoteTypeData();
            const codeRow = (items: any[]) => items.find((i) => i.type === "code" && i.mime === "text/plain");

            options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python", "text/x-markdown" ]));
            const code = codeRow(noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never));
            // The row still makes a plain text code note of its own.
            expect(code.command).toBe("insertChildNote");
            // The scripting presets lead the submenu; the languages follow them.
            const languages = code.items.filter((i: any) => i.mime && !i.notePreset);
            // Plain text is always enabled; Markdown has an entry of its own.
            expect(languages.map((i: any) => i.mime)).toEqual([ "text/plain", "text/x-python" ]);
            expect(languages.every((i: any) => i.type === "code" && i.command === "insertChildNote")).toBe(true);
            // The icon the note takes in the tree once created.
            expect(languages.map((i: any) => i.uiIcon)).toEqual([ "bx bx-file", "bx bxl-python" ]);

            const configure = code.items.at(-1);
            expect(configure.command).toBeUndefined();
            configure.handler();
            expect(triggerCommand).toHaveBeenCalledWith("showOptions", { section: "_optionsCodeNotes" });

            // A language enabled since is offered the next time the menu opens.
            options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python", "text/apl" ]));
            const again = codeRow(noteTypesService.buildNoteTypeItems(data, "insertChildNote" as never));
            expect(again.items.filter((i: any) => i.mime).map((i: any) => i.mime)).toContain("text/apl");
            // A language without an icon of its own takes that of the code note type.
            expect(again.items.find((i: any) => i.mime === "text/apl").uiIcon).toBe("bx bx-code");

        } finally {
            options.set("codeNotesMimeTypes", original);
            triggerCommand.mockRestore();
            restore();
        }
    });
});

describe("isCurrentNoteType", () => {
    const CODE = { type: "code", mime: "text/plain" } as const;
    const MARKDOWN = { type: "code", mime: "text/x-markdown" } as const;

    it("tells the two code entries apart, which share a type", () => {
        // A JavaScript note is the plain code entry, never the Markdown one.
        const script = buildNote({ title: "script", type: "code", mime: "application/javascript" });
        expect(isCurrentNoteType(CODE, script)).toBe(true);
        expect(isCurrentNoteType(MARKDOWN, script)).toBe(false);

        // Every mime `isMarkdown()` accepts picks the Markdown entry, `text/x-gfm` included.
        for (const mime of [ "text/x-markdown", "text/markdown", "text/x-gfm" ]) {
            const note = buildNote({ title: mime, type: "code", mime });
            expect(isCurrentNoteType(MARKDOWN, note)).toBe(true);
            expect(isCurrentNoteType(CODE, note)).toBe(false);
        }
    });

    it("matches every other type on the type alone, and nothing without a note", () => {
        const text = buildNote({ title: "prose", type: "text", mime: "text/html" });
        expect(isCurrentNoteType({ type: "text", mime: "text/html" }, text)).toBe(true);
        expect(isCurrentNoteType({ type: "canvas", mime: "application/json" }, text)).toBe(false);
        expect(isCurrentNoteType(CODE, text)).toBe(false);
        expect(isCurrentNoteType(CODE, null)).toBe(false);
    });
});

describe("selectableNoteTypes", () => {
    // The suite's other resets live inside their own describes, so pin the flag here rather than
    // inheriting whatever the last test left behind.
    beforeEach(() => llmFlag.mockReturnValue(false));

    it("drops Markdown only where the MIME list already offers it", () => {
        const markdownEntry = (withMimeList: boolean) =>
            selectableNoteTypes(withMimeList).filter((nt) => nt.mime === "text/x-markdown");

        // Beside the MIME list the code entries are only its heading, so one heading is left.
        expect(markdownEntry(true)).toHaveLength(0);
        expect(selectableNoteTypes(true).filter((nt) => nt.type === "code")).toHaveLength(1);

        // On its own the menu is the only way to reach Markdown, so it stays.
        expect(markdownEntry(false)).toHaveLength(1);
    });

    it("leaves out what cannot be created either way", () => {
        for (const withMimeList of [ true, false ]) {
            const types = selectableNoteTypes(withMimeList);
            expect(types.some((nt) => nt.reserved)).toBe(false);
            expect(types.some((nt) => nt.static)).toBe(false);
            // The chat type is behind an experimental flag, mocked off for this suite.
            expect(types.some((nt) => nt.type === "llmChat")).toBe(false);
            expect(types.some((nt) => nt.type === "text")).toBe(true);
        }
    });
});
