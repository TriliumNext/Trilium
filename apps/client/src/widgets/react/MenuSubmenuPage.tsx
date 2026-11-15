import clsx from "clsx";
import { type ComponentChildren, createPortal } from "preact";

import { t } from "../../services/i18n";
import { MenuList, titleId } from "./FormList";
import type { Slide } from "./hooks/dom";
import MasterDetailHeader from "./MasterDetailHeader";
import { type MenuFilter, MenuLevelContext, useMenu } from "./menu_context";

/**
 * A submenu opened on a phone: a page that takes the menu's place, headed by the submenu's title and
 * a way back. The level it covers stays mounted, as the row that owns this page stands in it.
 */
export default function MenuSubmenuPage({ slide, layerHost, rowId, level, title, filter, children }: {
    /** The slide of whether the page is open: from closed as it arrives, from open as it leaves. */
    slide: Slide<boolean>,
    /** The element of the menu that holds its submenus. */
    layerHost: HTMLElement,
    rowId: string,
    level: number,
    title: ComponentChildren,
    filter: MenuFilter | undefined,
    children: ComponentChildren
}) {
    const menu = useMenu();
    function back() {
        menu.openSubmenu(level - 1);
        menu.setActive(level - 1, rowId);
    }

    return createPortal((
        <MenuLevelContext.Provider value={level}>
            <div
                role="menu" aria-labelledby={titleId(rowId)}
                className={clsx("tn-menu-page", slide.from === false && "tn-menu-page-entering",
                    slide.from === true && "tn-menu-page-leaving")}
                onAnimationEnd={slide.onAnimationEnd}
            >
                {/* As a row's press: the menu keeps focus, and the dropdown does not close on it. */}
                <div
                    className="tn-menu-page-header"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <MasterDetailHeader inPage onBack={back} backTitle={t("menu.back")} pageTitle={title} listTitle={title} />
                </div>
                <MenuList filter={filter}>{children}</MenuList>
            </div>
        </MenuLevelContext.Provider>
    ), layerHost);
}
