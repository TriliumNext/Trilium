import { Tooltip } from "bootstrap";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { handleRightToLeftPlacement } from "../../services/utils.js";

const TPL = /*html*/`<button class="button-widget bx"
      data-bs-toggle="tooltip"
      title=""></button>`;

type TitlePlacement = "top" | "bottom" | "left" | "right";
type StringOrCallback = string | (() => string);
type ContextMenuHandler = (e: JQuery.ContextMenuEvent<any, any, any, any> | null) => void;

export interface AbstractButtonWidgetSettings {
    titlePlacement: TitlePlacement;
    title: StringOrCallback | null;
    icon: StringOrCallback | null;
    onContextMenu: ContextMenuHandler | null;
}

export default class AbstractButtonWidget<SettingsT extends AbstractButtonWidgetSettings> extends NoteContextAwareWidget {
    protected settings!: SettingsT;
    protected tooltip!: Tooltip;

    isEnabled(): boolean | null | undefined {
        return true;
    }

    doRender() {
        this.$widget = $(TPL);

        this.tooltip = new Tooltip(this.$widget[0], {
            html: true,
            // in case getTitle() returns null -> use empty string as fallback
            title: () => this.getTitle() || "",
            trigger: "hover",
            placement: handleRightToLeftPlacement(this.settings.titlePlacement),
            fallbackPlacements: [ handleRightToLeftPlacement(this.settings.titlePlacement) ]
        });

        if (this.settings.onContextMenu) {
            this.$widget.on("contextmenu", (e) => {
                this.tooltip.hide();

                if (this.settings.onContextMenu) {
                    this.settings.onContextMenu(e);
                }

                return false; // blocks default browser right click menu
            });
        }

        super.doRender();
    }

    getTitle() {
        return typeof this.settings.title === "function" ? this.settings.title() : this.settings.title;
    }

    refreshIcon() {
        for (const className of this.$widget[0].classList) {
            if (className.startsWith("bx-")) {
                this.$widget.removeClass(className);
            }
        }

        const icon = typeof this.settings.icon === "function" ? this.settings.icon() : this.settings.icon;

        if (icon) {
            this.$widget.addClass(icon);
        }
    }

    initialRenderCompleteEvent() {
        this.refreshIcon();
    }

    icon(icon: StringOrCallback) {
        this.settings.icon = icon;
        return this;
    }

    title(title: StringOrCallback) {
        this.settings.title = title;
        return this;
    }

    titlePlacement(placement: TitlePlacement) {
        this.settings.titlePlacement = placement;
        return this;
    }

    onContextMenu(handler: ContextMenuHandler) {
        this.settings.onContextMenu = handler;
        return this;
    }
}
