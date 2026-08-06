//! This is currently only used for the new layout.
import "./RightPanelContainer.css";

import Split from "@triliumnext/split.js";
import clsx from "clsx";
import { VNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import options from "../../services/options";
import { DEFAULT_GUTTER_SIZE } from "../../services/resizer";
import { isStandalone } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import { useActiveNoteContext, useGetContextData, useLegacyWidget, useNoteProperty, useTriliumEvent, useTriliumOption, useTriliumOptionBool, useTriliumOptionJson } from "../react/hooks";
import LazyComponent from "../react/LazyComponent";
import NoItems from "../react/NoItems";
import { PaneMode, usePaneMode, usePeekDismiss } from "../react/peek_pane";
import LegacyRightPanelWidget from "../right_panel_widget";
import AttributeList from "./AttributeList";
import Backlinks from "./Backlinks";
import ChatHighlightsList from "./ChatHighlightsList";
import HighlightsList from "./HighlightsList";
import NoteMap from "./NoteMap";
import NotePaths from "./NotePaths";
import PdfAnnotations from "./pdf/PdfAnnotations";
import PdfAttachments from "./pdf/PdfAttachments";
import PdfLayers from "./pdf/PdfLayers";
import PdfPages from "./pdf/PdfPages";
import RightPanelWidget, { CollapsibleWidgets, ExpandWidgetRequest, ExpandWidgetRequests } from "./RightPanelWidget";
import RightPanePeekButton from "./RightPanePeekButton";
import RightPaneTabs, { RIGHT_PANE_TABS, RightPaneTabDefinition, RightPaneTabId } from "./RightPaneTabs";
import SimilarNotes from "./SimilarNotes";
import TableOfContents from "./TableOfContents";

const MIN_WIDTH_PERCENT = 5;
const MAX_WIDTH_PERCENT = 90;

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

export default function RightPanelContainer({ widgetsByParent }: { widgetsByParent: WidgetsByParent }) {
    const { mode, visible, mounted, togglePeek, toggleDocked, dock, close, dismiss } = usePaneMode("rightPaneVisible");
    const tabs = useItems(mounted, widgetsByParent);
    const [ selectedTabId, setSelectedTabId ] = useTriliumOption("rightPaneSelectedTab");
    const [ expandRequest, setExpandRequest ] = useState<ExpandWidgetRequest | null>(null);
    useSplit(mode);

    // The chosen tab may have nothing to show for this note (or may have gone away entirely, e.g. the
    // chat once AI is switched off), in which case the first one that does stands in — without
    // overwriting the choice, so it is back as soon as the note has that tab again.
    const activeTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];

    // A tab's widgets are mounted when it is first opened and kept mounted afterwards: switching back
    // is instant and stateful (a chat in progress survives it), while a tab never opened costs
    // nothing — which is what keeps the LLM chat's bundle out of the pane until it is asked for.
    const openedTabs = useRef(new Set<RightPaneTabId>());
    if (activeTab) {
        openedTabs.current.add(activeTab.id);
    }

    // Legacy entry points (tab-row toggle, empty-state button) open/close the *docked* pane;
    // the keyboard shortcut peeks it (same as clicking the peek button).
    useTriliumEvent("toggleRightPane", toggleDocked);
    useTriliumEvent("peekRightPane", togglePeek);

    // An entry point aimed at one tab (the chat launcher, the status bar's connection badges): it opens
    // the pane on that tab, brings it to the front if the pane is already open on another one, and puts
    // it away again when it is the tab on show — see reduceTabSelection for what that amounts to.
    // `peek` opens it as a glance instead of a dock; `expandWidgetId` opens the one widget the entry
    // point is really about, in case the user has it collapsed.
    useTriliumEvent("selectRightPaneTab", ({ tabId, peek, expandWidgetId }) => {
        const action = reduceTabSelection(mode, activeTab?.id, { tabId, peek });
        if (action === "dismiss") {
            dismiss();
            return;
        }
        if (action === "close") {
            close();
            return;
        }

        void setSelectedTabId(tabId);
        // Raised before the pane opens, so a widget mounted for the first time already reads it.
        if (expandWidgetId) {
            setExpandRequest((prev) => ({ id: expandWidgetId, counter: (prev?.counter ?? 0) + 1 }));
        }
        if (action === "open") {
            if (peek) {
                togglePeek();
            } else {
                toggleDocked();
            }
        }
    });

    // A request doesn't outlive the pane's content: it would otherwise be honoured all over again by
    // the widget that remounts on the next opening, long after the press that asked for it.
    useEffect(() => {
        if (!mounted) setExpandRequest(null);
    }, [ mounted ]);

    // Outside-press / Esc *soft*-dismisses the peek: it hides but stays mounted, so re-peeking is
    // instant and preserves widget state. The × button and the docked toggle hard-close (unmount).
    // A `right-pane-peek-source` control (the status bar's connection badges) peeks the pane itself
    // (see selectRightPaneTab above), so dismissing on its press would only close the pane for the
    // click that follows to reopen it.
    usePeekDismiss(mode === "peek", dismiss, {
        keepOpenSelector: "#right-pane, .right-pane-peek-button, .right-pane-peek-source",
        focusSelector: ".right-pane-peek-button"
    });

    return (
        <>
            {/* Absolutely positioned in a reserved gutter on the viewport's right edge, so it
                stays put regardless of the right pane's open/collapsed state (see RightPanelContainer.css). */}
            <RightPanePeekButton rightPaneVisible={visible} onToggle={togglePeek} />
            {/* Persistent host so #right-pane never reparents between modes (which would remount the
                right pane widgets). Docked: an in-flow flex child Split resizes against #center-pane.
                Peek: an absolute layer over the content where Split resizes the spacer vs the pane.
                `hidden` (display:none) keeps soft-dismissed peek content mounted but out of layout. */}
            <div id="right-pane-host" class={clsx(mode === "peek" && "peek", !visible && "hidden")}>
                {/* The spacer is both the left Split target and the dismiss backdrop in peek mode:
                    it covers the content (a click dismisses) and shields the PDF iframe so Split's
                    drag tracking isn't interrupted. Always rendered + CSS-toggled to keep the host's
                    child list structurally stable for Split's gutter injection. */}
                <div class="right-pane-peek-spacer" />
                {/* Mode class (right-pane-mode-docked / -peek) as a styling hook; none when closed. */}
                <div id="right-pane" class={visible ? `right-pane-mode-${mode}` : undefined}>
                    {visible && (
                        <div class="right-pane-actions">
                            {/* Pin only applies while peeking (it docks the pane); close shows in both modes. */}
                            {mode === "peek" && <ActionButton icon="bx bx-pin" text={t("right_pane.dock")} onClick={dock} />}
                            <ActionButton icon="bx bx-x" text={t("right_pane.close")} onClick={close} />
                        </div>
                    )}
                    {mounted && (
                        tabs.length > 0 ? (
                            <>
                                <RightPaneTabs
                                    tabs={tabs}
                                    activeTabId={activeTab?.id}
                                    onSelect={(tabId) => void setSelectedTabId(tabId)}
                                />

                                {tabs.filter((tab) => openedTabs.current.has(tab.id)).map((tab) => (
                                    <div
                                        key={tab.id}
                                        role="tabpanel"
                                        class={clsx("right-pane-tab-body", tab.id !== activeTab?.id && "hidden-ext")}
                                    >
                                        {/* Collapsing the only widget of a tab would leave the tab empty,
                                            so a tab of one offers no collapsing at all. */}
                                        <CollapsibleWidgets.Provider value={tab.items.length > 1}>
                                            <ExpandWidgetRequests.Provider value={expandRequest}>
                                                {tab.items.length > 0 ? tab.items : (
                                                    // A tab that stays for a note it has nothing to show
                                                    // (see RightPaneTabDefinition.alwaysShown) says so.
                                                    <NoItems icon={tab.icon} text={t("right_pane.empty_message")} />
                                                )}
                                            </ExpandWidgetRequests.Provider>
                                        </CollapsibleWidgets.Provider>
                                    </div>
                                ))}
                            </>
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
                        )
                    )}
                </div>
            </div>
        </>
    );
}

function useItems(rightPaneVisible: boolean, widgetsByParent: WidgetsByParent): RightPaneTabContents[] {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const [ highlightsList ] = useTriliumOptionJson<string[]>("highlightsList");
    // Published by the LLM chat; drives the chat highlights widget's visibility (only shown once
    // the chat has at least one highlight).
    const chatHighlights = useGetContextData("chatHighlights");
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
            // backlinks below take whatever height is left.
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
            el: <SimilarNotes />,
            enabled: !!note,
            tab: "connections"
        },
        {
            el: <TableOfContents />,
            enabled: (noteType === "text" || noteType === "doc" || isPdf || noteType === "llmChat" || !!note?.isMarkdown()),
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
            el: <ChatHighlightsList />,
            enabled: noteType === "llmChat" && (chatHighlights?.highlights.length ?? 0) > 0,
            tab: "outline"
        },
        {
            // Loaded lazily because the chat pulls in the whole LLM + CKEditor graph,
            // which users without the LLM experimental feature should never download.
            el: <LazyComponent loader={() => import("./SidebarChat.jsx")} />,
            enabled: noteType !== "llmChat" && !isStandalone && aiEnabled,
            position: 1000,
            tab: "chat"
        },
        ...widgetsByParent.getLegacyWidgets("right-pane").map((widget) => ({
            el: <CustomLegacyWidget key={widget._noteId} originalWidget={widget as LegacyRightPanelWidget} />,
            enabled: true,
            position: widget.position,
            tab: "widgets" as const
        })),
        ...widgetsByParent.getPreactWidgets("right-pane").map((widget) => {
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

export type TabSelection = "open" | "select" | "dismiss" | "close";

/**
 * What a `selectRightPaneTab` press amounts to, given how the pane stands (pure):
 *
 * - `open`: the pane is closed, so open it — peeked or docked, as the entry point asks.
 * - `select`: bring the tab to the front of an open pane.
 * - `dismiss`: put away the peek the press is toggling, softly so that the next one is instant.
 * - `close`: an entry point that opens the pane docked closes it again, so its button stays a toggle
 *   for its own tab.
 *
 * A `peek` entry point is only a glance, so pressing it for the tab already on show in a *docked* pane
 * selects rather than closes: the dock is the user's layout, not the badge's to undo — the press is
 * left to expand the widget it is about.
 */
export function reduceTabSelection(mode: PaneMode, activeTabId: RightPaneTabId | undefined, { tabId, peek }: { tabId: RightPaneTabId; peek?: boolean }): TabSelection {
    if (mode === "closed") return "open";
    if (activeTabId !== tabId) return "select";
    if (mode === "peek") return "dismiss";
    return peek ? "select" : "close";
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

function useSplit(mode: PaneMode) {
    // A layout effect, not an effect: Preact flushes effects *after* paint, which would leave one
    // frame where the host is already laid out (absolute and full-width in peek mode) but neither
    // the spacer nor the pane has Split's inline width yet — the pane collapses to its content width
    // against the host's left edge, then jumps right. The peek fade-in used to mask that frame; with
    // motion disabled it's plainly visible.
    useLayoutEffect(() => {
        if (mode === "closed") return;

        // We are intentionally omitting useTriliumOption to avoid re-render due to size change.
        const rightPaneWidth = Math.min(MAX_WIDTH_PERCENT, Math.max(MIN_WIDTH_PERCENT, options.getInt("rightPaneWidth") ?? MIN_WIDTH_PERCENT));

        // Cap the right pane at MAX_WIDTH_PERCENT. Enforced in onDrag using Split's live percentages
        // rather than its px-based maxSize, so the cap stays correct across window resizes.
        let splitInstance: ReturnType<typeof Split> | undefined;
        const onDrag = (sizes: number[]) => {
            if (sizes[1] > MAX_WIDTH_PERCENT) {
                splitInstance?.setSizes([100 - MAX_WIDTH_PERCENT, MAX_WIDTH_PERCENT]);
            }
        };
        const onDragEnd = (sizes: number[]) => options.save("rightPaneWidth", Math.round(sizes[1]));

        // Docked: resize the host (and thus the content) against #center-pane — which lives outside this
        // island, so on the initial mount it may not be committed yet when this layout effect runs.
        // Peek: resize the pane against the spacer inside the absolute host — both are rendered here, so
        // they're always present; #center-pane is untouched, so it never reflows.
        const selectors = mode === "docked"
            ? [ "#center-pane", "#right-pane-host" ]
            : [ ".right-pane-peek-spacer", "#right-pane" ];
        const minSize = mode === "docked" ? [ 300, 180 ] : [ 0, 180 ];

        const createSplit = () => Split(selectors, {
            sizes: [100 - rightPaneWidth, rightPaneWidth],
            gutterSize: DEFAULT_GUTTER_SIZE,
            minSize,
            rtl: glob.isRtl,
            onDrag,
            onDragEnd
        });

        // Split throws if any target selector isn't in the DOM. When everything is present, create it
        // synchronously so the panes carry Split's inline widths before paint (no flicker — see above).
        // Otherwise defer a frame until the sibling layout has been committed, mirroring the left/note
        // split resizers in resizer.ts; re-check on the next frame so a still-missing target is skipped
        // rather than throwing.
        let rafId: number | undefined;
        if (selectors.every((selector) => document.querySelector(selector))) {
            splitInstance = createSplit();
        } else {
            rafId = requestAnimationFrame(() => {
                rafId = undefined;
                if (selectors.every((selector) => document.querySelector(selector))) {
                    splitInstance = createSplit();
                }
            });
        }

        return () => {
            if (rafId !== undefined) {
                cancelAnimationFrame(rafId);
            }
            splitInstance?.destroy();
        };
    }, [ mode ]);
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
