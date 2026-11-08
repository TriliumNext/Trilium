import type {
    AiQuickAction, AiQuickActionFooter, AiQuickActionGroup, CKTextEditor, ModelElement,
    SortTargetKind
} from "@triliumnext/ckeditor5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
const experimentalState = vi.hoisted(() => ({ enabled: new Set<string>() }));
vi.mock("../services/experimental_features.js", () => ({
    isExperimentalFeatureEnabled: (id: string) => experimentalState.enabled.has(id)
}));

import { setEditorNoteId } from "../widgets/react/NoteStore.js";
import type { MenuCommandItem, MenuItem } from "./context_menu.js";
import {
    buildAiActionsMenuItem, buildAiAssistantMenuItem, buildSortSelectionMenuItem,
    getTextEditorAtSelection
} from "./text_editor_context_menu.js";

const GROUPS: AiQuickActionGroup[] = [
    {
        id: "edit",
        label: "Edit or review",
        actions: [{ id: "fixTypos", label: "Fix typos", prompt: "…", iconClass: "bx bx-check-double" }]
    },
    {
        id: "generate",
        label: "Generate",
        actions: [{ id: "draft", label: "Draft", prompt: "…", requiresContent: false }]
    },
    {
        id: "adjust",
        label: "Adjust",
        submenu: true,
        iconClass: "bx bx-ruler",
        actions: [{ id: "makeShorter", label: "Shorter", prompt: "…" }]
    },
    {
        id: "tone",
        label: "Change tone",
        submenu: true,
        actions: [{ id: "casual", label: "Casual", prompt: "…" }],
        footer: { label: "Configure…", iconClass: "bx bx-cog", run: vi.fn() }
    }
];

/** The pieces of `AiAssistantUI` and the editor that the menu builder reads. */
function fakeEditor({
    domRoot,
    groups = GROUPS,
    menuFooter = [],
    hasContext = true,
    isStreaming = false,
    isEnabled = true,
    hasPlugin = true
}: {
    domRoot: HTMLElement;
    groups?: AiQuickActionGroup[];
    menuFooter?: AiQuickActionFooter[];
    hasContext?: boolean;
    isStreaming?: boolean;
    isEnabled?: boolean;
    hasPlugin?: boolean;
}) {
    // The live lists are the plugin's, which the editor config only seeded.
    const ui = {
        hasContext, isStreaming, quickActions: groups, menuFooter, runQuickAction: vi.fn(),
        isOpen: false, hide: vi.fn()
    };
    const editor = {
        editing: { view: { getDomRoot: () => domRoot } },
        plugins: { has: () => hasPlugin, get: () => ui },
        commands: { get: () => ({ isEnabled }) },
        execute: vi.fn()
    };
    makeNoteEditorRoot(domRoot, editor, "note1");
    return { editor, ui };
}

/**
 * An editable root of `editor`, as CKEditor renders it, in a text editor that holds the content
 * of `noteId`.
 */
function noteEditorRoot(editor: object, noteId?: string) {
    return makeNoteEditorRoot(document.createElement("div"), editor, noteId);
}

/** Turns `element` into an editable root of `editor`, which holds the content of `noteId`. */
function makeNoteEditorRoot(element: HTMLElement, editor: object, noteId?: string) {
    element.classList.add("ck-editor__editable");
    Object.assign(element, { ckeditorInstance: editor });
    if (noteId) {
        setEditorNoteId(editor, noteId);
    }
    return element;
}

/** Wraps `content` in the `data-cke-ignore-events` wrapper of an embed. */
function embedWrapper(content: HTMLElement) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-cke-ignore-events", "true");
    wrapper.appendChild(content);
    return wrapper;
}

/** The content of a code editor with one line of `text`, as CodeMirror renders it. */
function codeContent(text: string) {
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    const line = content.appendChild(document.createElement("div"));
    line.className = "cm-line";
    line.textContent = text;
    return content;
}

/** Points `window.getSelection()` at `anchorNode`. */
function setSelection(anchorNode: Node | null) {
    vi.spyOn(window, "getSelection").mockReturnValue({ anchorNode } as unknown as Selection);
}

function titles(items: MenuItem<string>[]) {
    return items.map((item) => ("kind" in item ? `--- ${item.kind} ---` : item.title));
}

function commandItems(items: MenuItem<string>[]) {
    return items.filter((item) => !("kind" in item)) as MenuCommandItem<string>[];
}

describe("getTextEditorAtSelection", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("finds the editor of the note holding the selection, wherever it is", async () => {
        for (const holder of [ "note-split", "modal popup-editor-dialog" ]) {
            const container = document.createElement("div");
            container.className = holder;
            const editor = {};
            const root = container.appendChild(noteEditorRoot(editor, "note1"));
            const inside = root.appendChild(document.createTextNode("hello"));

            setSelection(inside);
            expect(await getTextEditorAtSelection(), holder).toBe(editor);
        }

        setSelection(document.createTextNode("elsewhere"));
        expect(await getTextEditorAtSelection()).toBeNull();
        setSelection(null);
        expect(await getTextEditorAtSelection()).toBeNull();
    });

    it("returns the editor of an included note that is edited inside the note", async () => {
        const editor = {};
        const root = noteEditorRoot(editor, "note1");
        const nestedEditor = {};
        const nestedRoot = noteEditorRoot(nestedEditor, "note2");
        const caption = document.createElement("div");
        caption.className = "ck-editor__editable ck-editor__nested-editable";
        root.append(embedWrapper(nestedRoot), caption);
        const nestedText = nestedRoot.appendChild(document.createTextNode("inside"));
        const nestedCaption = nestedRoot.appendChild(caption.cloneNode());

        setSelection(nestedText);
        expect(await getTextEditorAtSelection()).toBe(nestedEditor);
        setSelection(nestedCaption);
        expect(await getTextEditorAtSelection()).toBe(nestedEditor);
        // The editable caption of a widget belongs to the editor around it.
        setSelection(caption.appendChild(document.createTextNode("caption")));
        expect(await getTextEditorAtSelection()).toBe(editor);
    });

    it("leaves out an editor that holds no note, such as the attribute editor", async () => {
        const root = noteEditorRoot({});
        setSelection(root.appendChild(document.createTextNode("#label")));

        expect(await getTextEditorAtSelection()).toBeNull();
    });

    it("leaves out the editor around the content of an embed, such as a code editor", async () => {
        const root = noteEditorRoot({}, "note1");
        const nestedRoot = noteEditorRoot({}, "note2");
        root.append(embedWrapper(codeContent("const a = 1;")), embedWrapper(nestedRoot));
        nestedRoot.appendChild(embedWrapper(codeContent("const b = 2;")));

        for (const text of [ "const a = 1;", "const b = 2;" ]) {
            const line = [ ...root.querySelectorAll(".cm-line") ]
                .find((element) => element.textContent === text);
            expect(line, text).toBeDefined();
            setSelection(line?.firstChild ?? null);
            expect(await getTextEditorAtSelection(), text).toBeNull();
        }
    });
});

describe("buildAiActionsMenuItem", () => {
    /** The editable root the selection sits in, so every editor below is the one that was clicked. */
    let root: HTMLElement;

    beforeEach(() => {
        vi.restoreAllMocks();
        root = document.createElement("div");
        const anchor = document.createTextNode("hello");
        root.appendChild(anchor);
        setSelection(anchor);
    });

    function build(overrides: Omit<Parameters<typeof fakeEditor>[0], "domRoot"> = {}) {
        return fakeEditor({ domRoot: root, ...overrides });
    }

    it("mirrors the toolbar's grouping: inlined actions, submenus, and a rule between groups except between two submenus", async () => {
        build();
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect([ item.title, item.uiIcon ]).toEqual([ "ai_assistant.title", "bx bx-bot" ]);
        expect(titles(item.items ?? [])).toEqual([
            "ai_assistant.action_ask",
            "--- separator ---",
            "Fix typos",
            "--- separator ---",
            "Draft",
            "--- separator ---",
            "Adjust",
            "Change tone"
        ]);

        const adjust = commandItems(item.items ?? []).find((i) => i.title === "Adjust");
        expect(adjust?.uiIcon).toBe("bx bx-ruler");
        expect(titles(adjust?.items ?? [])).toEqual(["Shorter"]);
    });

    it("disables the actions that need content — and the submenus whose actions all do", async () => {
        build({ hasContext: false });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const enabled = Object.fromEntries(commandItems(item.items ?? []).map((i) => [i.title, i.enabled]));

        expect(enabled).toMatchObject({
            "ai_assistant.action_ask": undefined,
            "Fix typos": false,
            Draft: true,
            Adjust: false,
            // Its actions all need content, but the row that configures them does not, so the
            // submenu still opens.
            "Change tone": true
        });
    });

    // A group whose contents are configurable ends with the row that configures them, below a rule
    // and runnable whatever the selection is.
    it("closes a group's submenu with its footer, and leaves it runnable without content", async () => {
        build({ hasContext: false });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const tone = commandItems(item.items ?? []).find((i) => i.title === "Change tone");

        expect(titles(tone?.items ?? [])).toEqual(["Casual", "--- separator ---", "Configure…"]);

        const configure = commandItems(tone?.items ?? []).find((i) => i.title === "Configure…");
        expect([configure?.enabled, configure?.uiIcon]).toEqual([true, "bx bx-cog"]);
        configure?.handler?.(configure, null as never);
        expect(GROUPS.find((g) => g.id === "tone")?.footer?.run).toHaveBeenCalled();
    });

    // The rows the menu itself ends with — what a run answers to, the model it speaks to — reached
    // through a submenu when one holds others.
    it("closes the whole menu with its footer rows, headed as the toolbar heads them", async () => {
        const run = vi.fn();
        build({
            hasContext: false,
            menuFooter: [{
                label: "Model: Sonnet 5",
                iconClass: "bx bx-chip",
                children: [
                    { label: "Sonnet 5", iconClass: "bx bx-check", heading: "Anthropic", run },
                    { label: "Opus 5", iconClass: "bx bx-empty", run: vi.fn() },
                    { label: "GPT-5", iconClass: "bx bx-empty", heading: "OpenAI", run: vi.fn() }
                ]
            }]
        });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect(titles(item.items ?? []).slice(-2)).toEqual(["--- separator ---", "Model: Sonnet 5"]);

        const picker = commandItems(item.items ?? []).find((i) => i.title === "Model: Sonnet 5");
        expect([picker?.enabled, picker?.uiIcon]).toEqual([true, "bx bx-chip"]);
        expect(titles(picker?.items ?? [])).toEqual([
            "--- header ---", "Sonnet 5", "Opus 5", "--- header ---", "GPT-5"
        ]);
        expect(picker?.items?.filter((row) => "kind" in row)).toEqual([
            { kind: "header", title: "Anthropic" }, { kind: "header", title: "OpenAI" }
        ]);

        const [model] = commandItems(picker?.items ?? []);
        expect([model.title, model.uiIcon]).toEqual(["Sonnet 5", "bx bx-check"]);
        model.handler?.(model, null as never);
        expect(run).toHaveBeenCalled();
    });

    it("runs the picked action, and opens the free-form prompt from the first row", async () => {
        const { editor, ui } = build();
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;
        const rows = commandItems(item.items ?? []);

        rows[0].handler?.(rows[0], null as never);
        expect(editor.execute).toHaveBeenCalledWith("aiAssistant");

        const fixTypos = rows.find((i) => i.title === "Fix typos");
        fixTypos?.handler?.(fixTypos, null as never);
        expect(ui.runQuickAction).toHaveBeenCalledWith(
            expect.objectContaining({ id: "fixTypos" }) satisfies AiQuickAction
        );
    });

    it("degrades to a plain row with no quick actions configured", async () => {
        const { editor } = build({ groups: [] });
        const item = await buildAiActionsMenuItem() as MenuCommandItem<string>;

        expect(item.items).toBeUndefined();
        item.handler?.(item, null as never);
        expect(editor.execute).toHaveBeenCalledWith("aiAssistant");
    });

    it("is absent while a run streams, without a provider, and where the plugin is not loaded", async () => {
        build({ isStreaming: true });
        expect(await buildAiActionsMenuItem()).toBeNull();

        build({ isEnabled: false });
        expect(await buildAiActionsMenuItem()).toBeNull();

        build({ hasPlugin: false });
        expect(await buildAiActionsMenuItem()).toBeNull();
    });
});

describe("buildAiAssistantMenuItem", () => {
    const blocks = [ "first", "last" ] as unknown as ModelElement[];
    const blocksRange = { start: { before: "first" }, end: { after: "last" } };

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * An editor whose `blocks` have content or not, and whose assistant reports the opposite for
     * the selection. `log` records the selected ranges and what the rows run.
     */
    function blocksEditor(hasContent: boolean) {
        const log: unknown[] = [];
        const { editor, ui } = fakeEditor({
            domRoot: document.createElement("div"),
            hasContext: !hasContent
        });
        const model = {
            document: { version: 0 },
            createPositionBefore: (block: string) => ({ before: block }),
            createPositionAfter: (block: string) => ({ after: block }),
            createRange: (start: object, end: object) => ({ start, end }),
            hasContent: vi.fn(() => hasContent),
            change: (callback: (writer: object) => void) => callback({
                setSelection: (range: object) => log.push(range)
            })
        };
        editor.execute.mockImplementation((name: string) => log.push(name));
        ui.runQuickAction.mockImplementation((action: AiQuickAction) => log.push(action.id));
        ui.hide.mockImplementation(() => {
            ui.isOpen = false;
            log.push("hide");
        });
        const blocksEditor = Object.assign(editor, { model }) as unknown as CKTextEditor;
        const item = buildAiAssistantMenuItem(blocksEditor, "cke cke-trilium-ai", blocks);
        return { item: item as MenuCommandItem<string>, model, log, ui };
    }

    it("selects the blocks before a row runs, unless they changed since the menu opened", () => {
        const { item, model, log } = blocksEditor(true);
        const [ ask, fixTypos ] = commandItems(item.items ?? []);

        expect([ item.uiIcon, ask.title, fixTypos.title ])
            .toEqual([ "cke cke-trilium-ai", "ai_assistant.action_ask", "Fix typos" ]);
        ask.handler?.(ask, null as never);
        fixTypos.handler?.(fixTypos, null as never);
        expect(log).toEqual([ blocksRange, "aiAssistant", blocksRange, "fixTypos" ]);

        log.length = 0;
        model.document.version += 1;
        ask.handler?.(ask, null as never);
        expect(log).toEqual([ "aiAssistant" ]);
    });

    it("closes an open assistant before a row selects the blocks, so it starts on them", () => {
        const { item, log, ui } = blocksEditor(true);
        const [ ask, fixTypos ] = commandItems(item.items ?? []);

        ui.isOpen = true;
        ask.handler?.(ask, null as never);
        ui.isOpen = true;
        fixTypos.handler?.(fixTypos, null as never);
        expect(log)
            .toEqual([ "hide", blocksRange, "aiAssistant", "hide", blocksRange, "fixTypos" ]);
    });

    it("enables the quick actions that need content by the content of the blocks", () => {
        const isFixTyposEnabled = (hasContent: boolean) => {
            const { item, model } = blocksEditor(hasContent);
            expect(model.hasContent).toHaveBeenCalledWith(blocksRange);
            return commandItems(item.items ?? []).find((row) => row.title === "Fix typos")?.enabled;
        };

        expect([ isFixTyposEnabled(true), isFixTyposEnabled(false) ]).toEqual([ true, false ]);
    });
});

describe("buildSortSelectionMenuItem", () => {
    beforeEach(() => experimentalState.enabled.add("sortSelection"));
    afterEach(() => experimentalState.enabled.clear());

    /** An editor whose sort commands are enabled for `kind`, over `blockCount` selected blocks. */
    function sortEditor(kind: SortTargetKind | null = "blocks", blockCount = 2, isEnabled = true) {
        const editor = {
            commands: { get: () => ({ isEnabled, value: kind }) },
            model: {
                document: {
                    selection: { getSelectedBlocks: () => Array.from({ length: blockCount }) }
                }
            },
            editing: { view: { focus: vi.fn() } },
            execute: vi.fn()
        };
        return editor as typeof editor & CKTextEditor;
    }

    it("names the submenu after what it sorts, and sorts either way", () => {
        const titlesByKind = ([ "blocks", "listItems", "rows" ] as const).map((kind) =>
            (buildSortSelectionMenuItem(sortEditor(kind)) as MenuCommandItem<string>).title);
        expect(titlesByKind).toEqual([
            "sort_selection.sort_blocks",
            "sort_selection.sort_list_items",
            "sort_selection.sort_rows"
        ]);

        const editor = sortEditor();
        const item = buildSortSelectionMenuItem(editor) as MenuCommandItem<string>;
        const rows = commandItems(item.items ?? []);
        expect(rows.map((row) => row.title))
            .toEqual([ "sort_selection.ascending", "sort_selection.descending" ]);

        rows[1].handler?.(rows[1], null as never);
        expect(editor.execute).toHaveBeenCalledWith("triliumSortSelectionDescending");
        expect(editor.editing.view.focus).toHaveBeenCalled();
        rows[0].handler?.(rows[0], null as never);
        expect(editor.execute).toHaveBeenLastCalledWith("triliumSortSelectionAscending");

        expect(buildSortSelectionMenuItem(sortEditor("listItems"), { isRowsExcluded: true }))
            .toMatchObject({ title: "sort_selection.sort_list_items" });
    });

    it("is absent for one block, nothing to sort, excluded rows, no editor or feature", () => {
        expect(buildSortSelectionMenuItem(sortEditor("blocks", 1))).toBeNull();
        expect(buildSortSelectionMenuItem(sortEditor(null))).toBeNull();
        expect(buildSortSelectionMenuItem(sortEditor("rows", 2, false))).toBeNull();
        expect(buildSortSelectionMenuItem(sortEditor("rows"), { isRowsExcluded: true })).toBeNull();
        expect(buildSortSelectionMenuItem(null)).toBeNull();

        experimentalState.enabled.clear();
        expect(buildSortSelectionMenuItem(sortEditor())).toBeNull();
    });
});
