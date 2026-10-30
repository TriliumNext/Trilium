import type { CommandNames } from "../../../components/app_context";
import contextMenu, { type ContextMenuEvent, type MenuItem } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import { t } from "../../../services/i18n";
import type { PresentationSlideBaseModel, SlideMove } from "./model";

/** The moves that Alt and the arrows make on a slide, each left out where the slide cannot go. */
export interface SlideMenuMoves {
    up?: SlideMove;
    down?: SlideMove;
    toVertical?: SlideMove;
    toTopLevel?: SlideMove;
}

export interface SlideMenuTarget {
    slide: PresentationSlideBaseModel;
    isVertical: boolean;
    /** Left out where the slides cannot be moved, which leaves out the items that move them. */
    moves: SlideMenuMoves | undefined;
    /** Whether the sidebar is in right-to-left text, where vertical slides are indented to the left. */
    isRtl: boolean;
}

export interface SlideMenuActions {
    /** Goes to a slide and edits it in place; left out where the presentation cannot be edited. */
    onEdit?: (noteId: string) => void;
    /** Adds, duplicates and deletes slides; left out where the slides cannot be changed. */
    changes?: {
        addSlideAfter(noteId: string): void;
        addVerticalSlide(noteId: string): void;
        duplicate(noteId: string): void;
        delete(noteId: string): void;
    };
}

/**
 * Opens the context menu of a slide's thumbnail: beside the pointer for a right-click, below the thumbnail
 * when Shift+F10 or the Menu key opened it, as those report no place on the thumbnail.
 */
export function openSlideMenu(
    e: ContextMenuEvent, thumbnail: HTMLElement, target: SlideMenuTarget, actions: SlideMenuActions,
    onMove: (move: SlideMove) => void, onHide: () => void
) {
    const { left, right, top, bottom } = thumbnail.getBoundingClientRect();
    const { clientX = 0, clientY = 0, pageX = 0, pageY = 0 } = e;
    const isOnThumbnail = clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
        && (clientX !== 0 || clientY !== 0);
    const openNoteItem = link_context_menu.getOpenNoteItem({ pageX, pageY, target: thumbnail });

    contextMenu.show<CommandNames>({
        ...(isOnThumbnail ? { x: pageX, y: pageY } : { anchor: thumbnail }),
        items: buildSlideMenuItems(target, actions, onMove, openNoteItem),
        selectMenuItemHandler: ({ command }) => link_context_menu.handleLinkContextMenuItem(
            command, { target: thumbnail }, target.slide.noteId
        ),
        onHide
    });
}

/**
 * Returns the items of a slide's context menu: editing and opening it, adding slides next to it,
 * moving it as Alt and the arrows do, and deleting it. What the presentation does not allow is left
 * out; a move with nowhere to go is disabled, so that the menu shows where the slide can go.
 */
export function buildSlideMenuItems(
    target: SlideMenuTarget, actions: SlideMenuActions, onMove: (move: SlideMove) => void,
    openNoteItem: MenuItem<CommandNames>
): MenuItem<CommandNames>[] {
    const { slide, isVertical, moves, isRtl } = target;
    const { noteId } = slide;
    const { onEdit, changes } = actions;
    const canEditInPlace = (slide.type === "text" || !!slide.isCollection) && !slide.isReadOnly;
    // A board or table shows its children itself, and a vertical slide can have none.
    const canHaveVerticalSlides = !isVertical && !slide.isCollection;
    const [ indentKey, outdentKey ] = isRtl ? [ "Alt+Left", "Alt+Right" ] : [ "Alt+Right", "Alt+Left" ];

    const moveItem = (title: string, uiIcon: string, shortcut: string, move: SlideMove | undefined) => ({
        title, uiIcon, shortcut,
        enabled: !!move,
        handler: () => move && onMove(move)
    });

    const groups: MenuItem<CommandNames>[][] = [
        [
            ...(onEdit ? [ {
                title: t("presentation_view.menu-edit-slide"),
                uiIcon: "bx bx-pencil",
                enabled: canEditInPlace,
                handler: () => onEdit(noteId)
            } ] : []),
            openNoteItem
        ],
        changes ? [
            {
                title: t("presentation_view.menu-new-slide-after"),
                uiIcon: "bx bx-plus",
                handler: () => changes.addSlideAfter(noteId)
            },
            ...(canHaveVerticalSlides ? [ {
                title: t("presentation_view.menu-new-vertical-slide"),
                uiIcon: "bx bx-subdirectory-right",
                handler: () => changes.addVerticalSlide(noteId)
            } ] : []),
            {
                title: t("presentation_view.menu-duplicate"),
                uiIcon: "bx bx-outline",
                handler: () => changes.duplicate(noteId)
            }
        ] : [],
        moves ? [
            moveItem(t("presentation_view.menu-move-up"), "bx bx-up-arrow-alt", "Alt+Up", moves.up),
            moveItem(t("presentation_view.menu-move-down"), "bx bx-down-arrow-alt", "Alt+Down", moves.down),
            isVertical
                ? moveItem(
                    t("presentation_view.menu-make-top-level"), "bx bx-left-indent", outdentKey, moves.toTopLevel
                )
                : moveItem(
                    t("presentation_view.menu-make-vertical"), "bx bx-right-indent", indentKey, moves.toVertical
                )
        ] : [],
        changes ? [ {
            title: t("presentation_view.menu-delete"),
            uiIcon: "bx bx-trash",
            handler: () => changes.delete(noteId)
        } ] : []
    ];

    return groups
        .filter(group => group.length)
        .flatMap((group, index) => index ? [ { kind: "separator" } as MenuItem<CommandNames>, ...group ] : group);
}
