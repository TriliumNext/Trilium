import "./link_context_menu.css";

import type {
    CKTextEditor, ContentEmbedState, PositionValue, ToolbarGroupMenuItem
} from "@triliumnext/ckeditor5";
import { EXTENDED_CODE_BLOCK_CLASS } from "@triliumnext/commons";

import type { GeoMouseEvent } from "../widgets/collections/geomap/map.js";

import appContext, { type CommandNames } from "../components/app_context.js";
import type FAttachment from "../entities/fattachment.js";
import type FNote from "../entities/fnote.js";
import type { AttachmentAction } from "../services/attachment_actions.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import type { ViewScope } from "../services/link.js";
import open, { openUrlExternally } from "../services/open.js";
import utils, { escapeHtml, isMobile, isShare } from "../services/utils.js";
import { DISPLAY_MODE_OPTIONS } from "../widgets/type_widgets/helpers/split_editor_mode.js";
import { getContentEmbedTools } from "../widgets/type_widgets/text/content_embed_tools.js";
import { getClosestNtxId } from "../widgets/widget_utils.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";
import { submenuItem } from "./context_menu_utils.js";
import centerIcon from "./icons/position-center.svg?raw";
import leftIcon from "./icons/position-left.svg?raw";
import rightIcon from "./icons/position-right.svg?raw";
import wrapLeftIcon from "./icons/position-wrap-left.svg?raw";
import wrapRightIcon from "./icons/position-wrap-right.svg?raw";
import { getTextEditorContaining, keepEditorFocused } from "./text_editor_context_menu.js";

/**
 * Where a link menu opens, and the element it is opened from. A mouse event is one; a control
 * acting on something shown elsewhere passes that thing as `target`.
 */
export type LinkMenuOrigin = Pick<MouseEvent, "pageX" | "pageY" | "target">;

/** The event that a note is opened from, whose target picks the split a new split goes next to. */
type EventOrigin = Pick<Event, "target"> | GeoMouseEvent;

/** The embed a menu is opened on, in a text note open for editing. */
interface MenuEmbed {
    editor: CKTextEditor;
    element: Element;
    state: ContentEmbedState;
}

const CHECK_ICON = "bx bx-check";

/** The positions of an embed under one heading of its menu. */
interface PositionGroup {
    titleKey: string;
    positions: { value: PositionValue; titleKey: string }[];
}

/** The positions of an embed, under how the text runs around it, as its toolbar lists them. */
const POSITION_GROUPS: PositionGroup[] = [
    {
        titleKey: "link_context_menu.break_text",
        positions: [
            { value: "left", titleKey: "link_context_menu.align_left" },
            { value: "center", titleKey: "link_context_menu.align_center" },
            { value: "right", titleKey: "link_context_menu.align_right" }
        ]
    },
    {
        titleKey: "link_context_menu.wrap_text",
        positions: [
            { value: "wrap-left", titleKey: "link_context_menu.align_left" },
            { value: "wrap-right", titleKey: "link_context_menu.align_right" }
        ]
    }
];

/** The icons of the positions, from the editor's icon font. */
const POSITION_ICONS: Record<PositionValue, string> = {
    left: "cke cke-object-left",
    center: "cke cke-object-center",
    right: "cke cke-object-right",
    "wrap-left": "cke cke-object-inline-left",
    "wrap-right": "cke cke-object-inline-right"
};

/**
 * The icons of the positions on the tiles of the _Position_ submenu. They are drawn larger than
 * {@link POSITION_ICONS}, so with thinner lines, and the embed in them has a color of its own.
 */
const POSITION_TILE_ICONS: Record<PositionValue, string> = {
    left: leftIcon,
    center: centerIcon,
    right: rightIcon,
    "wrap-left": wrapLeftIcon,
    "wrap-right": wrapRightIcon
};

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
        ? await getAttachmentItems(noteId, viewScope.attachmentId, e, embed)
        : getNoteItems(embed);
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
 * Opens the menu of the embed at `e` with its own commands only, for an embed that shows no note or
 * attachment, such as one that keeps its source in the note or one that plays a video.
 */
async function openEmbedContextMenu(e: LinkMenuOrigin) {
    const request = ++lastMenuRequest;
    const editor = await getEditingTextEditor(getTarget(e));
    const embed = editor && getMenuEmbed(e, editor);
    if (!editor || !embed || request !== lastMenuRequest) {
        return;
    }

    const { url } = embed.state;
    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: url ? getVideoItems(embed, url) : getSourceItems(embed),
        selectMenuItemHandler: () => {},
        ...keepEditorFocused(editor)
    });
}

/**
 * The entries of the menu of the toolbar of a link to `notePath` in a text note being edited, for
 * the editor's `linkMenu`: `target`, the places to open the note in, `actions`, the groups of the
 * actions on an attachment the link points to, and `conversion`, converting a reference link to an
 * embed, then the attachment into a note. `element` is the reference link, or the editable for a
 * link in the text. `run` wraps the action of an entry, as the menu runs it.
 */
async function getLinkToolbarEntries(
    notePath: string,
    viewScope: ViewScope,
    element: HTMLElement,
    run: (action: () => void) => () => void
): Promise<{
    target: ToolbarGroupMenuItem[];
    actions: ToolbarGroupMenuItem[][];
    conversion: ToolbarGroupMenuItem[];
}> {
    const e: LinkMenuOrigin = { pageX: 0, pageY: 0, target: element };
    const noteId = notePath.split("/").at(-1) ?? notePath;
    const editor = await getEditingTextEditor(element);
    const toEntry = (
        item: MenuCommandItem<CommandNames>, action: () => void
    ): ToolbarGroupMenuItem => ({
        kind: "entry",
        label: item.title,
        iconClass: item.uiIcon,
        isEnabled: item.enabled ?? true,
        run: run(action)
    });
    const target = [ ...getOpenItems(e), getQuickEditItem() ].map((item) =>
        toEntry(item, () => handleLinkContextMenuItem(item.command, e, notePath, viewScope)));

    let actions: ActionItem[][] = [];
    let conversion: (ActionItem | null)[] = [];
    if (viewScope.viewMode === "attachments" && viewScope.attachmentId) {
        const linked = await getLinkedAttachment(noteId, viewScope.attachmentId, e);
        if (linked) {
            const { attachment, isReadOnly, getLinkedAttachmentActions } = linked;
            const { groups, conversion: toNote } =
                getLinkedAttachmentActions(attachment, { isReadOnly });
            actions = groups.map((group) => group.map(toActionItem));
            conversion = [
                await getConvertToEmbedItem(e, editor,
                    t("link_context_menu.convert_link_to_embed"), async () => attachment),
                toNote && toActionItem(toNote)
            ];
        }
    } else {
        conversion = [ await getConvertNoteLinkItem(e, editor, noteId, !!viewScope.block) ];
    }

    const toEntries = (items: (ActionItem | null)[]) => items
        .filter((item) => item !== null)
        .map((item) => toEntry(item, item.handler));
    return { target, actions: actions.map(toEntries), conversion: toEntries(conversion) };
}

/**
 * Downloads the attachment that a link to `notePath` points to, for the Download button of the
 * toolbar of the link. Does nothing for an attachment deleted since.
 */
async function downloadLinkedAttachment(notePath: string, viewScope: ViewScope) {
    const noteId = notePath.split("/").at(-1) ?? notePath;
    const attachment = viewScope.attachmentId
        ? await froca.getAttachmentOfNote(noteId, viewScope.attachmentId)
        : null;
    if (attachment) {
        open.downloadAttachment(attachment.attachmentId);
    }
}

/**
 * The menu of an embed that plays the video at `url`: opening the video outside Trilium, copying
 * its address and Display as, in the groups of the menu of a link preview, then the commands of
 * the embed, and deleting it, each in a group of its own.
 */
function getVideoItems(embed: MenuEmbed, url: string): MenuItem<CommandNames>[] {
    const { editor } = embed;
    // A video is a link preview shown as Embed.
    const displayModeItems = editor.plugins.get("LinkEmbed").getDisplayModes()
        .map(({ value, label }): MenuItem<CommandNames> => ({
            title: escapeHtml(label),
            trailingIcon: value === "embedLink" ? CHECK_ICON : undefined,
            handler: () => runEmbedCommand(embed, "changeLinkDisplay", { value })
        }));

    return [
        {
            title: t("link_context_menu.open_externally"),
            uiIcon: "bx bx-link-external",
            handler: () => openUrlExternally(url)
        },
        { kind: "separator" },
        {
            title: t("link_context_menu.copy_url"),
            uiIcon: "cke cke-trilium-copy",
            // As the Copy address (URL) button of the toolbar of the video does.
            handler: () => editor.config.get("clipboard")?.copy(url)
        },
        { kind: "separator" },
        submenuItem({
            title: t("link_context_menu.display_as"),
            uiIcon: "cke cke-trilium-link-preview"
        }, displayModeItems),
        { kind: "separator" },
        ...getEmbedItems(embed),
        ...getDeleteEmbedGroup(embed)
    ];
}

/**
 * The menu of an embed that keeps its source in the note: the commands of the embed, and for an
 * extended code block, deleting it in a group of its own.
 */
function getSourceItems(embed: MenuEmbed): MenuItem<CommandNames>[] {
    if (!embed.element.classList.contains(EXTENDED_CODE_BLOCK_CLASS)) {
        return getEmbedItems(embed);
    }

    return [ ...getEmbedItems(embed), ...getDeleteEmbedGroup(embed) ];
}

/** "Delete", which removes the embed from the note, after a separator. */
function getDeleteEmbedGroup(embed: MenuEmbed): MenuItem<CommandNames>[] {
    return [
        { kind: "separator" },
        {
            title: t("link_context_menu.delete"),
            uiIcon: "bx bx-trash destructive-action-icon",
            handler: () => runEmbedCommand(embed, "deleteContentEmbed")
        }
    ];
}

/** The origin of a menu that opens below `anchor` and acts from `target`. */
function getOriginBelow(anchor: Element, target: Element = anchor): LinkMenuOrigin {
    const { left, bottom } = anchor.getBoundingClientRect();
    return { pageX: left + window.scrollX, pageY: bottom + window.scrollY, target };
}

/**
 * The ways of opening a link. A shared page has no splits and no popup, so it offers only a new tab
 * and a new window, which open the note's shared page in the browser.
 */
function getItems(e: LinkMenuOrigin | GeoMouseEvent): MenuItem<CommandNames>[] {
    if (isShare) {
        return getOpenItems(e).filter((item) => "command" in item && item.command !== "openNoteInNewSplit");
    }

    return [ ...getOpenItems(e), getQuickEditItem() ];
}

/** On a shared page, the URL of a note's shared page, or `null` for a note that has none. */
let resolveShareLink: ((noteId: string) => string | null) | undefined;

/** Sets how a shared page finds the shared page of a note it opens, which only its host knows. */
function setShareLinkResolver(resolver: ((noteId: string) => string | null) | undefined) {
    resolveShareLink = resolver;
}

/** A menu item that opens the note in a place, which `handleLinkContextMenuItem()` handles. */
type OpenItem = MenuCommandItem<CommandNames> & { command: CommandNames };

/** A menu item that acts by itself, needing neither the item nor the event. */
type ActionItem = MenuCommandItem<CommandNames> & { handler(): void };

/** The places the note can be opened in, without the quick edit popup. */
function getOpenItems(e: LinkMenuOrigin | GeoMouseEvent): OpenItem[] {
    const ntxId = getNtxId(e);
    const isMobileSplitOpen = isMobile() && appContext.tabManager.getNoteContextById(ntxId).getMainContext().getSubContexts().length > 1;

    return [
        { title: t("link_context_menu.open_note_in_new_tab"), command: "openNoteInNewTab", uiIcon: "bx bx-link-external" },
        { title: !isMobileSplitOpen ? t("link_context_menu.open_note_in_new_split") : t("link_context_menu.open_note_in_other_split"), command: "openNoteInNewSplit", uiIcon: "bx bx-dock-right" },
        { title: t("link_context_menu.open_note_in_new_window"), command: "openNoteInNewWindow", uiIcon: "bx bx-window-open" }
    ];
}

/** Opens the note in a popup over the current one. */
function getQuickEditItem(): OpenItem {
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

function handleLinkContextMenuItem(command: string | undefined, e: EventOrigin, notePath: string, viewScope = {}, hoistedNoteId: string | null = null) {
    if (isShare) {
        return openSharedPage(command, notePath);
    }

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

/** Opens the shared page of the note at `notePath` in a new browser tab or window. */
function openSharedPage(command: string | undefined, notePath: string) {
    const link = resolveShareLink?.(notePath.split("/").at(-1) ?? notePath);
    if (!link || (command !== "openNoteInNewTab" && command !== "openNoteInNewWindow")) {
        return false;
    }

    window.open(link, "_blank", command === "openNoteInNewWindow" ? "noopener,popup" : "noopener");
    return true;
}

/**
 * The actions on the attachment a link points to, each group after a separator. A menu opened on
 * an embed of it has the commands of the embed after the first group, then, in a group of their
 * own, deleting the embed, then the attachment, and converting the embed to a link, then the
 * attachment into a note. A menu opened in a note shown read-only has only the actions that leave
 * the attachment unchanged.
 */
async function getAttachmentItems(
    noteId: string,
    attachmentId: string,
    e: LinkMenuOrigin,
    embed: MenuEmbed | null
): Promise<MenuItem<CommandNames>[]> {
    const linked = await getLinkedAttachment(noteId, attachmentId, e);
    if (!linked) {
        return [];
    }

    const { attachment, isReadOnly } = linked;
    if (!embed) {
        return separateGroups(linked.getAttachmentActionGroups(attachment, { isReadOnly })
            .map((group) => group.map(toActionItem)));
    }

    const { groups, deletion, conversion } =
        linked.getEmbeddedAttachmentActions(attachment, { isReadOnly });
    const [ firstGroup = [], ...otherGroups ] = groups.map((group) => group.map(toActionItem));
    const linkItem = getConvertToLinkItem(embed);
    return [
        ...separateGroups([ firstGroup, getEmbedItems(embed), ...otherGroups ]),
        ...getDeleteEmbedGroup(embed),
        ...(deletion ? [ toActionItem(deletion) ] : []),
        ...(linkItem ? [ linkItem ] : []),
        ...(conversion ? [ toActionItem(conversion) ] : [])
    ];
}

/** The items of each group that has any, after a separator. */
function separateGroups(groups: MenuItem<CommandNames>[][]): MenuItem<CommandNames>[] {
    return groups
        .filter((group) => group.length > 0)
        .flatMap((group): MenuItem<CommandNames>[] => [ { kind: "separator" }, ...group ]);
}

/**
 * The attachment a link at `e` points to, with the functions that list the actions on it, or
 * `null` once it is deleted. `isReadOnly` is set for a link in a note shown read-only, which has
 * only the actions that leave the attachment unchanged.
 */
async function getLinkedAttachment(noteId: string, attachmentId: string, e: LinkMenuOrigin) {
    // Imported on demand: `attachment_actions` imports `link`, which imports this module.
    const [ attachment, actions, isReadOnly ] = await Promise.all([
        froca.getAttachmentOfNote(noteId, attachmentId),
        import("../services/attachment_actions.js"),
        isInReadOnlyNote(getTarget(e))
    ]);
    if (!attachment) {
        return null;
    }

    const {
        getAttachmentActionGroups, getEmbeddedAttachmentActions, getLinkedAttachmentActions
    } = actions;
    return {
        attachment,
        isReadOnly,
        getAttachmentActionGroups,
        getEmbeddedAttachmentActions,
        getLinkedAttachmentActions
    };
}

/** `action` as an item of a menu, disabled where it cannot run. */
function toActionItem(action: AttachmentAction): ActionItem {
    return {
        title: action.title,
        uiIcon: action.icon,
        enabled: !action.disabledReason,
        handler: () => void action.run()
    };
}

/**
 * The commands of the embedded note that the menu is opened on, in a group of their own, then
 * deleting it and converting it to a link, or none for a menu opened on a link.
 */
function getNoteItems(embed: MenuEmbed | null): MenuItem<CommandNames>[] {
    if (!embed) {
        return [];
    }

    const linkItem = getConvertToLinkItem(embed);
    return [
        { kind: "separator" },
        ...getEmbedItems(embed),
        ...getDeleteEmbedGroup(embed),
        ...(linkItem ? [ linkItem ] : [])
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
 * The commands that the toolbar of an embed offers, with what each shows checked, and the items
 * that its content adds after Editable. Editable is offered only for content that has an editable
 * mode.
 */
function getEmbedItems(embed: MenuEmbed): MenuItem<CommandNames>[] {
    const { editor, state } = embed;
    const sizeItems = editor.plugins.get("ContentEmbed").getBoxSizes(embed.element)
        .map(({ value, label }): MenuItem<CommandNames> => ({
            title: escapeHtml(label),
            trailingIcon: value === state.boxSize ? CHECK_ICON : undefined,
            handler: () => runEmbedCommand(embed, "contentEmbedBoxSize", { value })
        }));
    const editableItems: MenuItem<CommandNames>[] = state.isEditableToggleable ? [ {
        title: t("link_context_menu.editable"),
        uiIcon: "bx bx-edit-alt",
        isSwitch: true,
        checked: state.isEditable,
        handler: () => runEmbedCommand(embed, "toggleContentEmbedEditable")
    } ] : [];
    const contentItems = getContentEmbedTools(embed.element)?.getMenuItems?.() ?? [];
    const displayModeItems = state.displayMode
        ? DISPLAY_MODE_OPTIONS.map(({ value, icon, titleKey }): MenuItem<CommandNames> => ({
            title: t(titleKey),
            uiIcon: icon,
            checked: value === state.displayMode,
            handler: () => runEmbedCommand(embed, "contentEmbedDisplayMode", { value })
        }))
        : [];

    return [
        ...editableItems,
        ...contentItems,
        ...(contentItems.length ? [ { kind: "separator" } as const ] : []),
        ...displayModeItems,
        ...(displayModeItems.length ? [ { kind: "separator" } as const ] : []),
        submenuItem({
            title: t("link_context_menu.include_size"),
            uiIcon: "bx bx-expand-vertical"
        }, sizeItems),
        ...getPositionItems(embed),
        ...(state.isTitleSupported ? [ {
            title: t("link_context_menu.show_title"),
            uiIcon: "bx bx-window-alt",
            isSwitch: true,
            enabled: state.isTitleToggleable,
            checked: state.isTitleShown,
            handler: () => runEmbedCommand(embed, "toggleContentEmbedTitle")
        } ] : []),
        ...(state.isCaptionSupported ? [ {
            title: t("link_context_menu.show_caption"),
            uiIcon: "bx bx-captions",
            isSwitch: true,
            enabled: state.isCaptionToggleable,
            checked: state.hasCaption,
            handler: () => runEmbedCommand(embed, "toggleContentEmbedCaption", {
                focusCaptionOnShow: true
            })
        } ] : [])
    ];
}

/**
 * The submenu that sets where the embed is placed in the text, with the icon of its position, for
 * content that has positions. Each group is a grid of tiles under its heading, as in the image
 * toolbar's _Image position_ menu.
 */
function getPositionItems(embed: MenuEmbed): MenuItem<CommandNames>[] {
    const position = embed.state.position;
    if (!position) {
        return [];
    }

    const items = POSITION_GROUPS.flatMap((group): MenuItem<CommandNames>[] => [
        { kind: "header", title: t(group.titleKey) },
        {
            kind: "actions",
            className: "tn-menu-tiles tn-menu-actions-cards embed-position-tiles",
            items: group.positions.map(({ value, titleKey }): MenuCommandItem<CommandNames> => ({
                title: t(titleKey),
                uiIcon: POSITION_ICONS[value],
                uiIconSvg: POSITION_TILE_ICONS[value],
                checked: value === position,
                handler: () => runEmbedCommand(embed, "contentEmbedPosition", { value })
            }))
        }
    ]);
    return [ submenuItem({
        title: t("link_context_menu.include_position"),
        uiIcon: POSITION_ICONS[position]
    }, items) ];
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
 * text note open for editing, for a link that the editor can convert. `isExcerpt` is set for a
 * link to blocks of a note.
 */
async function getConvertToEmbedItem(
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    title: string,
    getLinkedEntity: () => Promise<FNote | FAttachment | null>,
    isExcerpt = false
): Promise<ActionItem | null> {
    const link = getTarget(e)?.closest<HTMLElement>("a.reference-link");
    if (!link || !editor?.commands.get("convertLinkToEmbed")?.isEnabled
            || !editor.plugins.get("ContentEmbed").canConvertLinkToEmbed(link)) {
        return null;
    }

    // Imported on demand: `content_renderer` imports `link`, which imports this module.
    const [ entity, { EXCERPT_BOX_SIZE, getEmbedBoxSize } ] = await Promise.all([
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
            boxSize: isExcerpt ? EXCERPT_BOX_SIZE : getEmbedBoxSize(entity)
        })
    };
}

/**
 * The item that converts a reference link to the note `noteId` into an included note, or into an
 * excerpt for a link to blocks of the note, where the editor can convert it.
 */
function getConvertNoteLinkItem(
    e: LinkMenuOrigin,
    editor: CKTextEditor | null,
    noteId: string,
    isBlockReference: boolean
) {
    return getConvertToEmbedItem(
        e, editor, isBlockReference
            ? t("link_context_menu.convert_link_to_note_excerpt")
            : t("link_context_menu.convert_link_to_included_note"),
        () => froca.getNote(noteId),
        isBlockReference
    );
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
    // An editor in read-only mode renders its editable with `contenteditable="false"`.
    if (!element?.closest(".ck-editor__editable[contenteditable='true']")) {
        return null;
    }

    return getTextEditorContaining(element);
}

function getNtxId(e: EventOrigin) {
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
    downloadLinkedAttachment,
    getItems,
    getLinkToolbarEntries,
    getOriginBelow,
    getQuickEditItem,
    getOpenNoteItem,
    handleLinkContextMenuItem,
    openContextMenu,
    openEmbedContextMenu,
    setShareLinkResolver
};
