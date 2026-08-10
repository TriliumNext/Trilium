import clsx from "clsx";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";

import contextMenu, { MenuItem } from "../../menus/context_menu";
import ActionButton from "../react/ActionButton";
import { useSyncedRef, useTriliumOptionJson } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";

/**
 * Whether the widgets below can be collapsed, set by whoever lays them out: collapsing the only widget
 * of a right pane tab would leave the tab empty, so the tab says so and the widget drops its chevron.
 */
export const CollapsibleWidgets = createContext(true);

/**
 * A request to expand one widget of the pane, raised by an entry point aimed at it (the status bar's
 * note paths badge) so that it doesn't land on a widget the user has collapsed. The counter tells
 * repeated requests apart, so the widget opens again after having been collapsed in between.
 */
export interface ExpandWidgetRequest {
    id: string;
    counter: number;
}

/** The pending {@link ExpandWidgetRequest}, set by whoever lays the widgets out. */
export const ExpandWidgetRequests = createContext<ExpandWidgetRequest | null>(null);

interface RightPanelWidgetProps {
    id: string;
    title: string;
    children: ComponentChildren;
    buttons?: ComponentChildren;
    containerRef?: RefObject<HTMLDivElement>;
    contextMenuItems?: MenuItem<unknown>[];
    /**
     * Take the height the other widgets of the tab leave over, scrolling the body within it, instead of
     * keeping to the height of the content. Use for the one widget a tab is really about — a note's own
     * attributes, its table of contents, the chat — so that the rest keep to their content around it.
     *
     * Two of them in a tab share the leftover height between them, each keeping its own floor — the
     * connections tab's map and backlinks, a PDF's outline and its pages. Ask for it once more than
     * that and none of them is left with room worth having. It lapses while the widget is collapsed,
     * so the others move up to fill the room.
     */
    grow?: boolean;
    /**
     * Keep the body in the DOM when collapsed (hidden via CSS) instead of unmounting it. Use for a
     * stateful widget whose content shouldn't be rebuilt on every collapse — e.g. the sidebar chat,
     * whose live conversation, draft input, and DOM-attached listeners would otherwise be torn down
     * and (because its hooks live in the always-mounted parent) not re-wired on expand.
     */
    keepMounted?: boolean;
    /** Add no padding to the widget body. */
    noPadding?: true;
}

export default function RightPanelWidget({ id, title, buttons, children, containerRef: externalContainerRef, contextMenuItems, grow, keepMounted, noPadding }: RightPanelWidgetProps) {
    const [ rightPaneCollapsedItems, setRightPaneCollapsedItems ] = useTriliumOptionJson<string[]>("rightPaneCollapsedItems");
    const [ collapsedByUser, setCollapsedByUser ] = useState(rightPaneCollapsedItems.includes(id));
    const [ scrollPending, setScrollPending ] = useState(false);
    const [ highlighted, setHighlighted ] = useState(false);
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const parentComponent = useContext(ParentComponent);
    const collapsible = useContext(CollapsibleWidgets);
    const expandRequest = useContext(ExpandWidgetRequests);
    // Whatever an earlier layout collapsed stays remembered but is disregarded here: the widget is all
    // its tab has, so a collapsed one would leave nothing behind, chevron included, to expand it again.
    const expanded = collapsible ? !collapsedByUser : true;

    // Being asked for by name (see ExpandWidgetRequests) opens the widget, and is remembered as if the
    // user had opened it themselves — so it is still open the next time its tab is built. Strictly
    // once per request: a collapse of the widget afterwards is the user's and stands.
    useEffect(() => {
        if (expandRequest?.id !== id) return;
        setCollapsedByUser(false);
        if (rightPaneCollapsedItems.includes(id)) {
            void setRightPaneCollapsedItems(rightPaneCollapsedItems.filter((item) => item !== id));
        }
        setScrollPending(true);
        // The request alone triggers this; the remembered list is read as it stands at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ expandRequest, id ]);

    // Scrolled to and flashed once the body it opened is laid out, hence the pass of its own. The flash
    // is what says which section answered: a tab holds several, one much like the next, and a press
    // that lands on a widget already open and in view would otherwise pass unnoticed.
    useEffect(() => {
        if (!scrollPending || !expanded) return;
        containerRef.current?.scrollIntoView({ block: "nearest" });
        setHighlighted(true);
        setScrollPending(false);
    }, [ scrollPending, expanded, containerRef ]);

    if (parentComponent) {
        parentComponent.initialized = Promise.resolve();
    }

    return (
        <div
            ref={containerRef}
            id={id}
            className={clsx("card widget", {
                collapsed: !expanded,
                "not-collapsible": !collapsible,
                grow,
                highlighted
            })}
            // The flash lasts as long as its animation (see RightPanelContainer.css) rather than a
            // duration kept in step here; a bubbled one from something within the widget is not it.
            onAnimationEnd={(e) => {
                if (e.target === containerRef.current) setHighlighted(false);
            }}
        >
            <div
                class="card-header"
                onClick={collapsible ? () => {
                    setCollapsedByUser(expanded);
                    const rightPaneCollapsedItemsSet = new Set(rightPaneCollapsedItems);
                    if (expanded) {
                        rightPaneCollapsedItemsSet.add(id);
                    } else {
                        rightPaneCollapsedItemsSet.delete(id);
                    }
                    setRightPaneCollapsedItems(Array.from(rightPaneCollapsedItemsSet));
                } : undefined}
            >
                {collapsible && <ActionButton icon="bx bx-chevron-down" text="" />}
                <div class="card-header-title">{title}</div>
                <div class="card-header-buttons" onClick={e => e.stopPropagation()}>
                    {buttons}
                    {contextMenuItems && (
                        <ActionButton
                            icon="bx bx-dots-vertical-rounded"
                            text=""
                            onClick={e => {
                                e.stopPropagation();
                                contextMenu.show({
                                    x: e.pageX,
                                    y: e.pageY,
                                    items: contextMenuItems,
                                    selectMenuItemHandler: () => {}
                                });
                            }}
                        />
                    )}
                </div>
            </div>

            <div id={parentComponent?.componentId} class="body-wrapper">
                {/* keepMounted widgets stay in the DOM when collapsed and hide via an inline display:none
                    (which beats any stylesheet `.card-body` display rule, unlike the `hidden` attribute), so
                    their state and DOM-attached listeners survive a collapse; others unmount as before. */}
                {(expanded || keepMounted) && <div class={clsx("card-body", { "no-padding": noPadding })} style={!expanded ? { display: "none" } : undefined}>
                    {children}
                </div>}
            </div>
        </div>
    );
}
