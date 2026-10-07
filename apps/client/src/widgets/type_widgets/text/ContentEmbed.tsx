import clsx from "clsx";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import linkContextMenu from "../../../menus/link_context_menu";
import content_renderer from "../../../services/content_renderer";
import keyboard_actions from "../../../services/keyboard_actions";
import { t } from "../../../services/i18n";
import type { ViewScope } from "../../../services/link";
import { removeIndividualBinding } from "../../../services/shortcuts";
import ActionButton from "../../react/ActionButton";
import { Badge } from "../../react/Badge";
import { useFocusWithin } from "../../react/hooks";
import Icon from "../../react/Icon";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import {
    type ContentEmbedEvent, getContentEmbedTools, showContentEmbedFullscreen,
    useIsContentEmbedEditable, watchContentEmbedTools
} from "./content_embed_tools";
import { findTextEditorAround } from "./editable_embed";

/** An action on the embedded note or attachment, offered as a button in the title row. */
export interface ContentEmbedAction {
    title: string;
    icon: string;
    run: () => void | Promise<void>;
}

export interface ContentEmbedProps {
    boxSize?: string;
    /** The link to the embedded note or attachment, shown as the title. */
    title: HTMLElement;
    /** The rendered note or attachment. */
    content: HTMLElement;
    contentType: string;
    /** The note opened by the buttons in the title row. */
    notePath: string;
    viewScope?: ViewScope;
    /** Whether the embed shows only some blocks of its note, from a block reference. */
    isExcerpt?: boolean;
    /** Gives the focus to the content once mounted, as for a canvas drawing just added. */
    isFocusedOnMount?: boolean;
}

export interface TinyContentEmbedProps {
    icon: string;
    /** The link to the embedded note or attachment, shown as the title. */
    title: HTMLElement;
    /** A line under the title, such as the size of an attachment. */
    description?: string;
    /** The note the "More actions" menu acts on. */
    notePath: string;
    viewScope?: ViewScope;
    /** The buttons before the "More actions" menu. */
    actions: ContentEmbedAction[];
}

/** The title row and the content of an embedded note or attachment. */
export default function ContentEmbed({
    boxSize, title, content, contentType, notePath, viewScope, isExcerpt, isFocusedOnMount
}: ContentEmbedProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const isContentActive = useFocusWithin(contentRef);
    const isDraggedOver = useIsDraggedOver(bodyRef);
    useFullscreenEvents(contentRef);
    useWindowShortcuts(contentRef);
    const [ isExpanded, setIsExpanded ] = useState(false);
    const isExpandable = boxSize === "expandable";
    const hasFullscreen = !isExcerpt && (boxSize === "medium" || boxSize === "full");

    useLayoutEffect(() => {
        contentRef.current?.append(content);
        return () => {
            content_renderer.disposeInteractiveContent($(content));
            content.remove();
        };
    }, [ content ]);

    useLayoutEffect(() => {
        // The box mounts after an upload, by which time the focus can have left the editor.
        const editable = contentRef.current?.closest(".ck-editor__editable");
        if (isFocusedOnMount && (!editable || editable.contains(document.activeElement))) {
            (content.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? contentRef.current)?.focus();
        }
    }, []);

    return (
        <>
            <div
                className="include-note-title-row"
                onContextMenu={(e) => openMenuOnRightClick(e, notePath, viewScope)}
            >
                {isExpandable && (
                    <ActionButton
                        className={clsx("include-note-toggle", isExpanded && "expanded")}
                        icon="bx bx-chevron-right"
                        text=""
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                    />
                )}
                <ContentEmbedTitle title={title} />
                {/* The content of the embed puts badges here, such as its save status. */}
                <div className="note-badges include-note-badges">
                    {isExcerpt && <ExcerptBadge />}
                </div>
                <ContentEmbedActionButton
                    className="include-note-open"
                    action={getOpenInNewTabAction(notePath, viewScope)}
                />
                {isExcerpt && (
                    <ExcerptEditButton
                        contentRef={contentRef}
                        content={content}
                        onEdit={() => setIsExpanded(true)}
                    />
                )}
                {hasFullscreen && (
                    <ActionButton
                        className="include-note-fullscreen"
                        icon="bx bx-fullscreen"
                        text={t("common.fullscreen")}
                        onClick={(e) => {
                            e.stopPropagation();
                            showContentEmbedFullscreen(contentRef.current);
                        }}
                    />
                )}
                <MoreActionsButton notePath={notePath} viewScope={viewScope} />
            </div>
            <div
                ref={bodyRef}
                className={clsx("include-note-body", isContentActive && "active")}
            >
                <div
                    ref={contentRef}
                    className={`include-note-content type-${contentType}`}
                    hidden={isExpandable && !isExpanded}
                    tabIndex={-1}
                >
                    {hasFullscreen && (
                        <div className="include-note-fullscreen-controls">
                            <OverlayControlGroup
                                placement="top-end"
                                className="include-note-exit-fullscreen"
                            >
                                <OverlayControlButton
                                    icon="bx-exit"
                                    text={t("common.exit_fullscreen")}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        document.exitFullscreen().catch((error: unknown) => {
                                            console.warn("Could not leave fullscreen:", error);
                                        });
                                    }}
                                />
                            </OverlayControlGroup>
                        </div>
                    )}
                </div>
                {!isContentActive && !isDraggedOver && (
                    <div
                        className="include-note-backdrop"
                        onClick={(e) => {
                            const content = contentRef.current;
                            if (!content) return;
                            getFocusTargetAt(content, e.clientX, e.clientY)
                                .focus({ preventScroll: true });
                        }}
                    />
                )}
            </div>
        </>
    );
}

/** A tiny embed: a single row with an icon, the title and the actions, and no content. */
export function TinyContentEmbed({
    icon, title, description, notePath, viewScope, actions
}: TinyContentEmbedProps) {
    return (
        <div
            className="include-note-title-row"
            onContextMenu={(e) => openMenuOnRightClick(e, notePath, viewScope)}
        >
            <Icon className="include-note-icon" icon={icon} />
            <div className="include-note-heading">
                <ContentEmbedTitle title={title} />
                {description && <small className="include-note-description">{description}</small>}
            </div>
            {actions.map((action) => (
                <ContentEmbedActionButton
                    key={action.title}
                    className="include-note-action"
                    action={action}
                />
            ))}
            <MoreActionsButton notePath={notePath} viewScope={viewScope} />
        </div>
    );
}

/** The buttons of a tiny embed of a note: "Quick edit" and "Open in new tab". */
export function getNoteActions(notePath: string): ContentEmbedAction[] {
    return [
        {
            title: t("link_context_menu.open_note_in_popup"),
            icon: "bx bx-edit",
            run: () => {
                appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
            }
        },
        getOpenInNewTabAction(notePath)
    ];
}

function getOpenInNewTabAction(notePath: string, viewScope?: ViewScope): ContentEmbedAction {
    return {
        title: t("common.open_in_new_tab"),
        icon: OPEN_IN_NEW_TAB_ICON,
        run: async () => {
            await appContext.tabManager.openTabWithNoteWithHoisting(notePath, {
                viewScope,
                activate: true,
                placement: "afterCurrent"
            });
        }
    };
}

const OPEN_IN_NEW_TAB_ICON = "bx bx-link-external";

/** Marks an embed that shows only some blocks of its note, a block reference. */
function ExcerptBadge() {
    return (
        <Badge
            className="excerpt-badge"
            icon="bx bx-crop"
            text={t("block_reference.excerpt")}
            tooltip={t("block_reference.excerpt_description", {
                icon: `<span class="${OPEN_IN_NEW_TAB_ICON}"></span>`
            })}
        />
    );
}

/**
 * Turns the editing of an excerpt on and off, as the Editable toggle of its embed does. Disabled
 * while the content has no editable mode, as in a read-only note or for blocks that cannot be
 * edited in place. Opening the editor gives it the focus, and `onEdit` runs first.
 */
function ExcerptEditButton({ contentRef, content, onEdit }: {
    contentRef: RefObject<HTMLDivElement | null>;
    content: HTMLElement;
    onEdit: () => void;
}) {
    const isEditing = useIsContentEmbedEditable(contentRef);
    const hasEditableMode = useHasEditableMode(contentRef, content);

    return (
        <ActionButton
            className="include-note-edit"
            icon="bx bx-pencil"
            text={t("block_reference.edit_excerpt")}
            active={hasEditableMode && isEditing}
            disabled={!hasEditableMode}
            onClick={(e) => {
                e.stopPropagation();
                const box = contentRef.current;
                const editor = findTextEditorAround(box);
                if (!box || !editor?.plugins.get("ContentEmbed").selectEmbedAt(box)) return;

                editor.execute("toggleContentEmbedEditable");
                if (isEditing) {
                    editor.editing.view.focus();
                } else {
                    onEdit();
                    // `useEditableEmbed()` moves the focus on to the editor once it renders.
                    box.focus({ preventScroll: true });
                }
            }}
        />
    );
}

/**
 * Whether the content in `contentRef` has an editable mode, which it tells by adding the Editable
 * toggle to its embed, and a text editor holds the embed to turn it on. Checked again for new
 * `content`, which can add the toggle before it is in the box.
 */
function useHasEditableMode(contentRef: RefObject<HTMLElement | null>, content: HTMLElement) {
    const [ hasEditableMode, setHasEditableMode ] = useState(false);

    useEffect(() => {
        const box = contentRef.current;
        if (!box) return;

        const update = () => setHasEditableMode(
            !!getContentEmbedTools(box)?.hasEditableFlag && !!findTextEditorAround(box)
        );
        update();
        return watchContentEmbedTools(box, update);
    }, [ contentRef, content ]);

    return hasEditableMode;
}

const FOCUSABLE_SELECTOR = "[tabindex], a[href], iframe, webview, "
    + ":is(button, input, select, textarea):not(:disabled)";

/**
 * The element that a click at (`x`, `y`) would focus: the closest focusable element under that
 * point in `content`, which is focusable itself.
 */
function getFocusTargetAt(content: HTMLElement, x: number, y: number) {
    const hit = document.elementsFromPoint(x, y).find((element) => content.contains(element));
    return hit?.closest<HTMLElement>(FOCUSABLE_SELECTOR) ?? content;
}

function ContentEmbedTitle({ title }: { title: HTMLElement }) {
    const titleRef = useRef<HTMLHeadingElement>(null);

    useLayoutEffect(() => {
        titleRef.current?.replaceChildren(title);
    }, [ title ]);

    return <h4 ref={titleRef} className="include-note-title" />;
}

function ContentEmbedActionButton({ className, action }: {
    className: string;
    action: ContentEmbedAction;
}) {
    return (
        <ActionButton
            className={className}
            icon={action.icon}
            text={action.title}
            onClick={(e) => {
                e.stopPropagation();
                void action.run();
            }}
        />
    );
}

/**
 * Opens the menu of the embed for a right click on its title row. The title link is left to the
 * handler of every link, which opens the same menu, or a quick edit with Ctrl.
 */
/**
 * Runs the window shortcuts, such as switching tabs, from inside the content. The text editor
 * keeps the keys pressed in an embed from the document, where these shortcuts listen.
 */
function useWindowShortcuts(contentRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;

        const bindings = keyboard_actions.setupWindowShortcutsForElement($(content));
        return () => {
            void bindings.then((bound) => {
                for (const binding of bound) {
                    removeIndividualBinding(binding);
                }
            });
        };
    }, [ contentRef ]);
}

/**
 * Whether something is dragged over the body of the embed, which then lets the drag reach the
 * content under the backdrop, such as the editor of an included note.
 */
function useIsDraggedOver(bodyRef: RefObject<HTMLElement | null>) {
    const [ isDraggedOver, setIsDraggedOver ] = useState(false);

    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;

        const enter = () => setIsDraggedOver(true);
        const end = () => setIsDraggedOver(false);
        // A `dragleave` also fires when the drag moves between the elements of the body.
        const leave = (event: DragEvent) => {
            const { left, top, right, bottom } = body.getBoundingClientRect();
            const { clientX: x, clientY: y } = event;
            if (x < left || x >= right || y < top || y >= bottom) {
                end();
            }
        };
        body.addEventListener("dragenter", enter);
        body.addEventListener("dragleave", leave);
        body.addEventListener("drop", end, true);
        document.addEventListener("dragend", end);
        return () => {
            body.removeEventListener("dragenter", enter);
            body.removeEventListener("dragleave", leave);
            body.removeEventListener("drop", end, true);
            document.removeEventListener("dragend", end);
        };
    }, [ bodyRef ]);

    return isDraggedOver;
}

/**
 * Dispatches `fullscreenChangeStart` on the content box as it enters or leaves fullscreen, then
 * `enterFullscreen` or `leaveFullscreen` once it has the size that fullscreen gives or takes back.
 */
function useFullscreenEvents(contentRef: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const content = contentRef.current;
        if (!content) return;

        let isFullscreen = document.fullscreenElement === content;
        let observer: ResizeObserver | undefined;
        const onFullscreenChange = () => {
            if ((document.fullscreenElement === content) === isFullscreen) return;
            isFullscreen = !isFullscreen;
            const name: ContentEmbedEvent = isFullscreen ? "enterFullscreen" : "leaveFullscreen";
            content.dispatchEvent(new Event("fullscreenChangeStart", { bubbles: true }));

            // Created after the observers of the content, such as Excalidraw's, so it runs after
            // them, once they have read the new size.
            observer?.disconnect();
            observer = new ResizeObserver(() => {
                observer?.disconnect();
                content.dispatchEvent(new Event(name, { bubbles: true }));
            });
            observer.observe(content);
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            observer?.disconnect();
        };
    }, [ contentRef ]);
}

function openMenuOnRightClick(e: MouseEvent, notePath: string, viewScope?: ViewScope) {
    if (e.target instanceof Element && e.target.closest("a")) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();
    void linkContextMenu.openContextMenu(notePath, e, viewScope);
}

function MoreActionsButton({ notePath, viewScope }: { notePath: string; viewScope?: ViewScope }) {
    return (
        <ActionButton
            className="include-note-menu"
            icon="bx bx-dots-vertical-rounded"
            text={t("common.more_actions")}
            onClick={(e) => {
                e.stopPropagation();
                const origin = linkContextMenu.getOriginBelow(e.currentTarget);
                void linkContextMenu.openContextMenu(notePath, origin, viewScope);
            }}
        />
    );
}
