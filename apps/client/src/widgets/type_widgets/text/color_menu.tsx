import type { ColorMenuHost, ColorMenuRequest, ColorMenuTarget } from "@triliumnext/ckeditor5";
import clsx from "clsx";
import { render } from "preact";
import { useCallback } from "preact/hooks";

import { t } from "../../../services/i18n";
import { isMobile, isNarrowLayout } from "../../../services/utils";
import ColorPicker from "../../react/ColorPicker";
import { FormListCustomItem, FormListHeader } from "../../react/FormList";
import Menu from "../../react/Menu";
import { buildFontColorConfig } from "./color_palette";
import {
    isKeyboardPanelOpen, MOBILE_TOOLBAR_ROW, useClosedByToolbarTap, useKeyboardPanel
} from "./mobile_editor_toolbar";

/** The gap between the button and the menu, as a `Dropdown` leaves under its toggle. */
const ANCHOR_GAP = 2;

/**
 * Draws the menu of the `colorMenu` button with the app's own `Menu`, for the editor config's
 * `colorMenu.host`: a row of swatches for the color of the text and one for its background.
 */
export function createColorMenuHost(): ColorMenuHost {
    const container = document.createElement("div");
    let shown: ColorMenuRequest | null = null;
    const unmount = () => {
        shown = null;
        render(null, container);
    };

    return {
        show(request) {
            shown = request;
            // Setting a color hides the menu first, so a close that follows finds it gone.
            const close = (returnFocus: boolean) => {
                if (shown !== request) return;
                request.onClose(returnFocus);
                unmount();
            };
            render(<ColorMenu request={request} onClose={close} />, container);
        },
        hide: unmount,
        destroy: unmount,
        isInPlaceOfKeyboard: isKeyboardPanelOpen
    };
}

function ColorMenu({ request, onClose }: {
    request: ColorMenuRequest;
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
            elementRef={setElement}
            onDismiss={() => onClose(false)}
            onClose={() => onClose(true)}
        >
            <ColorRow request={request} target="fontColor" title={t("text-editor.color-menu.text-color")} />
            <ColorRow request={request} target="fontBackgroundColor" title={t("text-editor.color-menu.background-color")} />
        </Menu>
    );
}

function ColorRow({ request, target, title }: {
    request: ColorMenuRequest;
    target: ColorMenuTarget;
    title: string;
}) {
    const presets = buildFontColorConfig()[target].colors.map(({ color }) => color);

    return (
        <>
            <FormListHeader text={title} />
            <FormListCustomItem>
                <ColorPicker
                    currentValue={request[target]}
                    presets={presets}
                    onChange={(color) => request.setColor(target, color)}
                />
            </FormListCustomItem>
        </>
    );
}
