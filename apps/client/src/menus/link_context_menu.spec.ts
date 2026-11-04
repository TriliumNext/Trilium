import type { ToolbarGroupMenuItem } from "@triliumnext/ckeditor5";
import { EXTENDED_CODE_BLOCK_CLASS } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewScope } from "../services/link";
import type { ContextMenuEvent } from "./context_menu";
import centerIcon from "./icons/position-center.svg?raw";
import leftIcon from "./icons/position-left.svg?raw";
import rightIcon from "./icons/position-right.svg?raw";
import wrapLeftIcon from "./icons/position-wrap-left.svg?raw";
import wrapRightIcon from "./icons/position-wrap-right.svg?raw";

const mocks = vi.hoisted(() => ({
    show: vi.fn(),
    triggerCommand: vi.fn(),
    openContextWithNote: vi.fn(),
    isMobile: vi.fn(() => false),
    isShare: false,
    isDesktop: vi.fn(() => true),
    getClosestNtxId: vi.fn((): string | null => null),
    /** The splits of the active tab, which decide the "new split" vs "other split" wording. */
    subContexts: [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ] as { ntxId: string }[],
    activeNtxId: "ntx-active" as string | null,
    /** False when no tab is open at all, which leaves both the hoisting and the split unresolvable. */
    hasActiveContext: true,
    noteContexts: [] as { ntxId: string; isReadOnly: () => Promise<boolean> }[],
    getAttachmentOfNote: vi.fn(),
    getNote: vi.fn(),
    getAttachmentActionGroups: vi.fn(),
    getLinkedAttachmentActions: vi.fn(),
    getTextEditorContaining: vi.fn(),
    getEmbedBoxSize: vi.fn(),
    openUrlExternally: vi.fn(),
    downloadAttachment: vi.fn()
}));

vi.mock("./text_editor_context_menu", async (importOriginal) => ({
    ...await importOriginal<typeof import("./text_editor_context_menu")>(),
    getTextEditorContaining: mocks.getTextEditorContaining
}));
// `text_editor_context_menu` imports `options`, which fails against the partial `utils` mock.
vi.mock("../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: () => false
}));

vi.mock("../services/content_renderer", () => ({
    EXCERPT_BOX_SIZE: "full",
    getEmbedBoxSize: mocks.getEmbedBoxSize
}));

vi.mock("./context_menu", () => ({ default: { show: mocks.show } }));

vi.mock("../services/froca", () => ({
    default: { getAttachmentOfNote: mocks.getAttachmentOfNote, getNote: mocks.getNote }
}));

vi.mock("../services/attachment_actions", () => ({
    getAttachmentActionGroups: mocks.getAttachmentActionGroups,
    getLinkedAttachmentActions: mocks.getLinkedAttachmentActions
}));

vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../services/open", () => ({
    default: { downloadAttachment: mocks.downloadAttachment },
    openUrlExternally: mocks.openUrlExternally
}));

vi.mock("../services/utils", () => ({
    default: { isDesktop: mocks.isDesktop },
    escapeHtml: (text: string) => text,
    isMobile: mocks.isMobile,
    get isShare() {
        return mocks.isShare;
    }
}));
// `context_menu_utils` imports `tree`, whose imports fail against the partial mocks above.
vi.mock("../services/tree", () => ({ default: {}, NOTE_PATH_TITLE_SEPARATOR: " › " }));

vi.mock("../widgets/widget_utils", () => ({ getClosestNtxId: mocks.getClosestNtxId }));

vi.mock("../components/app_context", () => ({
    default: {
        triggerCommand: mocks.triggerCommand,
        tabManager: {
            get activeNtxId() {
                return mocks.activeNtxId;
            },
            openContextWithNote: mocks.openContextWithNote,
            getActiveContext: () => mocks.hasActiveContext
                ? { hoistedNoteId: "hoistedNote", getSubContexts: () => mocks.subContexts }
                : undefined,
            getNoteContextById: () => ({
                getMainContext: () => ({ getSubContexts: () => mocks.subContexts })
            }),
            getNoteContexts: () => mocks.noteContexts
        }
    }
}));

import { registerContentEmbedTools } from "../widgets/type_widgets/text/content_embed_tools";
import linkContextMenu from "./link_context_menu";

const VIEW_SCOPE = { viewMode: "attachments" as const, attachmentId: "att-1" };

function contextMenuEvent(target?: HTMLElement) {
    return { pageX: 12, pageY: 34, target } as unknown as ContextMenuEvent;
}

function handle(command: string | undefined, viewScope = {}, hoistedNoteId: string | null = null) {
    return linkContextMenu.handleLinkContextMenuItem(command, contextMenuEvent(), "root/n1", viewScope, hoistedNoteId);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile.mockReturnValue(false);
    mocks.isDesktop.mockReturnValue(true);
    mocks.getClosestNtxId.mockReturnValue(null);
    mocks.subContexts = [ { ntxId: "ntx-first" }, { ntxId: "ntx-last" } ];
    mocks.activeNtxId = "ntx-active";
    mocks.hasActiveContext = true;
    mocks.noteContexts = [];
    mocks.getAttachmentOfNote.mockResolvedValue(null);
});

describe("getItems", () => {
    it("offers the four ways of opening a link, the split one worded for the layout", () => {
        const items = linkContextMenu.getItems(contextMenuEvent());

        expect(items.map((item) => "command" in item && item.command)).toEqual([
            "openNoteInNewTab", "openNoteInNewSplit", "openNoteInNewWindow", "openNoteInPopup"
        ]);
        // On the desktop the split always opens beside the current one.
        expect(items[1]).toMatchObject({ title: "link_context_menu.open_note_in_new_split" });

        // On mobile a tab holds one split at a time, so with one already open the link goes to the
        // *other* split rather than to a new one.
        mocks.isMobile.mockReturnValue(true);
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_other_split" });

        mocks.subContexts = [ { ntxId: "ntx-only" } ];
        expect(linkContextMenu.getItems(contextMenuEvent())[1])
            .toMatchObject({ title: "link_context_menu.open_note_in_new_split" });
    });

    it("offers only a new tab and a new window on a shared page, which has no splits or popup", () => {
        mocks.isShare = true;
        try {
            expect(linkContextMenu.getItems(contextMenuEvent()).map((item) => "command" in item && item.command))
                .toEqual([ "openNoteInNewTab", "openNoteInNewWindow" ]);
        } finally {
            mocks.isShare = false;
        }
    });

    /** For a menu with entries of its own, which lists quick edit and folds the rest away. */
    it("folds the three places into one submenu, quick edit standing on its own", () => {
        const open = linkContextMenu.getOpenNoteItem(contextMenuEvent());

        // The entry acts as well as folding: picking it opens the note where it is opened most.
        expect(open).toMatchObject({
            title: "link_context_menu.open_note",
            command: "openNoteInNewTab"
        });
        expect("items" in open && open.items?.map((item) => "command" in item && item.command))
            .toEqual([ "openNoteInNewTab", "openNoteInNewSplit", "openNoteInNewWindow" ]);
        expect(linkContextMenu.getQuickEditItem()).toMatchObject({
            title: "link_context_menu.open_note_in_popup",
            command: "openNoteInPopup"
        });
    });
});

describe("handleLinkContextMenuItem", () => {
    it("opens the note's shared page in a browser tab or window on a shared page", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        mocks.isShare = true;
        linkContextMenu.setShareLinkResolver((noteId) => (noteId === "n1" ? "./first-note" : null));
        try {
            expect(handle("openNoteInNewTab")).toBe(true);
            expect(open).toHaveBeenLastCalledWith("./first-note", "_blank", "noopener");
            expect(handle("openNoteInNewWindow")).toBe(true);
            expect(open).toHaveBeenLastCalledWith("./first-note", "_blank", "noopener,popup");
            expect(mocks.openContextWithNote).not.toHaveBeenCalled();
            expect(mocks.triggerCommand).not.toHaveBeenCalled();

            // A note without a shared page has nowhere to be opened.
            open.mockClear();
            expect(linkContextMenu.handleLinkContextMenuItem("openNoteInNewTab", contextMenuEvent(), "root/n2")).toBe(false);
            expect(open).not.toHaveBeenCalled();
        } finally {
            mocks.isShare = false;
            linkContextMenu.setShareLinkResolver(undefined);
            open.mockRestore();
        }
    });

    it("opens a new tab under the given hoisting, falling back to the active context's", () => {
        expect(handle("openNoteInNewTab", VIEW_SCOPE, "explicitHoist")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: "explicitHoist",
            viewScope: VIEW_SCOPE,
            placement: "afterCurrent"
        });

        handle("openNoteInNewTab");
        expect(mocks.openContextWithNote).toHaveBeenLastCalledWith("root/n1", {
            hoistedNoteId: "hoistedNote",
            viewScope: {},
            placement: "afterCurrent"
        });
    });

    it("opens a split beside the last one, a window, and the popup — all carrying the view scope", () => {
        expect(handle("openNoteInNewSplit", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit", {
            ntxId: "ntx-last",
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        expect(handle("openNoteInNewWindow", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInWindow", {
            notePath: "root/n1",
            hoistedNoteId: "hoistedNote",
            viewScope: VIEW_SCOPE
        });

        // The view scope is what lets the popup show an attachment rather than its owning note.
        expect(handle("openNoteInPopup", VIEW_SCOPE)).toBe(true);
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });

    it("does nothing for a command it does not own, or a split with no context to open into", () => {
        expect(handle("someOtherCommand")).toBe(false);
        expect(handle(undefined)).toBe(false);

        // Nothing to resolve a context from: no pane under the pointer and no active tab either.
        mocks.isDesktop.mockReturnValue(false);
        mocks.activeNtxId = null;
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("opens with no hoisting, and no split at all, when there is no tab open", () => {
        mocks.hasActiveContext = false;

        expect(handle("openNoteInNewTab")).toBe(true);
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: null,
            viewScope: {},
            placement: "afterCurrent"
        });

        // On the desktop the split is resolved from that same missing tab.
        expect(handle("openNoteInNewSplit")).toBe(false);
        expect(mocks.triggerCommand).not.toHaveBeenCalled();
    });

    it("resolves the split from the event's own pane on mobile, and from the active tab otherwise", () => {
        mocks.isDesktop.mockReturnValue(false);
        mocks.getClosestNtxId.mockReturnValue("ntx-from-dom");
        const event = contextMenuEvent(document.createElement("div"));

        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-from-dom" }));

        // Outside any note-context DOM (e.g. the mobile sidebar) the active context stands in.
        mocks.getClosestNtxId.mockReturnValue(null);
        linkContextMenu.handleLinkContextMenuItem("openNoteInNewSplit", event, "root/n1");
        expect(mocks.triggerCommand).toHaveBeenLastCalledWith("openNewNoteSplit",
            expect.objectContaining({ ntxId: "ntx-active" }));
    });
});

describe("getLinkToolbarEntries", () => {
    /** Wraps an action as the editor's menu does, recording that it ran through it. */
    const run = vi.fn((action: () => void) => action);

    /** An entry as its label, marked `(off)`; a rule as `---`. */
    function labels(items: ToolbarGroupMenuItem[]) {
        return items.map((item) => (item.kind === "entry"
            ? `${item.label}${item.isEnabled ? "" : " (off)"}`
            : "---"));
    }

    function editableWith(html: string) {
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = html;
        return editable;
    }

    it("opens the note in the places of the context menu, from a link in the text", async () => {
        const editable = editableWith("<p><a href=\"#root/n1\">Note</a></p>");
        const { target, conversion } = await linkContextMenu.getLinkToolbarEntries(
            "root/n1", {}, editable, run);

        expect(labels(target)).toStrictEqual([
            "link_context_menu.open_note_in_new_tab", "link_context_menu.open_note_in_new_split",
            "link_context_menu.open_note_in_new_window", "link_context_menu.open_note_in_popup"
        ]);
        expect(target[0]).toMatchObject({ iconClass: "bx bx-link-external" });
        // Only a reference link converts into an embed.
        expect(conversion).toStrictEqual([]);

        const [ newTab ] = target;
        if (newTab.kind === "entry") newTab.run?.();
        expect(run).toHaveBeenCalled();
        expect(mocks.openContextWithNote).toHaveBeenCalledWith("root/n1", {
            hoistedNoteId: "hoistedNote", viewScope: {}, placement: "afterCurrent"
        });
    });

    it("lists the actions on an attachment, ending with converting the link, then it", async () => {
        const execute = vi.fn();
        mocks.getEmbedBoxSize.mockReturnValue("small");
        mocks.getTextEditorContaining.mockResolvedValue({
            commands: { get: () => ({ isEnabled: true }) },
            plugins: { get: () => ({ canConvertLinkToEmbed: () => true }) },
            execute
        });
        const editable = editableWith("<a class=\"reference-link\" href=\"#\">report.pdf</a>");
        const link = editable.querySelector("a");
        if (!link) return;

        const attachment = { attachmentId: "att-1" };
        const convertAttachment = vi.fn();
        mocks.getAttachmentOfNote.mockResolvedValue(attachment);
        mocks.getLinkedAttachmentActions.mockReturnValue({
            groups: [
                [ { title: "Download", icon: "bx bx-download", run: vi.fn() } ],
                [ { title: "Rename", icon: "bx bx-rename", disabledReason: "No", run: vi.fn() } ]
            ],
            conversion: { title: "Convert", icon: "bx bx-note", run: convertAttachment }
        });
        const { target, actions, conversion } = await linkContextMenu.getLinkToolbarEntries(
            "root/n1", VIEW_SCOPE, link, run);
        expect(mocks.getLinkedAttachmentActions)
            .toHaveBeenCalledWith(attachment, { isReadOnly: false });
        expect(target).toHaveLength(4);
        expect(actions.map(labels)).toStrictEqual([ [ "Download" ], [ "Rename (off)" ] ]);
        expect(labels(conversion))
            .toStrictEqual([ "link_context_menu.convert_link_to_embed", "Convert" ]);
        const [ convertLink, convert ] = conversion;
        if (convertLink.kind === "entry") convertLink.run?.();
        expect(execute).toHaveBeenCalledWith("convertLinkToEmbed", {
            domElement: link, boxSize: "small"
        });
        if (convert.kind === "entry") convert.run?.();
        expect(convertAttachment).toHaveBeenCalledOnce();

        // A link to an attachment deleted since, and a reference link to a note.
        mocks.getAttachmentOfNote.mockResolvedValue(null);
        const deleted = await linkContextMenu.getLinkToolbarEntries(
            "root/n1", VIEW_SCOPE, link, run);
        expect([ deleted.target.length, deleted.actions, deleted.conversion ])
            .toStrictEqual([ 4, [], [] ]);
        mocks.getNote.mockResolvedValue({ noteId: "n1" });
        const note = await linkContextMenu.getLinkToolbarEntries("root/n1", {}, link, run);
        expect(note.actions).toStrictEqual([]);
        expect(labels(note.conversion))
            .toStrictEqual([ "link_context_menu.convert_link_to_included_note" ]);
    });

    it("converts a reference link to an included note, or to an excerpt for blocks", async () => {
        const execute = vi.fn();
        mocks.getEmbedBoxSize.mockReturnValue("medium");
        mocks.getTextEditorContaining.mockResolvedValue({
            commands: { get: () => ({ isEnabled: true }) },
            plugins: { get: () => ({ canConvertLinkToEmbed: () => true }) },
            execute
        });
        const link = editableWith("<a class=\"reference-link\" href=\"#\">Note</a>")
            .querySelector("a");
        if (!link) throw new Error("Expected a link.");
        const note = { noteId: "n1" };
        mocks.getNote.mockResolvedValue(note);
        /** Runs the conversion of the link for `viewScope`, and returns its label. */
        const convert = async (viewScope: ViewScope) => {
            const [ entry ] = (await linkContextMenu.getLinkToolbarEntries(
                "root/n1", viewScope, link, run)).conversion;
            if (entry?.kind !== "entry") throw new Error("Expected a conversion.");
            entry.run?.();
            return entry.label;
        };

        expect(await convert({})).toBe("link_context_menu.convert_link_to_included_note");
        expect(mocks.getEmbedBoxSize).toHaveBeenCalledWith(note);
        expect(await convert({ block: "b1" }))
            .toBe("link_context_menu.convert_link_to_note_excerpt");
        expect(execute.mock.calls).toStrictEqual([
            [ "convertLinkToEmbed", { domElement: link, boxSize: "medium" } ],
            [ "convertLinkToEmbed", { domElement: link, boxSize: "full" } ]
        ]);

        // A note deleted since has nothing to embed.
        mocks.getNote.mockResolvedValue(null);
        const deleted = await linkContextMenu.getLinkToolbarEntries("root/n1", {}, link, run);
        expect(deleted.conversion).toStrictEqual([]);
    });
});

describe("downloadLinkedAttachment", () => {
    it("downloads the attachment a link points to, unless it is deleted", async () => {
        mocks.getAttachmentOfNote.mockResolvedValue({ attachmentId: "att-1" });
        await linkContextMenu.downloadLinkedAttachment("root/n1", VIEW_SCOPE);
        expect(mocks.getAttachmentOfNote).toHaveBeenCalledWith("n1", "att-1");
        expect(mocks.downloadAttachment).toHaveBeenCalledExactlyOnceWith("att-1");

        mocks.downloadAttachment.mockClear();
        mocks.getAttachmentOfNote.mockResolvedValue(null);
        await linkContextMenu.downloadLinkedAttachment("root/n1", VIEW_SCOPE);
        await linkContextMenu.downloadLinkedAttachment("root/n1", {});
        expect(mocks.getAttachmentOfNote).toHaveBeenCalledTimes(2);
        expect(mocks.downloadAttachment).not.toHaveBeenCalled();
    });
});

describe("getOriginBelow", () => {
    it("opens a menu below the anchor, from the anchor or from another element", () => {
        const anchor = document.createElement("button");
        anchor.getBoundingClientRect = () => ({ left: 40, bottom: 70 }) as DOMRect;
        const embed = document.createElement("figure");
        const below = { pageX: 40 + window.scrollX, pageY: 70 + window.scrollY };

        expect(linkContextMenu.getOriginBelow(anchor)).toEqual({ ...below, target: anchor });
        expect(linkContextMenu.getOriginBelow(anchor, embed))
            .toEqual({ ...below, target: embed });
    });
});

describe("openContextMenu", () => {
    it("shows the menu at the pointer and routes the choice with the link's state", async () => {
        const event = contextMenuEvent();
        await linkContextMenu.openContextMenu("root/n1", event, VIEW_SCOPE, "explicitHoist");

        const shown = mocks.show.mock.calls[0][0];
        expect(shown).toMatchObject({ x: 12, y: 34 });
        expect(shown.items).toHaveLength(4);

        shown.selectMenuItemHandler({ command: "openNoteInPopup" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n1",
            viewScope: VIEW_SCOPE
        });
    });

    it("appends the actions on a linked attachment, each group after a separator", async () => {
        const attachment = { attachmentId: "att-1" };
        const download = vi.fn();
        mocks.getAttachmentOfNote.mockResolvedValue(attachment);
        mocks.getAttachmentActionGroups.mockReturnValue([
            [ { title: "Download", icon: "bx bx-download", run: download } ],
            [ {
                title: "Open custom",
                icon: "bx bx-customize",
                disabledReason: "Desktop only",
                run: vi.fn()
            } ]
        ]);

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);

        expect(mocks.getAttachmentOfNote).toHaveBeenCalledWith("n1", "att-1");
        expect(mocks.getAttachmentActionGroups).toHaveBeenCalledWith(attachment, {
            isReadOnly: false
        });
        const { items } = mocks.show.mock.calls[0][0];
        expect(items.slice(4)).toMatchObject([
            { kind: "separator" },
            { title: "Download", uiIcon: "bx bx-download", enabled: true },
            { kind: "separator" },
            { title: "Open custom", uiIcon: "bx bx-customize", enabled: false }
        ]);

        items[5].handler();
        expect(download).toHaveBeenCalledOnce();
    });

    it("asks for the actions of a read-only note in a pane showing one", async () => {
        const attachment = { attachmentId: "att-1" };
        mocks.getAttachmentOfNote.mockResolvedValue(attachment);
        mocks.getAttachmentActionGroups.mockReturnValue([]);
        mocks.noteContexts = [
            { ntxId: "ntx-read-only", isReadOnly: async () => true },
            { ntxId: "ntx-editable", isReadOnly: async () => false }
        ];
        const event = contextMenuEvent(document.createElement("div"));

        for (const ntxId of [ "ntx-read-only", "ntx-editable", null ]) {
            mocks.getClosestNtxId.mockReturnValue(ntxId);
            await linkContextMenu.openContextMenu("root/n1", event, VIEW_SCOPE);
        }

        expect(mocks.getAttachmentActionGroups.mock.calls).toEqual([
            [ attachment, { isReadOnly: true } ],
            [ attachment, { isReadOnly: false } ],
            [ attachment, { isReadOnly: false } ]
        ]);
    });

    describe("opened on an embed in a note being edited", () => {
        const CHECK = "bx bx-check";
        const execute = vi.fn();
        const focus = vi.fn();
        const copy = vi.fn();
        const selectEmbedAt = vi.fn();
        let hasPlugin = true;
        let state: Record<string, unknown> | null;
        const getBoxSizes = vi.fn(() => [
            { value: "tiny", label: "Tiny" },
            { value: "medium", label: "Medium" }
        ]);
        const getDisplayModes = () => [
            { value: "textLink", label: "Text" },
            { value: "cardLink", label: "Card" },
            { value: "embedLink", label: "Embed" }
        ];
        let editable: HTMLElement;

        beforeEach(() => {
            selectEmbedAt.mockReset().mockReturnValue(true);
            hasPlugin = true;
            state = {
                boxSize: "medium", isTitleSupported: true, isTitleShown: false,
                isTitleToggleable: true, isCaptionSupported: true, hasCaption: true,
                isCaptionToggleable: true, isConvertibleToLink: true
            };
            mocks.getAttachmentOfNote.mockResolvedValue({ attachmentId: "att-1" });
            mocks.getAttachmentActionGroups.mockReturnValue([
                [ { title: "Download", icon: "bx bx-download", run: vi.fn() } ],
                [ { title: "Rename", icon: "bx bx-rename", run: vi.fn() } ]
            ]);
            mocks.getTextEditorContaining.mockResolvedValue({
                plugins: {
                    has: () => hasPlugin,
                    get: () => ({
                        selectEmbedAt,
                        getEmbedStateAt: () => state,
                        getBoxSizes,
                        getDisplayModes
                    })
                },
                commands: { get: () => undefined },
                config: { get: (name: string) => (name === "clipboard" ? { copy } : undefined) },
                execute,
                editing: { view: { focus } }
            });
            editable = document.createElement("div");
            editable.className = "ck-editor__editable";
            editable.setAttribute("contenteditable", "true");
            editable.innerHTML = `<figure class="include-note" data-attachment-id="att-1">`
                + `<div class="include-note-title-row">`
                + `<h4 class="include-note-title"><span><a href="#">report.pdf</a></span></h4>`
                + `<button class="include-note-menu"></button></div>`
                + `<div class="include-note-content"><a class="reference-link" href="#">x</a></div>`
                + `</figure>`;
        });

        function embed() {
            const figure = editable.querySelector<HTMLElement>("figure");
            if (!figure) throw new Error("Expected an embed.");
            return figure;
        }

        /** Opens the menu from `target`, as right-clicking the title link does by default. */
        async function openOn(target: Element | null, viewScope: ViewScope = VIEW_SCOPE) {
            await linkContextMenu.openContextMenu(
                "root/n1", contextMenuEvent((target ?? undefined) as HTMLElement | undefined),
                viewScope
            );
            return mocks.show.mock.lastCall?.[0].items;
        }

        /** Picks `item`, and returns what it ran on the editor. */
        function pick(item: { handler: () => void }) {
            execute.mockClear();
            focus.mockClear();
            selectEmbedAt.mockClear();
            item.handler();
            expect(selectEmbedAt).toHaveBeenCalledWith(embed());
            expect(focus).toHaveBeenCalledOnce();
            return execute.mock.calls;
        }

        it("puts an embed's commands after its first group, converting it last", async () => {
            // From the title, from the menu button beside it, and from a control acting on the
            // whole embed, as its toolbar does.
            for (const target of [ "a", "button.include-note-menu", "figure" ]) {
                const items = await openOn(editable.querySelector(target));

                expect(items.slice(4), target).toMatchObject([
                    { kind: "separator" },
                    { title: "Download" },
                    { kind: "separator" },
                    {
                        title: "link_context_menu.include_size",
                        uiIcon: "bx bx-expand-vertical",
                        items: [
                            { title: "Tiny", trailingIcon: undefined },
                            { title: "Medium", trailingIcon: CHECK }
                        ]
                    },
                    {
                        title: "link_context_menu.show_title",
                        uiIcon: "bx bx-window-alt",
                        isSwitch: true,
                        enabled: true,
                        checked: false
                    },
                    {
                        title: "link_context_menu.show_caption",
                        uiIcon: "bx bx-captions",
                        isSwitch: true,
                        enabled: true,
                        checked: true
                    },
                    { kind: "separator" },
                    { title: "Rename" },
                    { kind: "separator" },
                    {
                        title: "link_context_menu.delete",
                        uiIcon: "bx bx-trash destructive-action-icon"
                    },
                    { title: "link_context_menu.convert_embed_to_link", uiIcon: "bx bx-link" }
                ]);
                expect(items).toHaveLength(15);
            }
            expect(selectEmbedAt).not.toHaveBeenCalled();

            const items = await openOn(editable.querySelector("a"));
            expect(pick(items[7].items[0]))
                .toEqual([ [ "contentEmbedBoxSize", { value: "tiny" } ] ]);
            expect(getBoxSizes).toHaveBeenLastCalledWith(embed());
            expect(pick(items[8])).toEqual([ [ "toggleContentEmbedTitle", undefined ] ]);
            expect(pick(items[9]))
                .toEqual([ [ "toggleContentEmbedCaption", { focusCaptionOnShow: true } ] ]);
            expect(pick(items[13])).toEqual([ [ "deleteContentEmbed", undefined ] ]);
            expect(pick(items[14])).toEqual([ [ "convertEmbedToLink", undefined ] ]);

            // An embed the editor cannot select is left as it is.
            selectEmbedAt.mockReturnValue(false);
            execute.mockClear();
            items[14].handler();
            expect(execute).not.toHaveBeenCalled();

            // An embed that cannot turn into a link ends with Delete.
            state = { ...state, isConvertibleToLink: false };
            expect((await openOn(editable.querySelector("a"))).slice(-3)).toMatchObject([
                { title: "Rename" },
                { kind: "separator" },
                { title: "link_context_menu.delete" }
            ]);
        });

        it("offers Editable above the size, for content that has an editable mode", async () => {
            state = { ...state, isEditable: true, isEditableToggleable: true };
            const items = await openOn(editable.querySelector("a"));

            expect(items.slice(6, 9)).toMatchObject([
                { kind: "separator" },
                {
                    title: "link_context_menu.editable",
                    uiIcon: "bx bx-edit-alt",
                    isSwitch: true,
                    checked: true
                },
                { title: "link_context_menu.include_size" }
            ]);
            expect(items).toHaveLength(16);
            expect(pick(items[7])).toEqual([ [ "toggleContentEmbedEditable", undefined ] ]);

            state = { ...state, isEditable: false };
            expect((await openOn(editable.querySelector("a")))[7])
                .toMatchObject({ title: "link_context_menu.editable", checked: false });
        });

        it("offers the display modes above the size, for content that has them", async () => {
            state = { ...state, displayMode: "source" };
            const items = await openOn(editable.querySelector("a"));

            expect(items.slice(6, 12)).toMatchObject([
                { kind: "separator" },
                { title: "display_mode.source", uiIcon: "bx bx-code", checked: true },
                { title: "display_mode.split", uiIcon: "bx bxs-dock-left", checked: false },
                { title: "display_mode.preview", uiIcon: "bx bx-show", checked: false },
                { kind: "separator" },
                { title: "link_context_menu.include_size" }
            ]);
            expect(items).toHaveLength(19);
            expect(pick(items[9]))
                .toEqual([ [ "contentEmbedDisplayMode", { value: "preview" } ] ]);

            // After Editable, which comes first.
            state = { ...state, isEditableToggleable: true };
            expect((await openOn(editable.querySelector("a"))).slice(7, 12)).toMatchObject([
                { title: "link_context_menu.editable" },
                { title: "display_mode.source" },
                { title: "display_mode.split" },
                { title: "display_mode.preview" },
                { kind: "separator" }
            ]);
        });

        it("offers the positions after the size, for content that has them", async () => {
            state = { ...state, position: "wrap-left" };
            const items = await openOn(editable.querySelector("a"));
            const option = (key: string, icon: string, svg: string, checked = false) => ({
                title: `link_context_menu.${key}`, uiIcon: `cke cke-object-${icon}`, uiIconSvg: svg,
                checked
            });
            const tiles = (...options: ReturnType<typeof option>[]) => ({
                kind: "actions",
                className: "tn-menu-tiles tn-menu-actions-cards embed-position-tiles",
                items: options
            });

            expect(items.slice(7, 9)).toMatchObject([
                { title: "link_context_menu.include_size" },
                {
                    title: "link_context_menu.include_position",
                    uiIcon: "cke cke-object-inline-left",
                    enabled: true,
                    items: [
                        { kind: "header", title: "link_context_menu.break_text" },
                        tiles(
                            option("align_left", "left", leftIcon),
                            option("align_center", "center", centerIcon),
                            option("align_right", "right", rightIcon)
                        ),
                        { kind: "header", title: "link_context_menu.wrap_text" },
                        tiles(
                            option("align_left", "inline-left", wrapLeftIcon, true),
                            option("align_right", "inline-right", wrapRightIcon)
                        )
                    ]
                }
            ]);
            expect(new Set([ leftIcon, centerIcon, rightIcon, wrapLeftIcon, wrapRightIcon ]).size)
                .toBe(5);
            expect(items).toHaveLength(16);
            expect(items[8].items).toHaveLength(4);
            expect(items[8].items[1].items).toHaveLength(3);
            expect(items[8].items[3].items).toHaveLength(2);
            expect(pick(items[8].items[1].items[1]))
                .toEqual([ [ "contentEmbedPosition", { value: "center" } ] ]);
            expect(pick(items[8].items[3].items[1]))
                .toEqual([ [ "contentEmbedPosition", { value: "wrap-right" } ] ]);
        });

        it("offers the items of its content after Editable, in a group of their own", async () => {
            state = { ...state, isEditable: true, isEditableToggleable: true };
            const content = embed().querySelector<HTMLElement>(".include-note-content");
            if (!content) throw new Error("Expected the content box.");
            const wrap = { title: "Word wrap", items: [] };
            const lineNumbers = { title: "Show line numbers", checked: true };
            const unregister = registerContentEmbedTools(content, {
                getTools: () => [],
                execute: () => {},
                subscribe: () => () => {},
                getMenuItems: () => [ wrap, lineNumbers ]
            });

            try {
                expect((await openOn(editable.querySelector("a"))).slice(6, 12)).toMatchObject([
                    { kind: "separator" },
                    { title: "link_context_menu.editable" },
                    wrap,
                    lineNumbers,
                    { kind: "separator" },
                    { title: "link_context_menu.include_size" }
                ]);

                // Before the display modes, which follow in a group of their own.
                state = { ...state, displayMode: "split" };
                expect((await openOn(editable.querySelector("a"))).slice(9, 16)).toMatchObject([
                    lineNumbers,
                    { kind: "separator" },
                    { title: "display_mode.source" },
                    { title: "display_mode.split" },
                    { title: "display_mode.preview" },
                    { kind: "separator" },
                    { title: "link_context_menu.include_size" }
                ]);
            } finally {
                unregister();
            }
        });

        it("ends the menu of an embedded note with deleting and converting it", async () => {
            embed().removeAttribute("data-attachment-id");
            embed().setAttribute("data-note-id", "n1");

            const items = await openOn(editable.querySelector("a"), {});

            expect(items.slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title" },
                { title: "link_context_menu.show_caption" },
                { kind: "separator" },
                { title: "link_context_menu.delete" },
                { title: "link_context_menu.convert_embed_to_link" }
            ]);
            expect(items).toHaveLength(11);
            expect(pick(items[9])).toEqual([ [ "deleteContentEmbed", undefined ] ]);
            expect(pick(items[10])).toEqual([ [ "convertEmbedToLink", undefined ] ]);
            expect(mocks.getAttachmentOfNote).not.toHaveBeenCalled();
        });

        it("leaves out the title and the caption of an embed that has none", async () => {
            embed().removeAttribute("data-attachment-id");
            state = {
                ...state, isTitleSupported: true, isCaptionSupported: false,
                position: "center", isConvertibleToLink: false
            };
            expect((await openOn(editable.querySelector("a"), {})).slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.include_position" },
                { title: "link_context_menu.show_title", enabled: true, checked: false },
                { kind: "separator" },
                { title: "link_context_menu.delete" }
            ]);

            state = { ...state, isTitleSupported: false };
            const items = await openOn(editable.querySelector("a"), {});
            expect(items.slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.include_position" },
                { kind: "separator" },
                { title: "link_context_menu.delete" }
            ]);
            expect(items).toHaveLength(9);
        });

        it("heads the menu of a video with the entries of a link preview", async () => {
            const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
            state = {
                ...state, url, isCaptionSupported: true, isCaptionToggleable: true,
                hasCaption: false, isConvertibleToLink: false
            };
            const openMenu = async () => {
                await linkContextMenu.openEmbedContextMenu(contextMenuEvent(embed()));
                return mocks.show.mock.lastCall?.[0].items;
            };

            const items = await openMenu();
            expect(items).toMatchObject([
                { title: "link_context_menu.open_externally", uiIcon: "bx bx-link-external" },
                { kind: "separator" },
                { title: "link_context_menu.copy_url", uiIcon: "cke cke-trilium-copy" },
                { kind: "separator" },
                {
                    title: "link_context_menu.display_as",
                    uiIcon: "cke cke-trilium-link-preview",
                    items: [
                        { title: "Text", trailingIcon: undefined },
                        { title: "Card", trailingIcon: undefined },
                        { title: "Embed", trailingIcon: CHECK }
                    ]
                },
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title" },
                { title: "link_context_menu.show_caption", enabled: true, checked: false },
                { kind: "separator" },
                {
                    title: "link_context_menu.delete",
                    uiIcon: "bx bx-trash destructive-action-icon"
                }
            ]);
            expect(items).toHaveLength(11);
            items[0].handler();
            expect(mocks.openUrlExternally).toHaveBeenCalledExactlyOnceWith(url);
            items[2].handler();
            expect(copy).toHaveBeenCalledExactlyOnceWith(url);
            expect(pick(items[4].items[1]))
                .toEqual([ [ "changeLinkDisplay", { value: "cardLink" } ] ]);
            expect(pick(items[10])).toEqual([ [ "deleteContentEmbed", undefined ] ]);

            // An embed of a source has neither, nor a caption.
            state = { ...state, url: null, isCaptionSupported: false };
            expect(await openMenu()).toMatchObject([
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title" }
            ]);
        });

        it("deletes an extended code block last, after its position", async () => {
            embed().removeAttribute("data-attachment-id");
            embed().classList.add(EXTENDED_CODE_BLOCK_CLASS);
            state = {
                ...state, url: null, position: "right", isTitleSupported: false,
                isCaptionSupported: false, isConvertibleToLink: false
            };

            await linkContextMenu.openEmbedContextMenu(contextMenuEvent(embed()));
            const items = mocks.show.mock.lastCall?.[0].items;
            expect(items).toMatchObject([
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.include_position", uiIcon: "cke cke-object-right" },
                { kind: "separator" },
                {
                    title: "link_context_menu.delete",
                    uiIcon: "bx bx-trash destructive-action-icon"
                }
            ]);
            expect(items).toHaveLength(4);
            expect(pick(items[3])).toEqual([ [ "deleteContentEmbed", undefined ] ]);
        });

        it("opens no menu of an embed off one, or once a later menu opened", async () => {
            const first = linkContextMenu.openEmbedContextMenu(contextMenuEvent(embed()));
            await linkContextMenu.openContextMenu("root/n2", contextMenuEvent());
            await first;
            expect(mocks.show).toHaveBeenCalledOnce();

            // Outside a note being edited, and on an embed the editor does not know.
            await linkContextMenu.openEmbedContextMenu(contextMenuEvent());
            state = null;
            await linkContextMenu.openEmbedContextMenu(contextMenuEvent(embed()));
            expect(mocks.show).toHaveBeenCalledOnce();
        });

        it("disables what the embed cannot do, and offers nothing for no embed", async () => {
            embed().removeAttribute("data-attachment-id");
            state = {
                boxSize: "tiny", isTitleSupported: true, isTitleShown: true,
                isTitleToggleable: false, isCaptionSupported: true, hasCaption: false,
                isCaptionToggleable: false, isConvertibleToLink: false
            };
            expect((await openOn(editable.querySelector("a"), {})).slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title", enabled: false, checked: true },
                { title: "link_context_menu.show_caption", enabled: false, checked: false },
                { kind: "separator" },
                { title: "link_context_menu.delete" }
            ]);

            // A link in the embedded content, an embed the editor does not know, and an editor
            // without embeds.
            expect(await openOn(editable.querySelector(".include-note-content a"), {}))
                .toHaveLength(4);
            state = null;
            expect(await openOn(editable.querySelector("a"), {})).toHaveLength(4);
            hasPlugin = false;
            expect(await openOn(editable.querySelector("a"), {})).toHaveLength(4);
            expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(4);

            // A read-only note is not looked up in the editor at all.
            editable.removeAttribute("contenteditable");
            expect(await openOn(editable.querySelector("a"), {})).toHaveLength(4);
            expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(4);
            expect(selectEmbedAt).not.toHaveBeenCalled();
        });
    });

    it("keeps the text editor it opens from focused while it is up", async () => {
        const focusTracker = { add: vi.fn(), remove: vi.fn() };
        mocks.getTextEditorContaining.mockResolvedValue({ ui: { focusTracker } });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = `<div class="include-note-title-row"><button></button></div>`;
        const button = editable.querySelector("button") ?? undefined;

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(button));

        const shown = mocks.show.mock.calls[0][0];
        const container = document.createElement("div");
        shown.onShow(container);
        expect(focusTracker.add).toHaveBeenCalledWith(container);
        expect(focusTracker.remove).not.toHaveBeenCalled();
        shown.onHide();
        expect(focusTracker.remove).toHaveBeenCalledWith(container);

        // A note shown read-only has no editor to keep focused.
        editable.removeAttribute("contenteditable");
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(button));
        expect(mocks.show.mock.calls[1][0]).not.toHaveProperty("onShow");
        expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(1);
    });

    it("adds nothing for a link to a note, or to an attachment that no longer exists", async () => {
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent());
        expect(mocks.getAttachmentOfNote).not.toHaveBeenCalled();

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);
        expect(mocks.getAttachmentOfNote).toHaveBeenCalledWith("n1", "att-1");

        expect(mocks.show.mock.calls.map(([ shown ]) => shown.items.length)).toEqual([ 4, 4 ]);
        expect(mocks.getAttachmentActionGroups).not.toHaveBeenCalled();
    });

    it("drops a menu whose attachment loads after a later menu opened", async () => {
        let resolveAttachment: (value: unknown) => void = () => {};
        mocks.getAttachmentOfNote.mockReturnValue(new Promise((resolve) => {
            resolveAttachment = resolve;
        }));
        mocks.getAttachmentActionGroups.mockReturnValue([]);

        const first = linkContextMenu.openContextMenu("root/n1", contextMenuEvent(), VIEW_SCOPE);
        await linkContextMenu.openContextMenu("root/n2", contextMenuEvent());
        resolveAttachment({ attachmentId: "att-1" });
        await first;

        expect(mocks.show).toHaveBeenCalledOnce();
        mocks.show.mock.calls[0][0].selectMenuItemHandler({ command: "openNoteInPopup" });
        expect(mocks.triggerCommand).toHaveBeenCalledWith("openInPopup", {
            noteIdOrPath: "root/n2",
            viewScope: {}
        });
    });
});
