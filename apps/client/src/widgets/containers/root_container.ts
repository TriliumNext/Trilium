import { EventData } from "../../components/app_context.js";
import { applyAppearance, applyReloadedAppearance } from "../../services/appearance.js";
import { isMobile } from "../../services/utils.js";
import type BasicWidget from "../basic_widget.js";
import { trackVirtualKeyboard } from "../mobile_widgets/virtual_keyboard.js";
import FlexContainer from "./flex_container.js";


/**
 * The root container is the top-most widget/container, from which the entire layout derives.
 *
 * For convenience, the root container has a few class selectors that can be used to target some global state:
 *
 * - `#root-container.light-theme`, indicates whether the current color scheme is light.
 * - `#root-container.dark-theme`, indicates whether the current color scheme is dark.
 * - `#root-container.virtual-keyboard-opened`, on mobile devices if the virtual keyboard is open.
 * - `#root-container.horizontal-layout`, if the current layout is horizontal.
 * - `#root-container.vertical-layout`, if the current layout is horizontal.
 */
export default class RootContainer extends FlexContainer<BasicWidget> {

    constructor(isHorizontalLayout: boolean) {
        super(isHorizontalLayout ? "column" : "row");

        this.id("root-widget");
        this.css("height", "100dvh");
    }

    render(): JQuery<HTMLElement> {
        applyAppearance();

        const $widget = super.render();
        if (isMobile()) {
            trackVirtualKeyboard($widget[0]);
        }
        return $widget;
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        applyReloadedAppearance(loadResults);
    }
}
