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
}

export default function RightPanelWidget({ id, title, buttons, children, containerRef: externalContainerRef, contextMenuItems, grow }: RightPanelWidgetProps) {
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
                <div class="card-header-buttons">
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
                {expanded && <div class="card-body">
                    {children}
                </div>}
            </div>
        </div>
    );
}
