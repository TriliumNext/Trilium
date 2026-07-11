import clsx from "clsx";
import { ComponentChildren, RefObject } from "preact";
import { useContext, useState } from "preact/hooks";

import contextMenu, { MenuItem } from "../../menus/context_menu";
import ActionButton from "../react/ActionButton";
import { useSyncedRef, useTriliumOptionJson } from "../react/hooks";
import { ParentComponent } from "../react/react_utils";

interface RightPanelWidgetProps {
    id: string;
    title: string;
    children: ComponentChildren;
    buttons?: ComponentChildren;
    containerRef?: RefObject<HTMLDivElement>;
    contextMenuItems?: MenuItem<unknown>[];
    grow?: boolean;
    /**
     * Keep the body in the DOM when collapsed (hidden via CSS) instead of unmounting it. Use for a
     * stateful widget whose content shouldn't be rebuilt on every collapse — e.g. the sidebar chat,
     * whose live conversation, draft input, and DOM-attached listeners would otherwise be torn down
     * and (because its hooks live in the always-mounted parent) not re-wired on expand.
     */
    keepMounted?: boolean;
}

export default function RightPanelWidget({ id, title, buttons, children, containerRef: externalContainerRef, contextMenuItems, grow, keepMounted }: RightPanelWidgetProps) {
    const [ rightPaneCollapsedItems, setRightPaneCollapsedItems ] = useTriliumOptionJson<string[]>("rightPaneCollapsedItems");
    const [ expanded, setExpanded ] = useState(!rightPaneCollapsedItems.includes(id));
    const containerRef = useSyncedRef<HTMLDivElement>(externalContainerRef, null);
    const parentComponent = useContext(ParentComponent);

    if (parentComponent) {
        parentComponent.initialized = Promise.resolve();
    }

    return (
        <div
            ref={containerRef}
            id={id}
            class={clsx("card widget", {
                collapsed: !expanded,
                grow
            })}
        >
            <div
                class="card-header"
                onClick={() => {
                    const newExpanded = !expanded;
                    setExpanded(newExpanded);
                    const rightPaneCollapsedItemsSet = new Set(rightPaneCollapsedItems);
                    if (newExpanded) {
                        rightPaneCollapsedItemsSet.delete(id);
                    } else {
                        rightPaneCollapsedItemsSet.add(id);
                    }
                    setRightPaneCollapsedItems(Array.from(rightPaneCollapsedItemsSet));
                }}
            >
                <ActionButton icon="bx bx-chevron-down" text="" />
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
                {(expanded || keepMounted) && <div class="card-body" style={!expanded ? { display: "none" } : undefined}>
                    {children}
                </div>}
            </div>
        </div>
    );
}
