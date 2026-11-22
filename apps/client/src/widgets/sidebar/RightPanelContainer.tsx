import "./RightPanelContainer.css";

import Split from "@triliumnext/split.js";
import clsx from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import options from "../../services/options";
import { DEFAULT_GUTTER_SIZE } from "../../services/resizer";
import { useTriliumEvent } from "../react/hooks/events";
import { WithLazyModule } from "../react/LazyComponent";
import { PaneMode, usePaneMode, usePeekDismiss } from "../react/peek_pane";
import PeekPaneButton from "../react/PeekPaneButton";
import type { ExpandWidgetRequest } from "./RightPanelWidget";
import type { RightPaneTabId } from "./RightPaneTabs";

const MIN_WIDTH_PERCENT = 5;
const MAX_WIDTH_PERCENT = 90;

const loadContent = () => import("./RightPaneContent");

export default function RightPanelContainer({ widgetsByParent }: { widgetsByParent?: WidgetsByParent }) {
    const { mode, visible, mounted, togglePeek, toggleDocked, dock, close, dismiss } = usePaneMode("rightPaneVisible", "right");
    // This window's own choice, seeded from the option and written back for the next window to start
    // from — the same treatment usePaneMode gives the pane's visibility. Subscribing to the option
    // (useTriliumOption) would let a click in one window flip the strip in every other.
    const [ selectedTabId, setSelectedTabIdState ] = useState(() => options.get("rightPaneSelectedTab"));
    const setSelectedTabId = useCallback((tabId: RightPaneTabId) => {
        setSelectedTabIdState(tabId);
        void options.save("rightPaneSelectedTab", tabId);
    }, []);
    const [ expandRequest, setExpandRequest ] = useState<ExpandWidgetRequest | null>(null);
    // The tab on show, which `RightPaneContent` writes once it has the tabs of the note.
    const activeTabIdRef = useRef<RightPaneTabId | undefined>(undefined);
    useSplit(mode);

    // Legacy entry points (tab-row toggle, empty-state button) open/close the *docked* pane;
    // the keyboard shortcut peeks it (same as clicking the peek button).
    useTriliumEvent("toggleRightPane", toggleDocked);
    useTriliumEvent("peekRightPane", togglePeek);

    // An entry point aimed at one tab (the chat launcher, the note map's keyboard action): it opens
    // the pane on that tab, brings it to the front if the pane is already open on another one, and puts
    // it away again when it is the tab on show — see reduceTabSelection for what that amounts to.
    // `peek` opens it as a glance instead of a dock; `expandWidgetId` opens the one widget the entry
    // point is really about, in case the user has it collapsed.
    useTriliumEvent("selectRightPaneTab", ({ tabId, peek, expandWidgetId }) => {
        const action = reduceTabSelection(mode, activeTabIdRef.current, { tabId, peek });
        if (action === "dismiss") {
            dismiss();
            return;
        }
        if (action === "close") {
            close();
            return;
        }

        setSelectedTabId(tabId);
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
    usePeekDismiss(mode === "peek", dismiss, {
        keepOpenSelector: "#right-pane, .right-pane-peek-button",
        focusSelector: ".right-pane-peek-button"
    });

    return (
        <>
            {/* Absolutely positioned in a reserved gutter on the viewport's right edge, so it
                stays put regardless of the right pane's open/collapsed state (see RightPanelContainer.css). */}
            <PeekPaneButton
                side="end"
                className="right-pane-peek-button"
                isOpen={visible}
                onToggle={togglePeek}
                hideText={t("right_pane.hide")}
                peekText={t("right_pane.peek")}
                keyboardAction="peekRightPane"
            />
            {/* Persistent host so #right-pane never reparents between modes (which would remount the
                right pane widgets). Docked: an in-flow flex child Split resizes against #center-pane.
                Peek: an absolute layer over the content where Split resizes the spacer vs the pane.
                `hidden` (display:none) keeps soft-dismissed peek content mounted but out of layout. */}
            <div
                id="right-pane-host"
                class={clsx("peek-pane-host side-end", mode === "peek" && "peek", !visible && "hidden")}
            >
                {/* The spacer is both the left Split target and the dismiss backdrop in peek mode:
                    it covers the content (a click dismisses) and shields the PDF iframe so Split's
                    drag tracking isn't interrupted. Always rendered + CSS-toggled to keep the host's
                    child list structurally stable for Split's gutter injection. */}
                <div class="peek-pane-spacer" />
                {/* Mode class (right-pane-mode-docked / -peek) as a styling hook; none when closed. */}
                <div id="right-pane" class={clsx("peek-pane", visible && `right-pane-mode-${mode}`)}>
                    {mounted && (
                        <WithLazyModule load={loadContent}>
                            {({ default: RightPaneContent }) => (
                                <RightPaneContent
                                    mode={mode}
                                    selectedTabId={selectedTabId}
                                    setSelectedTabId={setSelectedTabId}
                                    expandRequest={expandRequest}
                                    activeTabIdRef={activeTabIdRef}
                                    dock={dock}
                                    close={close}
                                    widgetsByParent={widgetsByParent}
                                />
                            )}
                        </WithLazyModule>
                    )}
                </div>
            </div>
        </>
    );
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
            : [ "#right-pane-host > .peek-pane-spacer", "#right-pane" ];
        const minSize = mode === "docked" ? [ 300, 230 ] : [ 0, 230 ];

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

