import type { CKTextEditor, ContentEmbedState } from "@triliumnext/ckeditor5";

import type { GeoMouseEvent } from "../widgets/collections/geomap/map.js";

import appContext, { type CommandNames } from "../components/app_context.js";
import type FAttachment from "../entities/fattachment.js";
import type FNote from "../entities/fnote.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import type { ViewScope } from "../services/link.js";
import utils, { escapeHtml, isMobile } from "../services/utils.js";
import { getClosestNtxId } from "../widgets/widget_utils.js";
import contextMenu, { type ContextMenuOptions, type MenuItem } from "./context_menu.js";
import { submenuItem } from "./context_menu_utils.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

/**
 * Where a link menu opens, and the element it is opened from. A mouse event is one; a control
 * acting on something shown elsewhere passes that thing as `target`.
 */
export type LinkMenuOrigin = Pick<MouseEvent, "pageX" | "pageY" | "target">;

/** The embed a menu is opened on, in a text note open for editing. */
interface MenuEmbed {
    editor: CKTextEditor;
    element: Element;
    state: ContentEmbedState;
}

const CHECK_ICON = "bx bx-check";

let lastMenuRequest = 0;

async function openContextMenu(
    notePath: string,
    e: LinkMenuOrigin,
    viewScope: ViewScope = {},
    hoistedNoteId: string | null = null
) {
    const request = ++lastMenuRequest;
    const noteId = notePath.split("/").at(-1) ?? notePath;
    const editor = await getEditingTextEditor(getTarget(e));
    const embed = editor && getMenuEmbed(e, editor);
    const ownItems = viewScope.viewMode === "attachments" && viewScope.attachmentId
        ? await getAttachmentItems(noteId, viewScope.attachmentId, e, editor, embed)
        : await getNoteItems(noteId, e, editor, embed);
    // A later right-click opened its own menu while this one waited for the editor or the
    // attachment.
    if (request !== lastMenuRequest) {
        return;
    }

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [ ...getItems(e), ...ownItems ],
        selectMenuItemHandler: ({ command }) => handleLinkContextMenuItem(command, e, notePath, viewScope, hoistedNoteId),
        ...(editor ? keepEditorFocused(editor) : {})
    });
}

/**
 * Menu options adding the menu to the focus tracker of `editor`, so that the editor stays focused
 * while the menu is up.
 */
function keepEditorFocused(
    editor: CKTextEditor
): Pick<ContextMenuOptions<CommandNames>, "onShow" | "onHide"> {
    let menuContainer: HTMLElement | null = null;

    return {
        onShow: (container) => {
            menuContainer = container;
            editor.ui.focusTracker.add(container);
        },
        onHide: () => {
            if (menuContainer) {
                editor.ui.focusTracker.remove(menuContainer);
            }
        }
    };
}

/** The origin of a menu that opens below `anchor` and acts from `target`. */
function getOriginBelow(anchor: Element, target: Element = anchor): LinkMenuOrigin {
    const { left, bottom } = anchor.getBoundingClientRect();
    return { pageX: left + window.scrollX, pageY: bottom + window.scrollY, target };
}

function getItems(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames>[] {
    return [ ...getOpenItems(e), getQuickEditItem() ];
}

/** The places the note can be opened in, without the quick edit popup. */
function getOpenItems(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames>[] {
    const ntxId = getNtxId(e);
    const isMobileSplitOpen = isMobile() && appContext.tabManager.getNoteContextById(ntxId).getMainContext().getSubContexts().length > 1;

    return [
        { title: t("link_context_menu.open_note_in_new_tab"), command: "openNoteInNewTab", uiIcon: "bx bx-link-external" },
        { title: !isMobileSplitOpen ? t("link_context_menu.open_note_in_new_split") : t("link_context_menu.open_note_in_other_split"), command: "openNoteInNewSplit", uiIcon: "bx bx-dock-right" },
        { title: t("link_context_menu.open_note_in_new_window"), command: "openNoteInNewWindow", uiIcon: "bx bx-window-open" }
    ];
}

/** Opens the note in a popup over the current one. */
function getQuickEditItem(): MenuItem<CommandNames> {
    return { title: t("link_context_menu.open_note_in_popup"), command: "openNoteInPopup", uiIcon: "bx bx-edit" };
}

/**
 * The same places, folded into one submenu, for a menu that lists entries of its own beside them.
 *
 * The items keep their commands, so `handleLinkContextMenuItem` handles them from a submenu as it
 * does from the top level. The entry carries the first of those commands itself, so that picking it
 * opens a new tab without going into the submenu for the place it is opened in most often.
 */
function getOpenNoteItem(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames> {
    return {
        title: t("link_context_menu.open_note"),
        uiIcon: "bx bx-link-external",
        command: "openNoteInNewTab",
        items: getOpenItems(e)
    };
}

function handleLinkContextMenuItem(command: string | undefined, e: LinkMenuOrigin | GeoMouseEvent, notePath: string, viewScope = {}, hoistedNoteId: string | null = null) {
    if (!hoistedNoteId) {
        hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null;
    }

    if (command === "openNoteInNewTab") {
        appContext.tabManager.openContextWithNote(notePath, {
            hoistedNoteId, viewScope, placement: "afterCurrent"
        });
        return true;
    } else if (command === "openNoteInNewSplit") {
        const ntxId = getNtxId(e);
        if (!ntxId) return false;
        appContext.triggerCommand("openNewNoteSplit", { ntxId, notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInNewWindow") {
        appContext.triggerCommand("openInWindow", { notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInPopup") {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath, viewScope });
        return true;
    }

    return false;
}

/**
 * The actions on the attachment a link points to, each group after a separator. A menu opened on
 * an embed of it has the commands of the embed after the first group. A menu opened in a note shown
 * read-only has only the actions that leave the attachment unchanged.
 */
async function getAttachmentItems(
    noteId: string,
    attachmentId: string,
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    embed: MenuEmbed | null
): Promise<MenuItem<CommandNames>[]> {
    // Imported on demand: `attachment_actions` imports `link`, which imports this module.
    const [ attachment, { getAttachmentActionGroups }, isReadOnly ] = await Promise.all([
        froca.getAttachmentOfNote(noteId, attachmentId),
        import("../services/attachment_actions.js"),
        isInReadOnlyNote(getTarget(e))
    ]);
    if (!attachment) {
        return [];
    }

    const actionGroups = getAttachmentActionGroups(attachment, { isReadOnly });
    const [ firstGroup = [], ...otherGroups ] = actionGroups
        .map((group) => group.map((action): MenuItem<CommandNames> => ({
            title: action.title,
            uiIcon: action.icon,
            enabled: !action.disabledReason,
            handler: () => void action.run()
        })));
    const groups = [ firstGroup, embed ? getEmbedItems(embed) : [], ...otherGroups ];
    const actionItems = groups
        .filter((group) => group.length > 0)
        .flatMap((group): MenuItem<CommandNames>[] => [ { kind: "separator" }, ...group ]);

    const embedItem = await getConvertToEmbedItem(
        e, editor, t("link_context_menu.convert_link_to_embed"), async () => attachment
    );
    const conversionItems = [ embedItem, embed && getConvertToLinkItem(embed) ]
        .filter((item) => !!item);
    return [ ...actionItems, ...conversionItems ];
}

/**
 * The commands of an embedded note that the menu is opened on, in a group of their own, and
 * converting it in another. A menu opened on a link to the note offers converting the link.
 */
async function getNoteItems(
    noteId: string,
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    embed: MenuEmbed | null
): Promise<MenuItem<CommandNames>[]> {
    if (!embed) {
        const embedItem = await getConvertToEmbedItem(
            e, editor, t("link_context_menu.convert_link_to_included_note"),
            () => froca.getNote(noteId)
        );
        return embedItem ? [ { kind: "separator" }, embedItem ] : [];
    }

    const linkItem = getConvertToLinkItem(embed);
    return [
        { kind: "separator" },
        ...getEmbedItems(embed),
        ...(linkItem ? [ { kind: "separator" } as const, linkItem ] : [])
    ];
}

/**
 * The embed that a menu is opened on: from its title row, or from a control acting on the whole
 * embed, such as its toolbar. A link inside the embedded content opens the menu of that link.
 */
function getMenuEmbed(e: LinkMenuOrigin, editor: CKTextEditor): MenuEmbed | null {
    const target = getTarget(e);
    const element = target?.matches(".include-note")
        ? target
        : target?.closest(".include-note-title-row")?.closest(".include-note");
    if (!element || !editor.plugins.has("ContentEmbed")) {
        return null;
    }

    const state = editor.plugins.get("ContentEmbed").getEmbedStateAt(element);
    return state ? { editor, element, state } : null;
}

/**
 * The commands that the toolbar of an embed offers, with what each shows checked. Editable is
 * offered only for content that has an editable mode.
 */
function getEmbedItems(embed: MenuEmbed): MenuItem<CommandNames>[] {
    const { editor, state } = embed;
    const sizeItems = editor.plugins.get("ContentEmbed").getBoxSizes()
        .map(({ value, label }): MenuItem<CommandNames> => ({
            title: escapeHtml(label),
            trailingIcon: value === state.boxSize ? CHECK_ICON : undefined,
            handler: () => runEmbedCommand(embed, "contentEmbedBoxSize", { value })
        }));
    const editableItems: MenuItem<CommandNames>[] = state.isEditableToggleable ? [ {
        title: t("link_context_menu.editable"),
        uiIcon: "bx bx-edit-alt",
        trailingIcon: state.isEditable ? CHECK_ICON : undefined,
        handler: () => runEmbedCommand(embed, "toggleContentEmbedEditable")
    } ] : [];

    return [
        ...editableItems,
        submenuItem({
            title: t("link_context_menu.include_size"),
            uiIcon: "bx bx-expand-vertical"
        }, sizeItems),
        {
            title: t("link_context_menu.show_title"),
            uiIcon: "bx bx-window-alt",
            enabled: state.isTitleToggleable,
            trailingIcon: state.isTitleShown ? CHECK_ICON : undefined,
            handler: () => runEmbedCommand(embed, "toggleContentEmbedTitle")
        },
        {
            title: t("link_context_menu.show_caption"),
            uiIcon: "bx bx-captions",
            enabled: state.isCaptionToggleable,
            trailingIcon: state.hasCaption ? CHECK_ICON : undefined,
            handler: () => runEmbedCommand(embed, "toggleContentEmbedCaption", {
                focusCaptionOnShow: true
            })
        }
    ];
}

/** Runs `command` on the embed, which the commands act on once it is selected. */
function runEmbedCommand(
    { editor, element }: MenuEmbed,
    command: string,
    options?: Record<string, unknown>
) {
    if (editor.plugins.get("ContentEmbed").selectEmbedAt(element)) {
        editor.execute(command, options);
        editor.editing.view.focus();
    }
}

/**
 * The item titled `title` that converts a link to a note or an attachment into an embed, in a
 * text note open for editing, for a link that the editor can convert.
 */
async function getConvertToEmbedItem(
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    title: string,
    getLinkedEntity: () => Promise<FNote | FAttachment | null>
): Promise<MenuItem<CommandNames> | null> {
    const link = getTarget(e)?.closest<HTMLElement>("a.reference-link");
    if (!link || !editor?.commands.get("convertLinkToEmbed")?.isEnabled
            || !editor.plugins.get("ContentEmbed").canConvertLinkToEmbed(link)) {
        return null;
    }

    // Imported on demand: `content_renderer` imports `link`, which imports this module.
    const [ entity, { getEmbedBoxSize } ] = await Promise.all([
        getLinkedEntity(),
        import("../services/content_renderer.js")
    ]);
    if (!entity) {
        return null;
    }

    return {
        title,
        uiIcon: "bx bx-window-alt",
        handler: () => editor.execute("convertLinkToEmbed", {
            domElement: link,
            boxSize: getEmbedBoxSize(entity)
        })
    };
}

/** "Convert to link", for an embed that names a note or an attachment. */
function getConvertToLinkItem(embed: MenuEmbed): MenuItem<CommandNames> | null {
    if (!embed.state.isConvertibleToLink) {
        return null;
    }

    return {
        title: t("link_context_menu.convert_embed_to_link"),
        uiIcon: "bx bx-link",
        handler: () => runEmbedCommand(embed, "convertEmbedToLink")
    };
}

function getTarget(e: LinkMenuOrigin) {
    return e.target instanceof Element ? e.target : null;
}

/**
 * Whether `element` is in a split pane whose note is shown read-only, by its `#readOnly` label or
 * by its size.
 */
async function isInReadOnlyNote(element: Element | null) {
    const ntxId = element instanceof HTMLElement ? getClosestNtxId(element) : null;
    const noteContext = ntxId
        ? appContext.tabManager.getNoteContexts().find((context) => context.ntxId === ntxId)
        : null;

    return (await noteContext?.isReadOnly()) ?? false;
}

/** The text editor containing `element`, or `null` when there is none or it is read-only. */
async function getEditingTextEditor(element: Element | null) {
    // Checked first: a note shown read-only has no editor, and asking for one waits for a timeout.
    if (!element?.closest(".ck-editor__editable[contenteditable='true']")) {
        return null;
    }

    return getTextEditorContaining(element);
}

function getNtxId(e: LinkMenuOrigin | GeoMouseEvent) {
    if (utils.isDesktop()) {
        const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
        if (!subContexts) return null;
        return subContexts[subContexts.length - 1].ntxId;
    } else {
        const target = "originalEvent" in e ? e.originalEvent?.target : e.target;
        if (target instanceof HTMLElement) {
            const closest = getClosestNtxId(target);
            if (closest) return closest;
        }
    }
    // Fallback: when the event originates outside any note-context DOM
    // (e.g. mobile sidebar), target the currently active context so downstream
    // lookups don't fail with a null ntxId.
    return appContext.tabManager.activeNtxId ?? null;
}

export default {
    getItems,
    getOriginBelow,
    getQuickEditItem,
    getOpenNoteItem,
    handleLinkContextMenuItem,
    openContextMenu
};
