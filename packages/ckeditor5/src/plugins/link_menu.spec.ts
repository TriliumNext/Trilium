import {
    _getModelData as getModelData, _setModelData as setModelData, type ButtonView,
    Bookmark, type ClassicEditor, ContextualBalloon, type DropdownView, env, Essentials, Link,
    LinkUI, Paragraph, type View, WidgetToolbarRepository
} from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import CopyLinkUrlButton from "./copy_link_url.js";
import { CHANGE_LINK_DISPLAY_COMMAND } from "./link_embed/link_embed.js";
import LinkEmbedToolbar from "./link_embed/link_embed_toolbar.js";
import LinkMenu, { LINK_TOOLBAR, type LinkMenuHost } from "./link_menu.js";
import ToolbarGroupMenu, {
    type ToolbarGroupMenuItem, type ToolbarGroupMenuRequest
} from "./toolbar_group_menu.js";

const URL = "https://example.com/page";
const NOTE = "#root/abc";
const IN_WEB_LINK = `<paragraph><$text linkHref="${URL}">fo[]o</$text></paragraph>`;
const IN_NOTE_LINK = `<paragraph><$text linkHref="${NOTE}">fo[]o</$text></paragraph>`;
const ON_REFERENCE = `<paragraph>a [<reference href="${NOTE}"></reference>] b</paragraph>`;
const ATTACHMENT = "#root/abc?viewMode=attachments&attachmentId=def";
/** `ATTACHMENT`, escaped for the model data of `_setModelData()`. */
const ATTACHMENT_DATA = ATTACHMENT.replaceAll("&", "&amp;");
const IN_ATTACHMENT_LINK =
    `<paragraph><$text linkHref="${ATTACHMENT_DATA}">fo[]o</$text></paragraph>`;

describe("LinkMenu", () => {
    let copy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        copy = vi.fn();
    });

    /**
     * An editor with `linkMenu` and `unlinkWithoutMenu` in its toolbar, the menu drawn by a host,
     * and `open()`, which returns the entries the host is handed for the menu.
     */
    async function createMenuEditor(extraConfig: Record<string, unknown> = {}) {
        const requests: ToolbarGroupMenuRequest[] = [];
        const host = {
            show: vi.fn((request: ToolbarGroupMenuRequest) => requests.push(request)),
            hide: vi.fn(),
            destroy: vi.fn()
        };
        const editor = await createTestEditor(
            [ Essentials, Paragraph, Link, LinkMenu, ToolbarGroupMenu ],
            {
                toolbar: [ "linkMenu", "unlinkWithoutMenu" ],
                clipboard: { copy },
                referenceLink: { getTitle: async () => "Target", getTitleSync: () => "Target" },
                toolbarGroupMenu: { host: () => host },
                ...extraConfig
            } as unknown as Parameters<typeof createTestEditor>[1]
        );
        const [ menu, unlink ] =
            [ ...editor.ui.view.toolbar.items ] as [ DropdownView, ButtonView ];
        const open = async () => {
            const shown = requests.length;
            menu.buttonView.fire("open");
            // The menu of a link to a note waits for the entries of the host.
            await new Promise((resolve) => setTimeout(resolve));
            const request = requests.at(-1);
            if (!request || requests.length === shown) {
                throw new Error("The host was asked to show no menu.");
            }
            // Closed again, so the next press opens a fresh menu rather than closing this one.
            request.onClose(false);
            return request.items;
        };
        /**
         * Right-clicks `element` at (30, 40), and returns whether the editor took the click, and
         * the request of the menu it had the host show for it.
         */
        const rightClick = async (
            element: Element | null | undefined, init: MouseEventInit = {}
        ) => {
            if (!element) {
                throw new Error("There is nothing to right-click.");
            }
            const shown = requests.length;
            const event = new MouseEvent("contextmenu", {
                bubbles: true, cancelable: true, clientX: 30, clientY: 40, ...init
            });
            element.dispatchEvent(event);
            // The menu of a link to a note waits for the entries of the host.
            await new Promise((resolve) => setTimeout(resolve));
            return {
                isTaken: event.defaultPrevented,
                request: requests.length > shown ? requests.at(-1) : undefined
            };
        };
        return { editor, menu, unlink, open, rightClick };
    }

    /** The element of the editing view that `selector` matches. */
    function find(editor: ClassicEditor, selector: string) {
        return editor.editing.view.getDomRoot()?.querySelector(selector);
    }

    /** An entry as its label, marked `(on)` and `(off)`, with its submenu; a rule as `---`. */
    function describeEntries(items: ToolbarGroupMenuItem[]): unknown[] {
        return items.map((item) => {
            if (item.kind !== "entry") {
                return "---";
            }
            const on = item.isOn ? " (on)" : "";
            const label = `${item.label}${on}${item.isEnabled ? "" : " (off)"}`;
            return item.children ? [ label, describeEntries(item.children) ] : label;
        });
    }

    /** Runs the entry that `path` names, a label per submenu. */
    function run(items: ToolbarGroupMenuItem[], ...path: string[]) {
        let found: ToolbarGroupMenuItem | undefined;
        for (const label of path) {
            found = items.find((item) => item.kind === "entry" && item.label === label);
            items = found?.kind === "entry" ? found.children ?? [] : [];
        }
        if (found?.kind !== "entry" || !found.run) {
            throw new Error(`No "${path.join(" › ")}" entry to run.`);
        }
        found.run();
    }

    describe("on a link to a web page", () => {
        it("holds the actions of a link preview, its display modes and Unlink", async () => {
            const { editor, menu, unlink, open } = await createMenuEditor();
            const selectMention = (url: string) => setModelData(editor.model,
                `<paragraph>[<linkMention url="${url}" title="T"></linkMention>]</paragraph>`);
            selectMention(URL);

            // A button of its own, as the menu of a content embed has, without a dropdown arrow.
            expect(menu.buttonView.element?.classList.contains("ck-button")).toBe(true);
            expect(menu.element?.querySelector(".ck-dropdown__arrow")).toBeNull();
            expect(menu.class).toBe("");
            expect(unlink.isVisible).toBe(false);
            const entries = await open();
            expect(describeEntries(entries)).toStrictEqual([
                "Open link", "Edit link", "---", "Copy address (URL)", "---",
                [ "Display as", [ "Text", "Icon & text (on)", "Card" ] ], "---", "Unlink"
            ]);
            expect(entries.filter((entry) => entry.kind === "entry" && entry.isDestructive))
                .toMatchObject([ { label: "Unlink" } ]);

            const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
            run(await open(), "Open link");
            expect(windowOpen)
                .toHaveBeenCalledExactlyOnceWith(URL, "_blank", "noopener,noreferrer");
            run(await open(), "Copy address (URL)");
            expect(copy).toHaveBeenCalledExactlyOnceWith(URL);

            const execute = vi.spyOn(editor, "execute");
            run(await open(), "Display as", "Card");
            expect(execute)
                .toHaveBeenCalledWith(CHANGE_LINK_DISPLAY_COMMAND, { value: "cardLink" });

            selectMention(URL);
            run(await open(), "Unlink");
            expect(editor.getData()).toBe(`<p>${URL}</p>`);

            // A preview of an address the editor never links to can still be unlinked.
            selectMention("javascript:alert(1)");
            expect(describeEntries(await open())).toStrictEqual([
                "Open link (off)", "Edit link", "---", "Copy address (URL) (off)", "---",
                [ "Display as", [ "Text", "Icon & text (on)", "Card" ] ], "---", "Unlink"
            ]);
        });

        it("acts on a link in the text, whose toolbar has no Unlink", async () => {
            const { editor, menu, unlink, open } = await createMenuEditor({
                linkEmbed: { detectEmbedType: () => "youtube" }
            });
            setModelData(editor.model, IN_WEB_LINK);

            expect(menu.class).toBe("");
            expect(unlink.isVisible).toBe(false);
            expect(describeEntries(await open())).toStrictEqual([
                "Open link", "Edit link", "---", "Copy address (URL)", "---",
                [ "Display as", [ "Text (on)", "Icon & text", "Card", "Embed" ] ], "---", "Unlink"
            ]);
            run(await open(), "Copy address (URL)");
            expect(copy).toHaveBeenCalledExactlyOnceWith(URL);
            run(await open(), "Unlink");
            expect(editor.getData()).toBe("<p>foo</p>");

            // A link to neither a web page nor a note keeps the Unlink button, and has no menu.
            setModelData(editor.model,
                "<paragraph><$text linkHref=\"mailto:a@b.c\">fo[]o</$text></paragraph>");
            expect(menu.class).toBe("ck-hidden");
            expect(unlink.isVisible).toBe(true);
            unlink.fire("execute");
            expect(editor.getData()).toBe("<p>foo</p>");
        });

        it("opens the link dialog from Edit link, in place of the link toolbar", async () => {
            const showDialog = vi.fn(() => null);
            const { editor, open } = await createMenuEditor({ internalLink: { showDialog } });
            setModelData(editor.model, IN_WEB_LINK);
            const linkUI = editor.plugins.get(LinkUI);
            const balloon = editor.plugins.get(ContextualBalloon);
            (linkUI as unknown as { _showUI(): void })._showUI();
            const toolbarView = linkUI.toolbarView;
            expect(toolbarView && balloon.hasView(toolbarView)).toBe(true);

            run(await open(), "Edit link");
            expect(showDialog).toHaveBeenCalledOnce();
            expect(toolbarView && balloon.hasView(toolbarView)).toBe(false);
        });
    });

    describe("on a link to a note", () => {
        const openInTab = vi.fn();
        const download = vi.fn();
        const remove = vi.fn();
        const convert = vi.fn();
        const openNote = vi.fn();
        const describeNoteLink = vi.fn<LinkMenuHost["describeNoteLink"]>(
            async (_href, _element, wrap) => ({
                target: [
                    { kind: "entry", label: "Open in a tab", isEnabled: true, run: wrap(openInTab) }
                ],
                actions: [
                    [ { kind: "entry", label: "Download", isEnabled: true, run: wrap(download) } ],
                    [],
                    [ { kind: "entry", label: "Rename", isEnabled: true } ]
                ],
                afterUnlink: [
                    { kind: "entry", label: "Delete", isEnabled: true, run: wrap(remove) },
                    { kind: "entry", label: "Convert", isEnabled: true, run: wrap(convert) }
                ]
            })
        );

        beforeEach(() => {
            openInTab.mockClear();
            download.mockClear();
            remove.mockClear();
            convert.mockClear();
            openNote.mockClear();
            describeNoteLink.mockClear();
        });

        /** The entries with a host, after "Open note", the label of the toolbar's first button. */
        const WITH_HOST = [
            "Open in a tab", "---", "Edit link", "---", "Download", "---", "Rename", "---",
            "Unlink", "Delete", "Convert"
        ];

        it("puts the host's entries around those of a link, without web ones", async () => {
            const { editor, menu, unlink, open } = await createMenuEditor({
                linkMenu: { describeNoteLink, openNote }
            });
            setModelData(editor.model, IN_NOTE_LINK);

            expect(menu.class).toBe("");
            expect(unlink.isVisible).toBe(false);
            const entries = await open();
            expect(describeEntries(entries)).toStrictEqual([ "Open note", ...WITH_HOST ]);
            expect(entries[0]).toMatchObject({ iconClass: "bx bx-right-arrow-circle" });
            expect(entries.filter((entry) => entry.kind === "entry" && entry.isDestructive))
                .toMatchObject([ { label: "Unlink" } ]);
            const root = editor.editing.view.getDomRoot();
            expect(describeNoteLink)
                .toHaveBeenCalledExactlyOnceWith(NOTE, root, expect.any(Function));

            run(await open(), "Open note");
            expect(openNote).toHaveBeenCalledExactlyOnceWith(NOTE, root);
            run(await open(), "Open in a tab");
            expect(openInTab).toHaveBeenCalledOnce();
            run(await open(), "Download");
            expect(download).toHaveBeenCalledOnce();
            run(await open(), "Delete");
            expect(remove).toHaveBeenCalledOnce();
            run(await open(), "Convert");
            expect(convert).toHaveBeenCalledOnce();
            run(await open(), "Unlink");
            expect(editor.getData()).toBe("<p>foo</p>");
            expect(menu.class).toBe("ck-hidden");
        });

        it("unlinks a reference link to its title, handing the host the link itself", async () => {
            const { editor, unlink, open } = await createMenuEditor({
                linkMenu: { describeNoteLink, openNote }
            });
            setModelData(editor.model, ON_REFERENCE);

            expect(unlink.isVisible).toBe(false);
            expect(describeEntries(await open())).toStrictEqual([ "Open note", ...WITH_HOST ]);
            const element = describeNoteLink.mock.calls[0][1];
            expect(element.matches("a.reference-link")).toBe(true);
            expect(element.getAttribute("href")).toBe(NOTE);

            run(await open(), "Unlink");
            expect(getModelData(editor.model)).toBe("<paragraph>a Target[] b</paragraph>");
        });

        it("holds the actions on the link alone without a host", async () => {
            const { editor, open } = await createMenuEditor();
            setModelData(editor.model, ON_REFERENCE);

            const entries = await open();
            expect(describeEntries(entries)).toStrictEqual([
                "Open note", "---", "Edit link", "---", "Unlink"
            ]);
            // Nothing opens the note or downloads the attachment without a host.
            run(entries, "Open note");
            setModelData(editor.model, IN_ATTACHMENT_LINK);
            editor.ui.componentFactory.create("linkDownload").fire("execute");
        });

        it("downloads the attachment of a link from the Download button", async () => {
            const downloadAttachment = vi.fn();
            const { editor } = await createMenuEditor({
                linkMenu: { describeNoteLink, openNote, downloadAttachment }
            });
            const button = editor.ui.componentFactory.create("linkDownload") as ButtonView;
            expect(button.label).toBe("Download");

            setModelData(editor.model, IN_ATTACHMENT_LINK);
            expect(button.isVisible).toBe(true);
            button.fire("execute");
            expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(ATTACHMENT);

            downloadAttachment.mockClear();
            setModelData(editor.model,
                `<paragraph>[<reference href="${ATTACHMENT_DATA}"></reference>]</paragraph>`);
            expect(button.isVisible).toBe(true);
            button.fire("execute");
            expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(ATTACHMENT);

            for (const content of [ IN_NOTE_LINK, ON_REFERENCE, IN_WEB_LINK ]) {
                setModelData(editor.model, content);
                expect(button.isVisible, content).toBe(false);
            }
        });

        it("jumps from the first entry to an anchor of the note itself", async () => {
            const { editor, open } = await createMenuEditor({
                plugins: [ Essentials, Paragraph, Link, Bookmark, LinkMenu, ToolbarGroupMenu ],
                getNoteId: () => "abc",
                linkMenu: { describeNoteLink, openNote }
            });
            setModelData(editor.model,
                "<paragraph><bookmark bookmarkId=\"top\"></bookmark>text</paragraph>"
                + `<paragraph><$text linkHref="${NOTE}?bookmark=top">foo</$text></paragraph>`);
            editor.model.change((writer) => {
                const link = editor.model.document.getRoot()?.getChild(1);
                if (link) writer.setSelection(link, 1);
            });

            const [ first ] = describeEntries(await open());
            expect(first).toBe("Jump to anchor");
            run(await open(), "Jump to anchor");
            expect(openNote).not.toHaveBeenCalled();
        });

        it("leaves out the host's places to open the note for blocks of the note itself",
            async () => {
                const { editor, open } = await createMenuEditor({
                    getNoteId: () => "abc",
                    linkMenu: { describeNoteLink, openNote }
                });
                const selectLink = (href: string) => setModelData(editor.model,
                    `<paragraph><$text linkHref="${href}">fo[]o</$text></paragraph>`);

                selectLink(`${NOTE}?block=b1`);
                expect(describeEntries(await open())).toStrictEqual([
                    "Jump to block", "Edit link", ...WITH_HOST.slice(3)
                ]);

                selectLink("#root/def?block=b1");
                expect(describeEntries(await open())).toStrictEqual([ "Open note", ...WITH_HOST ]);
            });
    });

    describe("on a right-click", () => {
        const WEB_ENTRIES = [
            "Open link", "Edit link", "---", "Copy address (URL)", "---",
            [ "Display as", [ "Text (on)", "Icon & text", "Card" ] ], "---", "Unlink"
        ];
        const AROUND_WEB_LINK =
            `<paragraph>[]a <$text linkHref="${URL}">foo</$text> b</paragraph>`;

        it("opens the menu of a link at the pointer, moving the caret into the link", async () => {
            const { editor, rightClick } = await createMenuEditor();
            const selection = editor.model.document.selection;
            setModelData(editor.model, AROUND_WEB_LINK);

            const { isTaken, request } = await rightClick(find(editor, "a"));
            expect(isTaken).toBe(true);
            expect(request?.anchor).toStrictEqual({ x: 30, y: 40 });
            expect(describeEntries(request?.items ?? [])).toStrictEqual(WEB_ENTRIES);
            expect(selection.isCollapsed).toBe(true);
            expect(selection.getFirstPosition()?.offset).toBe(5);
            expect(selection.getAttribute("linkHref")).toBe(URL);
            run(request?.items ?? [], "Unlink");
            expect(editor.getData()).toBe("<p>a foo b</p>");

            // A caret or a selection that is in the link already stays where it is.
            setModelData(editor.model, IN_WEB_LINK);
            expect((await rightClick(find(editor, "a"))).isTaken).toBe(true);
            expect(selection.getFirstPosition()?.offset).toBe(2);
            const inLink = `<paragraph><$text linkHref="${URL}">f[o]o</$text></paragraph>`;
            setModelData(editor.model, inLink);
            expect((await rightClick(find(editor, "a"))).isTaken).toBe(true);
            expect(getModelData(editor.model)).toBe(inLink);
        });

        it("selects a reference link or a link preview whole, and opens its menu", async () => {
            const describeNoteLink = vi.fn<LinkMenuHost["describeNoteLink"]>(async () => ({
                target: [], actions: [], afterUnlink: []
            }));
            const { editor, rightClick } = await createMenuEditor({
                linkMenu: { describeNoteLink, openNote: vi.fn() }
            });
            const selected = () => editor.model.document.selection.getSelectedElement()?.name;

            setModelData(editor.model,
                `<paragraph>[]a <reference href="${NOTE}"></reference></paragraph>`);
            const title = find(editor, "a.reference-link > span");
            const { isTaken, request } = await rightClick(title);
            expect(isTaken).toBe(true);
            expect(selected()).toBe("reference");
            expect(describeEntries(request?.items ?? [])).toStrictEqual([
                "Open note", "---", "Edit link", "---", "Unlink"
            ]);
            expect((await rightClick(title)).request).toBeDefined();
            expect(selected()).toBe("reference");

            // The drawn content of an icon & text link is widget UI, whose events the view ignores.
            setModelData(editor.model,
                `<paragraph>[]a <linkMention url="${URL}" title="T"></linkMention></paragraph>`);
            const content = find(editor, ".link-mention-inner");
            expect(content?.matches("[data-cke-ignore-events]")).toBe(true);
            const preview = await rightClick(content);
            expect(preview.isTaken).toBe(true);
            expect(selected()).toBe("linkMention");
            expect(describeEntries(preview.request?.items ?? [])[0]).toBe("Open link");
        });

        it("leaves the browser's menu to a right-click it has no menu of a link for", async () => {
            const { editor, rightClick } = await createMenuEditor();
            const isTaken = async (element: Element | null | undefined, init?: MouseEventInit) =>
                (await rightClick(element, init)).isTaken;

            // A selection holding the link among other text keeps the menu of the selection.
            setModelData(editor.model,
                `<paragraph>[a <$text linkHref="${URL}">foo</$text> b]</paragraph>`);
            expect(await isTaken(find(editor, "a"))).toBe(false);
            expect(editor.model.document.selection.isCollapsed).toBe(false);
            // So does one that holds part of the link, from either side.
            for (const data of [
                `<paragraph>[a <$text linkHref="${URL}">f]oo</$text> b</paragraph>`,
                `<paragraph>a <$text linkHref="${URL}">f[oo</$text> b]</paragraph>`
            ]) {
                setModelData(editor.model, data);
                expect(await isTaken(find(editor, "a"))).toBe(false);
                expect(editor.model.document.selection.isCollapsed).toBe(false);
            }
            setModelData(editor.model,
                `<paragraph>[a] <$text linkHref="${URL}">foo</$text> b</paragraph>`);
            expect(await isTaken(find(editor, "a"))).toBe(true);

            setModelData(editor.model, AROUND_WEB_LINK);
            expect(await isTaken(find(editor, "p"))).toBe(false);
            // Shift+right-click opens the browser's menu, and Ctrl+right-click is the host's.
            expect(await isTaken(find(editor, "a"), { shiftKey: true })).toBe(false);
            expect(await isTaken(find(editor, "a"), { ctrlKey: true })).toBe(false);
            const isMac = env.isMac;
            env.isMac = true;
            try {
                expect(await isTaken(find(editor, "a"), { metaKey: true })).toBe(false);
                expect(await isTaken(find(editor, "a"), { ctrlKey: true })).toBe(true);
            } finally {
                env.isMac = isMac;
            }

            // An element the editing view did not draw.
            const stray = document.createElement("span");
            find(editor, "p")?.append(stray);
            expect(await isTaken(stray)).toBe(false);
            stray.remove();

            setModelData(editor.model,
                "<paragraph>[]a <$text linkHref=\"mailto:a@b.c\">foo</$text></paragraph>");
            expect(await isTaken(find(editor, "a"))).toBe(false);

            const withoutHost = await createMenuEditor({ toolbarGroupMenu: undefined });
            setModelData(withoutHost.editor.model, AROUND_WEB_LINK);
            expect((await withoutHost.rightClick(find(withoutHost.editor, "a"))).isTaken)
                .toBe(false);
        });
    });

    describe("beside the toolbar of a link", () => {
        /** The label of the entry of the menu for an item of a toolbar, where the two differ. */
        const MENU_LABELS: Record<string, string> = { linkEmbedDisplayDropdown: "Display as" };
        /** The items whose entry the host adds to the menu, among its actions on an attachment. */
        const FROM_HOST = [ "linkDownload" ];
        const WEB_ACTIONS = [ "Open link", "Copy address (URL)", "Edit link", "Display as" ];

        it("holds every action that the toolbar shows", async () => {
            const { editor, open } = await createMenuEditor({
                plugins: [
                    Essentials, Paragraph, Link, LinkMenu, ToolbarGroupMenu, LinkEmbedToolbar,
                    CopyLinkUrlButton
                ],
                linkMenu: {
                    describeNoteLink: async () => ({ target: [], actions: [], afterUnlink: [] }),
                    openNote: vi.fn(),
                    downloadAttachment: vi.fn()
                }
            });
            /**
             * The labels of the actions that the toolbar of `names` shows on `content`, and of
             * those among them that the menu lacks.
             */
            const compare = async (content: string, names: string[]) => {
                setModelData(editor.model, content);
                const shown = names
                    .filter((name) => ![ "|", "linkMenu", ...FROM_HOST ].includes(name))
                    .map((name) => [ name, editor.ui.componentFactory.create(name) ] as const)
                    .filter(([ , item ]) => isShown(item))
                    .map(([ name, item ]) => MENU_LABELS[name] ?? (item as ButtonView).label);
                const entries =
                    (await open()).map((entry) => entry.kind === "entry" && entry.label);
                return { shown, missing: shown.filter((label) => !entries.includes(label)) };
            };
            const preview = getWidgetToolbarItems(editor, "linkEmbed");
            const reference = getWidgetToolbarItems(editor, "referenceLink");

            expect([
                await compare(IN_WEB_LINK, LINK_TOOLBAR),
                await compare(
                    `<paragraph>[<linkMention url="${URL}" title="T"></linkMention>]</paragraph>`,
                    preview),
                await compare(IN_NOTE_LINK, LINK_TOOLBAR),
                await compare(ON_REFERENCE, reference),
                await compare(IN_ATTACHMENT_LINK, LINK_TOOLBAR),
                await compare(
                    `<paragraph>[<reference href="${ATTACHMENT_DATA}"></reference>]</paragraph>`,
                    reference)
            ]).toStrictEqual([
                { shown: WEB_ACTIONS, missing: [] },
                { shown: WEB_ACTIONS, missing: [] },
                { shown: [ "Open note", "Edit link" ], missing: [] },
                { shown: [ "Open note", "Edit link" ], missing: [] },
                { shown: [ "Open attachment", "Edit link" ], missing: [] },
                { shown: [ "Open attachment", "Edit link" ], missing: [] }
            ]);
        });
    });
});

/** Whether an item of a toolbar shows: it is visible, and no `ck-hidden` class hides it. */
function isShown(item: View) {
    const { isVisible, class: className } = item as View & { isVisible?: boolean; class?: string };
    return isVisible !== false && !className?.split(" ").includes("ck-hidden");
}

/** The items of the widget toolbar registered as `name`. */
function getWidgetToolbarItems(editor: ClassicEditor, name: string): string[] {
    const repository = editor.plugins.get(WidgetToolbarRepository) as unknown as {
        _toolbarDefinitions: Map<string, { itemsConfig: string[] }>;
    };
    return repository._toolbarDefinitions.get(name)?.itemsConfig ?? [];
}
