import "./RightPaneContent.css";

import clsx from "clsx";
import type { RefObject, VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import appContext from "../../components/app_context";
import type { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useLegacyWidget } from "../react/hooks/legacy";
import { useNoteProperty } from "../react/hooks/note";
import { useTriliumOptionBool, useTriliumOptionJson } from "../react/hooks/options";
import { useActiveNoteContext, useGetContextData } from "../react/hooks/tree";
import LazyComponent from "../react/LazyComponent";
import NoItems from "../react/NoItems";
import type { PaneMode } from "../react/peek_pane";
import type LegacyRightPanelWidget from "../right_panel_widget";
import AttributeList from "./AttributeList";
import Backlinks from "./Backlinks";
import BoardColumns from "./BoardColumns";
import ChatHighlightsList from "./ChatHighlightsList";
import HighlightsList from "./HighlightsList";
import NoteMap from "./NoteMap";
import NotePaths from "./NotePaths";
import PdfAnnotations from "./pdf/PdfAnnotations";
import PdfAttachments from "./pdf/PdfAttachments";
import PdfLayers from "./pdf/PdfLayers";
import PdfPages from "./pdf/PdfPages";
import RightPanelWidget, { CollapsibleWidgets, ExpandWidgetRequest, ExpandWidgetRequests, StackedWidgets, TabHeaderSlot } from "./RightPanelWidget";
import RightPaneTabs, { RIGHT_PANE_TABS, RightPaneTabDefinition, RightPaneTabId } from "./RightPaneTabs";
import TableOfContents from "./TableOfContents";

export interface RightPanelWidgetDefinition {
    el: VNode;
    enabled: boolean;
    position?: number;
    /** Which tab of the pane the widget belongs in. */
    tab: RightPaneTabId;
}

export interface RightPaneTabContents extends RightPaneTabDefinition {
    /** The enabled widgets of this tab, in the order they are shown. Empty only for an always-shown tab. */
    items: VNode[];
}

/**
 * What the right pane shows once opened: its header with the tab strip and its actions, and the
 * tabs' bodies. `RightPanelContainer` imports this module the first time the pane opens, so a pane
 * kept closed loads none of its widgets.
 */
export default function RightPaneContent({ mode, selectedTabId, setSelectedTabId, expandRequest, activeTabIdRef, dock, close, widgetsByParent }: {
    mode: PaneMode;
    /** The tab last chosen, as the `rightPaneSelectedTab` option holds it. */
    selectedTabId: string;
    setSelectedTabId: (tabId: RightPaneTabId) => void;
    expandRequest: ExpandWidgetRequest | null;
    /** Where the pane learns which tab is on show, which a tab chosen for another note can differ from. */
    activeTabIdRef: RefObject<RightPaneTabId | undefined>;
    dock: () => void;
    close: () => void;
    widgetsByParent?: WidgetsByParent;
}) {
    const tabs = useRightPaneTabs(true, widgetsByParent);

    // The chosen tab may have nothing to show for this note (or may have gone away entirely, e.g. the
    // chat once AI is switched off), in which case the first one that does stands in — without
    // overwriting the choice, so it is back as soon as the note has that tab again.
    const activeTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];
    useLayoutEffect(() => {
        activeTabIdRef.current = activeTab?.id;
    });

    return (
        <>
            {/* One flex row holding the tab strip and the pane's own actions, so a
                narrow pane shrinks the strip instead of sliding it under the buttons
                (see RightPanelContainer.css). */}
            <div class="right-pane-header">
                {tabs.length > 0 && (
                    <RightPaneTabs
                        tabs={tabs}
                        activeTabId={activeTab?.id}
                        onSelect={setSelectedTabId}
                    />
                )}
                <div class="right-pane-actions">
                    {/* Pin only applies while peeking (it docks the pane); close shows in both modes. */}
                    {mode === "peek" && <ActionButton icon="bx bx-pin" text={t("right_pane.dock")} onClick={dock} />}
                    <ActionButton icon="bx bx-x" text={t("right_pane.close")} onClick={close} />
                </div>
            </div>
            {tabs.length > 0 ? (
                <RightPaneTabBodies tabs={tabs} activeTabId={activeTab?.id} expandRequest={expandRequest} />
            ) : (
                <NoItems
                    icon="bx bx-sidebar"
                    text={t("right_pane.empty_message")}
                >
                    {/* The peek auto-closes (outside click / focus loss / Esc), so a manual hide button is redundant there. */}
                    {mode !== "peek" && (
                        <Button
                            text={t("right_pane.empty_button")}
                            triggerCommand="toggleRightPane"
                        />
                    )}
                </NoItems>
            )}
        </>
    );
}

/**
 * The bodies of the pane's tabs, all but the active one hidden. A tab's widgets are mounted when it is
 * first opened and kept mounted afterwards: switching back is instant and keeps its state (a chat in
 * progress), and a tab never opened costs nothing, which keeps the LLM chat's bundle out until it is
 * asked for.
 *
 * A `flat` tab scrolls as a whole, its widgets stacked at their content's height with nothing to
 * collapse, as the mobile note panel lays it out.
 */
export function RightPaneTabBodies({ tabs, activeTabId, expandRequest, flat, headerSlots }: {
    tabs: RightPaneTabContents[];
    activeTabId?: RightPaneTabId;
    expandRequest?: ExpandWidgetRequest | null;
    flat?: boolean;
    /** Per tab, the host's header element its widgets put their controls in (see `TabHeaderSlot`). */
    headerSlots?: Partial<Record<RightPaneTabId, HTMLElement | null>>;
}) {
    const openedTabs = useRef(new Set<RightPaneTabId>());
    if (activeTabId) {
        openedTabs.current.add(activeTabId);
    }

    return tabs.filter((tab) => openedTabs.current.has(tab.id)).map((tab) => (
        <div
            key={tab.id}
            role="tabpanel"
            data-tab-id={tab.id}
            class={clsx(flat ? "right-pane-flat-tab-body" : "right-pane-tab-body", tab.id !== activeTabId && "hidden-ext")}
        >
            {/* Collapsing the only widget of a tab would leave the tab empty, so a tab of one offers
                no collapsing at all. */}
            <CollapsibleWidgets.Provider value={!flat && tab.items.length > 1}>
                <StackedWidgets.Provider value={!!flat && tab.items.length > 1}>
                    <ExpandWidgetRequests.Provider value={expandRequest ?? null}>
                        <TabHeaderSlot.Provider value={headerSlots?.[tab.id] ?? null}>
                            {tab.items.length > 0 ? tab.items : (
                                // A tab that stays for a note it has nothing to show
                                // (see RightPaneTabDefinition.alwaysShown) says so.
                                <NoItems icon={tab.icon} text={t("right_pane.empty_message")} />
                            )}
                        </TabHeaderSlot.Provider>
                    </ExpandWidgetRequests.Provider>
                </StackedWidgets.Provider>
            </CollapsibleWidgets.Provider>
        </div>
    ));
}

/**
 * The pane's tabs with the widgets enabled for the active note, or none while `rightPaneVisible` is
 * false. Shared by the desktop pane and the mobile note panel.
 */
export function useRightPaneTabs(rightPaneVisible: boolean, widgetsByParent: WidgetsByParent | undefined): RightPaneTabContents[] {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const [ highlightsList ] = useTriliumOptionJson<string[]>("highlightsList");
    // Published by the LLM chat; drives the chat highlights widget's visibility (only shown once
    // the chat has at least one highlight).
    const chatHighlights = useGetContextData("chatHighlights");
    // Published by a board, which is what says the note is being shown as one.
    const boardColumns = useGetContextData("boardColumns");
    // Subscribe to the AI toggle so the LLM chat is added/removed reactively without a page reload.
    const [ aiEnabled ] = useTriliumOptionBool("aiEnabled");
    const isPdf = noteType === "file" && noteMime === "application/pdf";

    if (!rightPaneVisible) return [];
    const definitions: RightPanelWidgetDefinition[] = [
        {
            el: <AttributeList />,
            enabled: !!note,
            tab: "attributes"
        },
        {
            // The map goes above the lists rather than under them: it is the one card of the tab
            // that is a picture of the whole rather than a list of a part of it, which reads as a
            // heading over them rather than as a block wedged below.
            //
            // The card is rendered here and only the map within it loaded on demand (force-graph is
            // kept out of the boot bundle), so that the card stays a child of the tab body — see
            // NoteMap.tsx.
            el: <NoteMap />,
            enabled: !!note,
            tab: "connections"
        },
        {
            // Where the note sits in the tree, above what points at it: placements first, then the
            // backlinks below.
            el: <NotePaths />,
            enabled: !!note,
            tab: "connections"
        },
        {
            el: <Backlinks />,
            enabled: !!note,
            tab: "connections"
        },
        {
            el: <TableOfContents />,
            enabled: (noteType === "text" || isPdf || noteType === "llmChat" || !!note?.isMarkdown()),
            tab: "outline"
        },
        {
            el: <PdfPages />,
            enabled: isPdf,
            tab: "outline"
        },
        {
            el: <PdfAttachments />,
            enabled: isPdf,
            tab: "outline"
        },
        {
            el: <PdfLayers />,
            enabled: isPdf,
            tab: "outline"
        },
        {
            el: <PdfAnnotations />,
            enabled: isPdf,
            tab: "outline"
        },
        {
            el: <HighlightsList />,
            enabled: (noteType === "text" || !!note?.isMarkdown()) && highlightsList.length > 0,
            tab: "outline"
        },
        {
            el: <BoardColumns />,
            // Gated on being a board rather than on having columns, so that a board with none of
            // them shows the card's own empty state.
            enabled: boardColumns !== undefined,
            tab: "outline"
        },
        {
            el: <ChatHighlightsList />,
            enabled: noteType === "llmChat" && (chatHighlights?.highlights.length ?? 0) > 0,
            tab: "outline"
        },
        {
            // Loaded lazily because the chat pulls in the whole LLM + CKEditor graph,
            // which users without the LLM experimental feature should never download.
            el: <LazyComponent loader={() => import("./SidebarChat.jsx")} />,
            enabled: noteType !== "llmChat" && aiEnabled,
            position: 1000,
            tab: "chat"
        },
        ...(widgetsByParent?.getLegacyWidgets("right-pane") ?? []).map((widget) => ({
            el: <CustomLegacyWidget key={widget._noteId} originalWidget={widget as LegacyRightPanelWidget} />,
            enabled: true,
            position: widget.position,
            tab: "widgets" as const
        })),
        ...(widgetsByParent?.getPreactWidgets("right-pane") ?? []).map((widget) => {
            const El = widget.render;
            return {
                el: <El />,
                enabled: true,
                position: widget.position,
                tab: "widgets" as const
            };
        })
    ];

    // A note-less pane (an empty tab) keeps its own empty state rather than an outline with nothing in
    // it: there is no navigating between notes to keep the strip still for.
    return groupIntoTabs(definitions, !!note);
}

/**
 * Splits the enabled widgets into the pane's tabs, each in position order. A tab with no enabled widget
 * is dropped rather than shown empty, which is what makes the strip follow the note: a plain image note
 * offers attributes alone, a PDF the whole outline.
 *
 * @param keepAlwaysShown keeps the tabs that ask to stay (see {@link RightPaneTabDefinition.alwaysShown})
 *                        even with nothing to show, for the caller to fill with a word to that effect.
 */
export function groupIntoTabs(definitions: RightPanelWidgetDefinition[], keepAlwaysShown = false): RightPaneTabContents[] {
    // Assign a position to items that don't have one yet.
    let pos = 10;
    for (const definition of definitions) {
        if (!definition.position) {
            definition.position = pos;
            pos += 10;
        }
    }

    const enabled = definitions
        .filter(e => e.enabled)
        .toSorted((a, b) => (a.position ?? 10) - (b.position ?? 10));

    return RIGHT_PANE_TABS
        .map((tab) => ({ ...tab, items: enabled.filter((e) => e.tab === tab.id).map((e) => e.el) }))
        .filter((tab) => tab.items.length > 0 || (keepAlwaysShown && tab.alwaysShown));
}

function CustomLegacyWidget({ originalWidget }: { originalWidget: LegacyRightPanelWidget }) {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
        <RightPanelWidget
            id={originalWidget._noteId}
            title={originalWidget.widgetTitle}
            containerRef={containerRef}
            contextMenuItems={[
                {
                    title: t("right_pane.custom_widget_go_to_source"),
                    uiIcon: "bx bx-code-curly",
                    handler: () => appContext.tabManager.openInNewTab(originalWidget._noteId, null, true)
                }
            ]}
        >
            <CustomWidgetContent originalWidget={originalWidget} />
        </RightPanelWidget>
    );
}

function CustomWidgetContent({ originalWidget }: { originalWidget: LegacyRightPanelWidget }) {
    const { noteContext } = useActiveNoteContext();
    const [ el ] = useLegacyWidget(() => {
        originalWidget.contentSized();

        // Monkey-patch the original widget by replacing the default initialization logic.
        originalWidget.doRender = function doRender(this: LegacyRightPanelWidget) {
            this.$widget = $("<div>");
            this.$body = this.$widget;
            const renderResult = this.doRenderBody();
            if (typeof renderResult === "object" && "catch" in renderResult) {
                this.initialized = renderResult.catch((e) => {
                    this.logRenderingError(e);
                });
            } else {
                this.initialized = Promise.resolve();
            }
        };

        return originalWidget;
    }, {
        noteContext
    });

    return el;
}
