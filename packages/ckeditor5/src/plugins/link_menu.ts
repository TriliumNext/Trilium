import {
    ButtonView, type Command, createDropdown, type Editor, env, findAttributeRange, IconPencil,
    IconThreeVerticalDots, IconUnlink, IconWeb, ModelElement, type ModelNode, type ModelPosition,
    type ModelRange, Plugin, type ViewElement
} from "ckeditor5";

import copyIcon from "../icons/copy.svg?raw";
import downloadIcon from "../icons/download.svg?raw";
import linkPreviewIcon from "../icons/link-preview.svg?raw";
import { ContextMenuObserver, type ViewDocumentContextMenuEvent } from "../utils.js";
import { copyUrl } from "./copy_link_url.js";
import { COMMAND_NAME as LINK_DIALOG_COMMAND } from "./internallink.js";
import LinkEmbed, {
    CHANGE_LINK_DISPLAY_COMMAND, getLinkDisplayModeLabel, LINK_DISPLAY_MODES,
    REMOVE_LINK_EMBED_COMMAND
} from "./link_embed/link_embed.js";
import type { ChangeLinkDisplayCommand } from "./link_embed/link_embed_commands.js";
import NoteLinkToolbar, {
    getInNoteTarget, getOpenLinkLabel, jumpInNote, NOTE_LINK, UNLINK_REFERENCE_COMMAND
} from "./note_link_toolbar.js";
import { getAttachmentId, getSelectedReference } from "./referencelink.js";
import ToolbarGroupMenu, {
    openListAsMenu, type ToolbarGroupMenuEntry, type ToolbarGroupMenuItem
} from "./toolbar_group_menu.js";

/** Wraps the action of an entry, as `ToolbarGroupMenu` runs it. */
type RunEntry = (action: () => void) => () => void;

/**
 * The toolbar of a link in the text, for the `link.toolbar` configuration. Its Display dropdown is
 * the one of a link preview, which reads "Text" on a link in the text. On a link with a menu, the
 * menu holds Unlink and `unlinkWithoutMenu` hides.
 */
export const LINK_TOOLBAR = [
    "linkPreview", "copyLinkUrl", "linkDownload", "|", "editLink", "unlinkWithoutMenu", "|",
    "linkEmbedDisplayDropdown", "linkMenu"
];

/** The link previews and the reference link, which a right-click selects whole. */
const LINK_WIDGETS = [ "linkMention", "linkEmbed", "reference" ];

/** What the host does for the toolbar and the menu of a link to a note. See {@link LinkMenu}. */
export interface LinkMenuHost {
    /**
     * The entries about the note or the attachment that `href` links to: `target`, which head the
     * menu, such as the places to open the note in, `actions`, the groups of entries after Edit
     * link, such as the actions on an attachment, and `afterUnlink`, which end the menu after
     * Unlink, such as deleting an attachment or converting the link. `element` is the reference
     * link, or the editable for a link in the text.
     */
    describeNoteLink(href: string, element: HTMLElement, run: RunEntry): Promise<{
        target: ToolbarGroupMenuItem[];
        actions: ToolbarGroupMenuItem[][];
        afterUnlink: ToolbarGroupMenuItem[];
    }>;
    /**
     * Opens what `href` links to in place of the note of `element`, as a click on the first
     * button of the toolbar does.
     */
    openNote(href: string, element: HTMLElement): void;
    /** Downloads the attachment that `href` links to, from the Download button of the toolbar. */
    downloadAttachment(href: string): void;
}

/**
 * Registers the `linkMenu` toolbar item: the "More actions" menu of a link to a web page, shown as
 * a preview or as a link in the text, and of a link to a note, in the text or as a reference link,
 * which `ToolbarGroupMenu` has the host draw. The menu repeats the actions of the toolbar and holds
 * Unlink, which the toolbar of such a link leaves out. The menu of a link to a note opens with the
 * first button of the toolbar, adds the entries of the host's `linkMenu` and leaves out those for
 * a web page. A right-click on such a link opens the same menu at the pointer, with the selection
 * moved onto the link. Also registers
 * `unlinkWithoutMenu`, the `unlink` button of `LinkUI` for any other link, and `linkDownload`,
 * which has the host download the attachment that a link points to.
 */
export default class LinkMenu extends Plugin {

    /** Whether the selection is on a link to a note, in the text or as a reference link. */
    declare isOnNoteLink: boolean;
    /** Whether the selection is on a link to an attachment, in the text or as a reference link. */
    declare isOnAttachmentLink: boolean;

    static get requires() {
        return [ LinkEmbed, NoteLinkToolbar, ToolbarGroupMenu ] as const;
    }

    static get pluginName() {
        return "LinkMenu" as const;
    }

    init() {
        const editor = this.editor;
        const factory = editor.ui.componentFactory;
        // Enabled on a link to a web page, as a preview or in the text.
        const webLink =
            editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND) as ChangeLinkDisplayCommand;
        const hasMenu = (isOnWebLink: boolean, isOnNoteLink: boolean) =>
            isOnWebLink || isOnNoteLink;

        const describe = (run: RunEntry) => (this.isOnNoteLink
            ? describeNoteLinkMenu(editor, run)
            : describeWebLinkMenu(editor, webLink, run));

        this.set({ isOnNoteLink: false, isOnAttachmentLink: false });
        this.listenTo(editor.model.document, "change", () => {
            const href = getNoteLinkHref(editor);
            this.isOnNoteLink = href !== null;
            this.isOnAttachmentLink = getAttachmentId(href) !== null;
        });

        const view = editor.editing.view;
        view.addObserver(ContextMenuObserver);
        this.listenTo<ViewDocumentContextMenuEvent>(view.document, "contextmenu", (evt, data) => {
            const { domEvent } = data;
            // Shift+right-click opens the browser's menu, and Ctrl+right-click is left to the host.
            if (domEvent.shiftKey || (env.isMac ? domEvent.metaKey : domEvent.ctrlKey)) {
                return;
            }
            if (!this.selectLinkAt(data.target) || !hasMenu(webLink.isEnabled, this.isOnNoteLink)) {
                return;
            }

            const point = { x: domEvent.clientX, y: domEvent.clientY };
            if (editor.plugins.get(ToolbarGroupMenu).openContextMenu(point, describe)) {
                data.preventDefault();
                evt.stop();
            }
        });

        factory.add("linkMenu", (locale) => {
            // A plain button, without the arrow of `DropdownButtonView`, opens the dropdown.
            const button = new ButtonView(locale);
            button.set({
                label: editor.t("More actions"),
                icon: IconThreeVerticalDots,
                tooltip: true
            });
            button.delegate("execute").to(button, "open");

            const dropdown = createDropdown(locale, button);
            dropdown.bind("class").to(webLink, "isEnabled", this, "isOnNoteLink",
                (isOnWebLink, isOnNoteLink) =>
                    (hasMenu(isOnWebLink, isOnNoteLink) ? "" : "ck-hidden"));
            openListAsMenu(dropdown, { describe });
            return dropdown;
        });

        factory.add("unlinkWithoutMenu", () => {
            const button = factory.create("unlink") as ButtonView;
            button.bind("isVisible").to(webLink, "isEnabled", this, "isOnNoteLink",
                (isOnWebLink, isOnNoteLink) => !hasMenu(isOnWebLink, isOnNoteLink));
            return button;
        });

        factory.add("linkDownload", (locale) => {
            const button = new ButtonView(locale);
            button.set({ label: editor.t("Download"), icon: downloadIcon, tooltip: true });
            button.bind("isVisible").to(this, "isOnAttachmentLink");
            button.on("execute", () => {
                // The button shows only on a link to an attachment.
                const href = getNoteLinkHref(editor) as string;
                editor.config.get("linkMenu")?.downloadAttachment(href);
            });
            return button;
        });
    }

    /**
     * Moves the selection onto the link at `target`, unless it is on that link already. Returns
     * whether the selection is on the link, which it is not outside a link, nor for a selection
     * that holds any of the link among other content.
     */
    private selectLinkAt(target: ViewElement | undefined): boolean {
        const model = this.editor.model;
        const link = target && getLinkAt(this.editor, target);
        if (!link) {
            return false;
        }

        const selection = model.document.selection;
        const range = link instanceof ModelElement ? model.createRangeOn(link) : link;
        // A document selection always has a position.
        const position = selection.getFirstPosition() as ModelPosition;
        const ranges = [ ...selection.getRanges() ];
        const isOnLink = link instanceof ModelElement
            ? selection.getSelectedElement() === link
            : findAttributeRange(position, "linkHref", selection.getAttribute("linkHref"), model)
                .isEqual(range)
                && (selection.isCollapsed
                    || ranges.every((held) => range.containsRange(held, true)));
        if (isOnLink) {
            return true;
        }
        if (!selection.isCollapsed && ranges.some((held) => held.isIntersecting(range))) {
            return false;
        }

        model.change((writer) => {
            writer.setSelection(link instanceof ModelElement ? range : range.end);
        });
        return true;
    }
}

/** The entries of the menu of a link to a web page, which `webLink` acts on. */
function describeWebLinkMenu(
    editor: Editor, webLink: ChangeLinkDisplayCommand, run: RunEntry
): ToolbarGroupMenuItem[] {
    const t = editor.t;
    // `webLink.url` is `null` for an address the editor never links to.
    const url = webLink.url ?? "";
    const unlinkCommand = (editor.commands.get(REMOVE_LINK_EMBED_COMMAND) as Command).isEnabled
        ? REMOVE_LINK_EMBED_COMMAND
        : "unlink";
    const displayModes = LINK_DISPLAY_MODES.filter(
        (mode) => mode !== "embedLink" || webLink.embedAvailable);

    return joinGroups([
        [
            {
                kind: "entry", label: t("Open link"), icon: IconWeb, isEnabled: url !== "",
                run: run(() => window.open(url, "_blank", "noopener,noreferrer"))
            },
            describeEditLink(editor, run)
        ],
        [ describeCopyUrl(editor, url, run) ],
        [ {
            kind: "entry", label: t("Display as"), icon: linkPreviewIcon,
            isEnabled: webLink.isEnabled,
            children: displayModes.map((mode): ToolbarGroupMenuItem => ({
                kind: "entry", label: getLinkDisplayModeLabel(t, mode), isEnabled: true,
                isOn: webLink.value === mode,
                run: run(() => editor.execute(CHANGE_LINK_DISPLAY_COMMAND, { value: mode }))
            }))
        } ],
        [ describeUnlink(editor, unlinkCommand, run) ]
    ]);
}

/**
 * The entries of the menu of a link to a note: the first button of the toolbar, which opens the
 * note in place, the host's places to open it in, Edit link, the host's actions on what the link
 * points to, and Unlink, followed by the host's entries for after it.
 */
async function describeNoteLinkMenu(
    editor: Editor, run: RunEntry
): Promise<ToolbarGroupMenuItem[]> {
    // The menu describes a link to a note only while the selection is on one.
    const href = getNoteLinkHref(editor) as string;
    const reference = getSelectedReference(editor);
    const element = getNoteLinkElement(editor, reference);
    const host = editor.config.get("linkMenu");
    const { target, actions, afterUnlink } = host
        ? await host.describeNoteLink(href, element, run)
        : { target: [], actions: [], afterUnlink: [] };
    const open: ToolbarGroupMenuEntry = {
        kind: "entry", label: getOpenLinkLabel(editor, href),
        iconClass: "bx bx-right-arrow-circle", isEnabled: true,
        run: run(() => {
            if (!jumpInNote(editor, href)) {
                host?.openNote(href, element);
            }
        })
    };

    const editLink = describeEditLink(editor, run);
    // The first entry jumps to blocks of the note itself, so no other place to open it is listed.
    const head = getInNoteTarget(editor, href)?.block
        ? [ [ open, editLink ] ]
        : [ [ open, ...target ], [ editLink ] ];
    const unlink = describeUnlink(editor, reference ? UNLINK_REFERENCE_COMMAND : "unlink", run);
    return joinGroups([ ...head, ...actions, [ unlink, ...afterUnlink ] ]);
}

function describeEditLink(editor: Editor, run: RunEntry): ToolbarGroupMenuEntry {
    return {
        kind: "entry", label: editor.t("Edit link"), icon: IconPencil,
        isEnabled: (editor.commands.get(LINK_DIALOG_COMMAND) as Command).isEnabled,
        run: run(() => editor.execute(LINK_DIALOG_COMMAND))
    };
}

/** "Copy address (URL)", which copies `url`, and is disabled without one. */
function describeCopyUrl(editor: Editor, url: string, run: RunEntry): ToolbarGroupMenuEntry {
    return {
        kind: "entry", label: editor.t("Copy address (URL)"), icon: copyIcon,
        isEnabled: url !== "", run: run(() => copyUrl(editor, url))
    };
}

/** "Unlink", which runs `commandName`. */
function describeUnlink(editor: Editor, commandName: string, run: RunEntry): ToolbarGroupMenuEntry {
    return {
        kind: "entry", label: editor.t("Unlink"), icon: IconUnlink, isDestructive: true,
        isEnabled: (editor.commands.get(commandName) as Command).isEnabled,
        run: run(() => editor.execute(commandName))
    };
}

/** The entries of `groups`, with a rule between two groups that hold any. */
function joinGroups(groups: ToolbarGroupMenuItem[][]): ToolbarGroupMenuItem[] {
    return groups
        .filter((group) => group.length > 0)
        .flatMap((group, index): ToolbarGroupMenuItem[] =>
            (index ? [ { kind: "separator" }, ...group ] : group));
}

/**
 * The `href` of the link to a note at the selection, in the text or as a reference link, or
 * `null`.
 */
function getNoteLinkHref(editor: Editor): string | null {
    const href = getSelectedReference(editor)?.getAttribute("href")
        ?? editor.model.document.selection.getAttribute("linkHref");
    return typeof href === "string" && NOTE_LINK.test(href) ? href : null;
}

/**
 * The link at `target` in the editing view: the range of the text of a link, or a link preview or
 * a reference link, which a right-click selects whole. `null` outside a link, and for a link in a
 * widget that shows content of its own, such as an included note.
 */
function getLinkAt(editor: Editor, target: ViewElement): ModelRange | ModelElement | null {
    const { mapper, view } = editor.editing;
    // The ancestors of a drawn element end at the root of the editing view.
    const ancestors =
        target.getAncestors({ includeSelf: true, parentFirst: true }) as ViewElement[];
    for (const ancestor of ancestors) {
        if (ancestor.is("attributeElement", "a")) {
            const start = mapper.toModelPosition(view.createPositionAt(ancestor, 0));
            // The `a` of a link in the text holds the text that the link is set on.
            const href = (start.nodeAfter as ModelNode).getAttribute("linkHref");
            return findAttributeRange(start, "linkHref", href, editor.model);
        }

        const element = mapper.toModelElement(ancestor);
        if (element) {
            return LINK_WIDGETS.includes(element.name) ? element : null;
        }
    }

    /* v8 ignore next -- the root of the editing view is bound to the root of the model */
    return null;
}

/** The element of `reference` in the DOM of the editing view, or the editable without one. */
function getNoteLinkElement(editor: Editor, reference: ModelElement | null): HTMLElement {
    const view = editor.editing.view;
    // Every element of the model document has a view element, and a shown toolbar a rendered
    // editable.
    const viewElement = reference && editor.editing.mapper.toViewElement(reference) as ViewElement;
    const element = viewElement ? view.domConverter.mapViewToDom(viewElement) : view.getDomRoot();
    return element as HTMLElement;
}

declare module "ckeditor5" {
    interface EditorConfig {
        /** The entries the host adds to the menu of a link to a note. */
        linkMenu?: LinkMenuHost;
    }

    interface PluginsMap {
        [LinkMenu.pluginName]: LinkMenu;
    }
}
