import "./toolbar_group_menu.css";

import type {
    ToolbarGroupMenuEntry, ToolbarGroupMenuHost, ToolbarGroupMenuItem, ToolbarGroupMenuRequest
} from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { Fragment, render } from "preact";
import { useCallback } from "preact/hooks";

import { escapeHtml, isMobile, isNarrowLayout } from "../../../services/utils";
import {
    FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem, FormListToggleableItem
} from "../../react/FormList";
import Menu, { MenuTile } from "../../react/Menu";
import {
    isKeyboardPanelOpen, MOBILE_TOOLBAR_ROW, useClosedByToolbarTap, useKeyboardPanel
} from "./mobile_editor_toolbar";

/** The gap between the group's button and the menu, as a `Dropdown` leaves under its toggle. */
const ANCHOR_GAP = 2;

/**
 * Draws the menu of a toolbar group marked `asMenu` with the app's own `Menu`, for the editor
 * config's `toolbarGroupMenu.host`.
 */
export function createToolbarGroupMenuHost(): ToolbarGroupMenuHost {
    const container = document.createElement("div");
    let shown: ToolbarGroupMenuRequest | null = null;
    const unmount = () => {
        shown = null;
        render(null, container);
    };

    return {
        show(request) {
            shown = request;
            // An entry that runs hides the menu first, so a close that follows finds it gone.
            const close = (returnFocus: boolean) => {
                if (shown !== request) return;
                request.onClose(returnFocus);
                unmount();
            };
            render(<ToolbarGroupMenu request={request} onClose={close} />, container);
        },
        hide: unmount,
        destroy: unmount,
        isInPlaceOfKeyboard: isKeyboardPanelOpen
    };
}

function ToolbarGroupMenu({ request, onClose }: {
    request: ToolbarGroupMenuRequest;
    onClose(returnFocus: boolean): void;
}) {
    const bottomSheet = isMobile() && isNarrowLayout();
    const { isPanel, replacesPanel, isOwnHeight, measureRef } = useKeyboardPanel(bottomSheet);
    const setElement = useCallback((element: HTMLElement | null) => {
        request.setElement(element);
        measureRef(element);
    }, [ request, measureRef ]);
    useClosedByToolbarTap(request.anchor, () => onClose(false));

    return (
        <Menu
            anchor={request.anchor}
            offset={ANCHOR_GAP}
            portalClassName="tn-dropdown-portal"
            className={clsx(
                "tn-dropdown-menu", isPanel && "keyboard-panel",
                isOwnHeight && "keyboard-panel-own-height", replacesPanel && "replaces-panel"
            )}
            bottomSheet={bottomSheet}
            keepOpenSelector={MOBILE_TOOLBAR_ROW}
            aria-labelledby={request.anchor.getAttribute("aria-labelledby") ?? undefined}
            elementRef={setElement}
            onDismiss={() => onClose(false)}
            onClose={() => onClose(true)}
        >
            {request.layout === "tiles"
                ? <MenuTileGroups items={request.items} />
                : <MenuRows items={request.items} />}
        </Menu>
    );
}

function MenuRows({ items }: { items: ToolbarGroupMenuItem[] }) {
    return (
        <>
            {items.map((item, index) => {
                if (item.kind === "separator") {
                    return <FormDropdownDivider key={index} />;
                }
                if (item.kind === "heading") {
                    return <FormListHeader key={index} text={item.label} />;
                }

                const { label, icon, iconClass, isEnabled, isOn, isSwitch, className, run, children } = item;
                if (isSwitch) {
                    return (
                        <FormListToggleableItem
                            key={index} icon={iconClass} title={label} currentValue={isOn ?? false}
                            disabled={!isEnabled} className={className} onChange={() => run?.()}
                        />
                    );
                }
                if (children) {
                    return (
                        <FormDropdownSubmenu
                            key={index} icon={iconClass} iconSvg={icon} title={label} disabled={!isEnabled}
                            onDropdownToggleClicked={run && (() => run())}
                        >
                            <MenuRows items={children} />
                        </FormDropdownSubmenu>
                    );
                }

                return (
                    <FormListItem
                        key={index} icon={iconClass} iconSvg={icon} disabled={!isEnabled} onClick={() => run?.()}
                        checkable={isOn !== undefined} checked={isOn} className={className}
                    >
                        <span className="toolbar-group-menu-label">{label}</span>
                    </FormListItem>
                );
            })}
        </>
    );
}

/**
 * The entries as tiles, a grid of them for each group between separators and headings, under its
 * heading. An entry with a submenu is a tile that opens it.
 */
function MenuTileGroups({ items }: { items: ToolbarGroupMenuItem[] }) {
    const groups: { heading?: string; entries: ToolbarGroupMenuEntry[] }[] = [ { entries: [] } ];
    for (const item of items) {
        if (item.kind === "entry") {
            groups[groups.length - 1].entries.push(item);
        } else {
            groups.push({ heading: item.kind === "heading" ? item.label : undefined, entries: [] });
        }
    }

    return (
        <>
            {groups.filter(({ entries }) => entries.length).map(({ heading, entries }, index) => (
                <Fragment key={index}>
                    {heading && <FormListHeader text={heading} />}
                    <li className="tn-menu-actions tn-menu-actions-cards toolbar-group-menu-tiles" role="group">
                        {entries.map(({ label, icon, iconClass, isEnabled, isOn, run, children }, tileIndex) => (children
                            ? (
                                <FormDropdownSubmenu key={tileIndex} tile icon={iconClass} iconSvg={icon} title={label} disabled={!isEnabled}>
                                    <MenuRows items={children} />
                                </FormDropdownSubmenu>
                            )
                            : (
                                <MenuTile
                                    key={tileIndex} icon={iconClass} iconSvg={icon} title={escapeHtml(label)}
                                    disabled={!isEnabled} checked={isOn} onSelect={() => run?.()}
                                />
                            )
                        ))}
                    </li>
                </Fragment>
            ))}
        </>
    );
}
