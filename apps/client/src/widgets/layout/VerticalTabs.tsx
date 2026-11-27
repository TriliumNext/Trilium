import "./VerticalTabs.css";

import clsx from "clsx";
import { type CSSProperties, Fragment, type TargetedDragEvent, type TargetedMouseEvent, type TargetedPointerEvent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext, { type CommandNames, type EventData, type EventNames } from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import attributeService from "../../services/attributes";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { buildTabTitle, noteTitleHtml, type TabTitleSegment, TAB_TITLE_SEPARATOR } from "../../services/tab_title";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useTriliumEvent, useTriliumEvents } from "../react/hooks/events";
import { useNoteColorClass, useNoteIcon } from "../react/hooks/note";
import { useStaticTooltip } from "../react/hooks/tooltip";
import Icon from "../react/Icon";
import { getTabContextMenuItems } from "../tab_row";

/**
 * The tabs as a list above the note tree: the pinned tabs as a grid of icons at the top, the other
 * tabs below them as rows, and a row that opens a new tab. The list takes the height it needs, up to
 * a share of the pane, until the handle below it is dragged to a height of its own.
 */
export default function VerticalTabs() {
    const { tabs, activeNtxId, version, refresh } = useTabs();
    const { height, sectionRef, resizerProps } = useSectionResizer();
    const { dragProps, dropIndicator } = useTabReordering(tabs, refresh);
    const pinnedTabs = tabs.filter((tab) => tab.pinned);
    const unpinnedTabs = tabs.filter((tab) => !tab.pinned);

    const renderTab = (noteContext: NoteContext) => (
        <VerticalTab
            key={noteContext.ntxId}
            noteContext={noteContext}
            active={noteContext.ntxId === activeNtxId}
            version={version}
            dropIndicator={dropIndicator?.ntxId === noteContext.ntxId ? dropIndicator.position : undefined}
            {...dragProps(noteContext)}
        />
    );

    return (
        <nav
            ref={sectionRef}
            className={clsx("vertical-tabs", height !== undefined && "sized")}
            aria-label={t("tab_row.tabs")}
            style={height !== undefined ? { "--vertical-tabs-height": `${height}px` } as CSSProperties : undefined}
        >
            <div className="vertical-tabs-list" role="tablist" aria-orientation="vertical">
                {pinnedTabs.length > 0 && (
                    <div className="vertical-tabs-pinned">{pinnedTabs.map(renderTab)}</div>
                )}
                {unpinnedTabs.map(renderTab)}
                <Button
                    className="vertical-tabs-new-tab"
                    kind="lowProfile"
                    icon="bx bx-plus"
                    text={t("tab_row.new_tab")}
                    triggerCommand="openNewTab"
                />
            </div>
            <div className="vertical-tabs-resizer" role="separator" aria-orientation="horizontal" {...resizerProps} />
        </nav>
    );
}

function VerticalTab({ noteContext, active, version, dropIndicator, ...dragHandlers }: {
    noteContext: NoteContext;
    active: boolean;
    version: number;
    dropIndicator: "before" | "after" | undefined;
} & TabDragHandlers) {
    const tabRef = useRef<HTMLDivElement>(null);
    const subContexts = noteContext.getSubContexts();
    const focusedNtxId = getFocusedNtxId(noteContext, subContexts);
    const note = (subContexts.find((ctx) => ctx.ntxId === focusedNtxId) ?? noteContext).note;
    const icon = useNoteIcon(note);
    const colorClass = useNoteColorClass(note);
    const title = useTabTitle(noteContext, subContexts, focusedNtxId, version);
    const workspaceColor = froca.getNoteFromCache(noteContext.hoistedNoteId)?.getWorkspaceTabBackgroundColor();
    const { pinned } = noteContext;
    const tooltipHtml = pinned ? title?.tooltipHtml : undefined;
    useStaticTooltip(tabRef, useMemo(() => (tooltipHtml
        ? { title: tooltipHtml, html: true, placement: "right" as const }
        : undefined), [ tooltipHtml ]));

    const onMouseUp = useCallback((e: TargetedMouseEvent<HTMLDivElement>) => {
        if (e.button === 1) {
            void appContext.tabManager.removeNoteContext(noteContext.ntxId);
        }
    }, [ noteContext ]);

    const onContextMenu = useCallback(async (e: TargetedMouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const { pageX: x, pageY: y } = e;
        const { default: contextMenu } = await import("../../menus/context_menu");
        contextMenu.show<CommandNames>({
            x,
            y,
            items: getTabContextMenuItems(noteContext.ntxId ?? undefined),
            selectMenuItemHandler: ({ command }) => {
                if (command) {
                    void appContext.triggerCommand(command, { ntxId: noteContext.ntxId });
                }
            }
        });
    }, [ noteContext ]);

    return (
        <div
            ref={tabRef}
            className={clsx("vertical-tab", colorClass, {
                active,
                pinned,
                "drop-before": dropIndicator === "before",
                "drop-after": dropIndicator === "after"
            })}
            role="tab"
            aria-selected={active}
            aria-label={pinned ? title?.tooltip : undefined}
            tabIndex={active ? 0 : -1}
            style={workspaceColor ? { "--workspace-tab-background-color": workspaceColor } as CSSProperties : undefined}
            onClick={() => appContext.tabManager.activateNoteContext(noteContext.ntxId)}
            onMouseUp={onMouseUp}
            onContextMenu={onContextMenu}
            {...dragHandlers}
        >
            <Icon className="vertical-tab-icon" icon={note ? icon : "bx bx-plus"} />
            {!pinned && <>
                <span className="vertical-tab-title">
                    {title?.segments.map((segment, index) => (
                        <Fragment key={index}>
                            {index > 0 && TAB_TITLE_SEPARATOR}
                            <span
                                className={clsx("vertical-tab-segment", { active: segment.active && title.segments.length > 1 })}
                                dangerouslySetInnerHTML={{ __html: segment.html }}
                            />
                        </Fragment>
                    ))}
                </span>
                <ActionButton
                    className="vertical-tab-close"
                    icon="bx bx-x"
                    text={t("tab_row.close_tab")}
                    onClick={(e) => {
                        e.stopPropagation();
                        void appContext.tabManager.removeNoteContext(noteContext.ntxId);
                    }}
                />
            </>}
        </div>
    );
}

const TAB_EVENTS: EventNames[] = [
    "newNoteContextCreated", "noteContextRemoved", "activeContextChanged", "noteSwitched",
    "noteSwitchedAndActivated", "noteContextReorder", "contextsReopened", "tabPinStateChanged",
    "tabsRestored", "hoistedNoteChanged", "frocaReloaded"
];

const TAB_ATTRIBUTES = [ "workspace", "iconClass", "workspaceIconClass", "workspaceTabBackgroundColor" ];

/**
 * The tabs in their order and the active one, read again on every event that can change them.
 * `version` changes with each read, so that a tab whose `NoteContext` is the same object renders again.
 */
function useTabs() {
    const [ version, setVersion ] = useState(0);
    const refresh = useCallback(() => setVersion((v) => v + 1), []);
    useTriliumEvents(TAB_EVENTS, refresh);
    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }: EventData<"entitiesReloaded">) => {
        const affectsTab = appContext.tabManager.noteContexts.some((noteContext) => noteContext.noteId && (
            loadResults.isNoteReloaded(noteContext.noteId)
            || loadResults.getAttributeRows().some((attr) => TAB_ATTRIBUTES.includes(attr.name ?? "")
                && attributeService.isAffecting(attr, noteContext.note))
        ));
        if (affectsTab) refresh();
    }, [ refresh ]));

    const tabManager = appContext.tabManager;
    return {
        tabs: tabManager?.getMainNoteContexts() ?? [],
        activeNtxId: tabManager?.getActiveContext()?.getMainContext().ntxId,
        version,
        refresh
    };
}

/** The title of a tab, one segment per split, resolved again whenever `version` changes. */
function useTabTitle(noteContext: NoteContext, subContexts: NoteContext[], focusedNtxId: string | null, version: number) {
    const [ title, setTitle ] = useState<{ segments: TabTitleSegment[], tooltip: string, tooltipHtml: string }>();

    useEffect(() => {
        let stale = false;
        void Promise.all(subContexts.map(async (ctx) => ({
            title: ctx.note ? await ctx.getNavigationTitle() : null,
            html: ctx.note && !ctx.note.isContentAvailable() ? noteTitleHtml(ctx.note) : undefined,
            active: !!ctx.ntxId && ctx.ntxId === focusedNtxId
        }))).then((splits) => {
            if (stale) return;
            setTitle(buildTabTitle(splits, t("tab_row.new_tab"), {
                pinnedPrefix: noteContext.pinned ? t("tab_row.pinned_prefix") : undefined
            }));
        });
        return () => {
            stale = true;
        };
        // `version` stands for every change of the tab that the arguments do not show.
    }, [ noteContext, version ]);

    return title;
}

/** The split a tab shows: its last focused split if that is still open, else its main split. */
function getFocusedNtxId(mainContext: NoteContext, subContexts: NoteContext[]) {
    const remembered = mainContext.lastActiveNtxId;
    if (remembered && subContexts.some((ctx) => ctx.ntxId === remembered)) {
        return remembered;
    }
    return mainContext.ntxId;
}

type TabDragHandlers = {
    draggable: boolean;
    onDragStart: (e: TargetedDragEvent<HTMLDivElement>) => void;
    onDragOver: (e: TargetedDragEvent<HTMLDivElement>) => void;
    onDragLeave: () => void;
    onDrop: (e: TargetedDragEvent<HTMLDivElement>) => Promise<void>;
    onDragEnd: () => void;
};

const TAB_DRAG_TYPE = "application/x-trilium-tab";

/**
 * Reordering by drag and drop. A tab drops before or after another of its own group, pinned or not,
 * and the new order goes to `TabManager` through `tabReorder`.
 */
function useTabReordering(tabs: NoteContext[], refresh: () => void) {
    const [ draggedNtxId, setDraggedNtxId ] = useState<string | null>(null);
    const [ dropIndicator, setDropIndicator ] = useState<{ ntxId: string, position: "before" | "after" } | null>(null);

    const finish = useCallback(() => {
        setDraggedNtxId(null);
        setDropIndicator(null);
    }, []);

    const dragProps = (target: NoteContext): TabDragHandlers => ({
        draggable: true,
        onDragStart(e) {
            if (!target.ntxId || !e.dataTransfer) return;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData(TAB_DRAG_TYPE, target.ntxId);
            setDraggedNtxId(target.ntxId);
        },
        onDragOver(e) {
            const dragged = tabs.find((tab) => tab.ntxId === draggedNtxId);
            if (!dragged || !target.ntxId || dragged === target || dragged.pinned !== target.pinned) return;
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const position = target.pinned
                ? (e.clientX < rect.left + rect.width / 2 ? "before" : "after")
                : (e.clientY < rect.top + rect.height / 2 ? "before" : "after");
            if (dropIndicator?.ntxId !== target.ntxId || dropIndicator.position !== position) {
                setDropIndicator({ ntxId: target.ntxId, position });
            }
        },
        onDragLeave() {
            setDropIndicator(null);
        },
        async onDrop(e) {
            e.preventDefault();
            const indicator = dropIndicator;
            finish();
            if (!draggedNtxId || !indicator) return;

            const order = tabs.map((tab) => tab.ntxId).filter((ntxId): ntxId is string => !!ntxId && ntxId !== draggedNtxId);
            const targetIndex = order.indexOf(indicator.ntxId);
            order.splice(indicator.position === "before" ? targetIndex : targetIndex + 1, 0, draggedNtxId);
            await appContext.triggerEvent("tabReorder", { ntxIdsInOrder: order });
            refresh();
        },
        onDragEnd: finish
    });

    return { dragProps, dropIndicator };
}

const MIN_SECTION_HEIGHT = 48;
const MIN_TREE_HEIGHT = 120;

/**
 * The height the tabs take once their handle is dragged, kept between `MIN_SECTION_HEIGHT` and what
 * leaves `MIN_TREE_HEIGHT` to the tree. A double click on the handle lets the list size itself again.
 */
function useSectionResizer() {
    const sectionRef = useRef<HTMLElement>(null);
    const [ height, setHeight ] = useState<number>();

    const onPointerDown = useCallback((e: TargetedPointerEvent<HTMLDivElement>) => {
        const section = sectionRef.current;
        const pane = section?.parentElement;
        if (!section || !pane || e.button !== 0) return;
        e.preventDefault();

        const handle = e.currentTarget;
        const startY = e.clientY;
        const startHeight = section.getBoundingClientRect().height;
        const maxHeight = pane.getBoundingClientRect().bottom - section.getBoundingClientRect().top - MIN_TREE_HEIGHT;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add("dragging");

        const onMove = (moveEvent: PointerEvent) => {
            const next = startHeight + moveEvent.clientY - startY;
            setHeight(Math.round(Math.max(MIN_SECTION_HEIGHT, Math.min(next, maxHeight))));
        };
        const onUp = () => {
            handle.classList.remove("dragging");
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup", onUp);
            handle.removeEventListener("pointercancel", onUp);
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
    }, []);

    return {
        height,
        sectionRef,
        resizerProps: {
            onPointerDown,
            onDblClick: () => setHeight(undefined)
        }
    };
}
