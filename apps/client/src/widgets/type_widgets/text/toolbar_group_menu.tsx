import type {
    ToolbarGroupMenuHost, ToolbarGroupMenuItem, ToolbarGroupMenuRequest
} from "@triliumnext/ckeditor5";
import { render } from "preact";

import { isMobile, isNarrowLayout } from "../../../services/utils";
import { FormDropdownDivider, FormDropdownSubmenu, FormListItem } from "../../react/FormList";
import Menu from "../../react/Menu";

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
        destroy: unmount
    };
}

function ToolbarGroupMenu({ request, onClose }: {
    request: ToolbarGroupMenuRequest;
    onClose(returnFocus: boolean): void;
}) {
    return (
        <Menu
            anchor={request.anchor}
            offset={ANCHOR_GAP}
            portalClassName="tn-dropdown-portal"
            className="tn-dropdown-menu"
            bottomSheet={isMobile() && isNarrowLayout()}
            aria-labelledby={request.anchor.getAttribute("aria-labelledby") ?? undefined}
            elementRef={request.setElement}
            onDismiss={() => onClose(false)}
            onClose={() => onClose(true)}
        >
            <MenuRows items={request.items} />
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

                const { label, icon, isEnabled, run, children } = item;
                if (children) {
                    return (
                        <FormDropdownSubmenu
                            key={index} iconSvg={icon} title={label} disabled={!isEnabled}
                            onDropdownToggleClicked={run && (() => run())}
                        >
                            <MenuRows items={children} />
                        </FormDropdownSubmenu>
                    );
                }

                return (
                    <FormListItem
                        key={index} iconSvg={icon} disabled={!isEnabled} onClick={() => run?.()}
                    >
                        {label}
                    </FormListItem>
                );
            })}
        </>
    );
}
