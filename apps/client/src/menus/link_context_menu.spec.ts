import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewScope } from "../services/link";
import type { ContextMenuEvent } from "./context_menu";

const mocks = vi.hoisted(() => ({
    show: vi.fn(),
    triggerCommand: vi.fn(),
    openContextWithNote: vi.fn(),
    isMobile: vi.fn(() => false),
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
    getTextEditorContaining: vi.fn(),
    getEmbedBoxSize: vi.fn()
}));

vi.mock("./text_editor_context_menu", () => ({
    getTextEditorContaining: mocks.getTextEditorContaining
}));

vi.mock("../services/content_renderer", () => ({ getEmbedBoxSize: mocks.getEmbedBoxSize }));

vi.mock("./context_menu", () => ({ default: { show: mocks.show } }));

vi.mock("../services/froca", () => ({
    default: { getAttachmentOfNote: mocks.getAttachmentOfNote, getNote: mocks.getNote }
}));

vi.mock("../services/attachment_actions", () => ({
    getAttachmentActionGroups: mocks.getAttachmentActionGroups
}));

vi.mock("../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../services/utils", () => ({
    default: { isDesktop: mocks.isDesktop },
    escapeHtml: (text: string) => text,
    isMobile: mocks.isMobile
}));

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

    it("ends with converting an attachment link to an embed, only in a note being edited", async () => {
        const execute = vi.fn();
        const attachment = { attachmentId: "att-1" };
        mocks.getAttachmentOfNote.mockResolvedValue(attachment);
        mocks.getEmbedBoxSize.mockReturnValue("small");
        mocks.getAttachmentActionGroups.mockReturnValue([
            [ { title: "Download", icon: "bx bx-download", run: vi.fn() } ]
        ]);
        mocks.getTextEditorContaining.mockResolvedValue({
            commands: { get: () => ({ isEnabled: true }) },
            plugins: { get: () => ({ canConvertLinkToEmbed: () => true }) },
            execute
        });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = `<a class="reference-link" href="#"><span>report.pdf</span></a>`;
        const link = editable.querySelector("a");

        const title = link?.querySelector("span") ?? undefined;
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(title), VIEW_SCOPE);

        const { items } = mocks.show.mock.calls[0][0];
        expect(items.slice(4)).toMatchObject([
            { kind: "separator" },
            { title: "Download" },
            { title: "link_context_menu.convert_link_to_embed" }
        ]);
        items.at(-1).handler();
        expect(mocks.getEmbedBoxSize).toHaveBeenCalledWith(attachment);
        expect(execute).toHaveBeenCalledWith("convertLinkToEmbed", {
            domElement: link,
            boxSize: "small"
        });

        editable.removeAttribute("contenteditable");
        const event = contextMenuEvent(link ?? undefined);
        await linkContextMenu.openContextMenu("root/n1", event, VIEW_SCOPE);
        expect(mocks.show.mock.calls[1][0].items).toHaveLength(6);
        expect(mocks.getTextEditorContaining).toHaveBeenCalledTimes(1);
    });

    it("ends with converting a note link to an embed, if the editor can convert it", async () => {
        const execute = vi.fn();
        const canConvertLinkToEmbed = vi.fn(() => true);
        const note = { noteId: "n1" };
        mocks.getNote.mockResolvedValue(note);
        mocks.getEmbedBoxSize.mockReturnValue("full");
        mocks.getTextEditorContaining.mockResolvedValue({
            commands: { get: () => ({ isEnabled: true }) },
            plugins: { get: () => ({ canConvertLinkToEmbed }) },
            execute
        });
        const editable = document.createElement("div");
        editable.className = "ck-editor__editable";
        editable.setAttribute("contenteditable", "true");
        editable.innerHTML = `<p><a class="reference-link" href="#root/n1">Note</a></p>`;
        const link = editable.querySelector("a");
        if (!link) return;

        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(link));
        expect(canConvertLinkToEmbed).toHaveBeenCalledWith(link);
        const { items } = mocks.show.mock.calls[0][0];
        expect(items.slice(4)).toMatchObject([
            { kind: "separator" },
            { title: "link_context_menu.convert_link_to_included_note", uiIcon: "bx bx-window-alt" }
        ]);
        items.at(-1).handler();
        expect(mocks.getNote).toHaveBeenCalledWith("n1");
        expect(mocks.getEmbedBoxSize).toHaveBeenCalledWith(note);
        expect(execute).toHaveBeenCalledWith("convertLinkToEmbed", {
            domElement: link,
            boxSize: "full"
        });

        // Such as one with a query, which names a part of the note.
        canConvertLinkToEmbed.mockReturnValue(false);
        await linkContextMenu.openContextMenu("root/n1", contextMenuEvent(link));
        expect(mocks.show.mock.calls[1][0].items).toHaveLength(4);
    });

    describe("opened on an embed in a note being edited", () => {
        const CHECK = "bx bx-check";
        const execute = vi.fn();
        const focus = vi.fn();
        const selectEmbedAt = vi.fn();
        let hasPlugin = true;
        let state: Record<string, unknown> | null;
        let editable: HTMLElement;

        beforeEach(() => {
            selectEmbedAt.mockReset().mockReturnValue(true);
            hasPlugin = true;
            state = {
                boxSize: "medium", isTitleShown: false, isTitleToggleable: true,
                hasCaption: true, isCaptionToggleable: true, isConvertibleToLink: true
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
                        getBoxSizes: () => [
                            { value: "tiny", label: "Tiny" },
                            { value: "medium", label: "Medium" }
                        ]
                    })
                },
                commands: { get: () => undefined },
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

        it("puts the commands of an embed after its first group, converting it last", async () => {
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
                        enabled: true,
                        trailingIcon: undefined
                    },
                    {
                        title: "link_context_menu.show_caption",
                        uiIcon: "bx bx-captions",
                        enabled: true,
                        trailingIcon: CHECK
                    },
                    { kind: "separator" },
                    { title: "Rename" },
                    { title: "link_context_menu.convert_embed_to_link", uiIcon: "bx bx-link" }
                ]);
                expect(items).toHaveLength(13);
            }
            expect(selectEmbedAt).not.toHaveBeenCalled();

            const items = await openOn(editable.querySelector("a"));
            expect(pick(items[7].items[0]))
                .toEqual([ [ "contentEmbedBoxSize", { value: "tiny" } ] ]);
            expect(pick(items[8])).toEqual([ [ "toggleContentEmbedTitle", undefined ] ]);
            expect(pick(items[9]))
                .toEqual([ [ "toggleContentEmbedCaption", { focusCaptionOnShow: true } ] ]);
            expect(pick(items[12])).toEqual([ [ "convertEmbedToLink", undefined ] ]);

            // An embed the editor cannot select is left as it is.
            selectEmbedAt.mockReturnValue(false);
            execute.mockClear();
            items[12].handler();
            expect(execute).not.toHaveBeenCalled();
        });

        it("offers Editable above the size, for content that has an editable mode", async () => {
            state = { ...state, isEditable: true, isEditableToggleable: true };
            const items = await openOn(editable.querySelector("a"));

            expect(items.slice(6, 9)).toMatchObject([
                { kind: "separator" },
                {
                    title: "link_context_menu.editable",
                    uiIcon: "bx bx-edit-alt",
                    trailingIcon: CHECK
                },
                { title: "link_context_menu.include_size" }
            ]);
            expect(items).toHaveLength(14);
            expect(pick(items[7])).toEqual([ [ "toggleContentEmbedEditable", undefined ] ]);

            state = { ...state, isEditable: false };
            expect((await openOn(editable.querySelector("a")))[7])
                .toMatchObject({ title: "link_context_menu.editable", trailingIcon: undefined });
        });

        it("appends the commands of an embedded note, its conversion in a group of its own", async () => {
            embed().removeAttribute("data-attachment-id");
            embed().setAttribute("data-note-id", "n1");

            const items = await openOn(editable.querySelector("a"), {});

            expect(items.slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title" },
                { title: "link_context_menu.show_caption" },
                { kind: "separator" },
                { title: "link_context_menu.convert_embed_to_link" }
            ]);
            expect(items).toHaveLength(10);
            expect(mocks.getAttachmentOfNote).not.toHaveBeenCalled();
        });

        it("disables what the embed cannot do, and offers nothing for no embed", async () => {
            embed().removeAttribute("data-attachment-id");
            state = {
                boxSize: "tiny", isTitleShown: true, isTitleToggleable: false,
                hasCaption: false, isCaptionToggleable: false, isConvertibleToLink: false
            };
            expect((await openOn(editable.querySelector("a"), {})).slice(4)).toMatchObject([
                { kind: "separator" },
                { title: "link_context_menu.include_size" },
                { title: "link_context_menu.show_title", enabled: false, trailingIcon: CHECK },
                { title: "link_context_menu.show_caption", enabled: false, trailingIcon: undefined }
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
