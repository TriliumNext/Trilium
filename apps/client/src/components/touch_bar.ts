import utils from "../services/utils.js";
import Component from "./component.js";
import appContext from "./app_context.js";
import type { TouchBarButton, TouchBarGroup, TouchBarSegmentedControl, TouchBarSpacer } from "@electron/remote";

export type TouchBarItem = (TouchBarButton | TouchBarSpacer | TouchBarGroup | TouchBarSegmentedControl);

export function buildSelectedBackgroundColor(isSelected: boolean) {
    return isSelected ? "#757575" : undefined;
}

export default class TouchBarComponent extends Component {

    nativeImage: typeof import("electron").nativeImage;
    remote: typeof import("@electron/remote");
    lastFocusedComponent?: Component;
    private $activeModal?: JQuery<HTMLElement>;

    constructor() {
        super();
        this.nativeImage = utils.dynamicRequire("electron").nativeImage;
        this.remote = utils.dynamicRequire("@electron/remote") as typeof import("@electron/remote");
        this.$widget = $("<div>");

        $(window).on("focusin", async (e) => {
            const focusedEl = e.target as unknown as HTMLElement;
            const $target = $(focusedEl);

            this.$activeModal = $target.closest(".modal-dialog");
            this.lastFocusedComponent = appContext.getComponentByEl(focusedEl);
            this.#refreshTouchBar();
        });
    }

    buildIcon(name: string) {
        const sourceImage = this.nativeImage.createFromNamedImage(name, [-1, 0, 1]);
        const { width, height } = sourceImage.getSize();
        const newImage = this.nativeImage.createEmpty();
        newImage.addRepresentation({
            scaleFactor: 1,
            width: width / 2,
            height: height / 2,
            buffer: sourceImage.resize({ height: height / 2 }).toBitmap()
        });
        newImage.addRepresentation({
            scaleFactor: 2,
            width: width,
            height: height,
            buffer: sourceImage.toBitmap()
        });
        return newImage;
    }

    #refreshTouchBar() {
        const { TouchBar } = this.remote;
        const parentComponent = this.lastFocusedComponent;
        let touchBar: Electron.CrossProcessExports.TouchBar | null = null;

        if (this.$activeModal?.length) {
            touchBar = this.#buildModalTouchBar();
        } else if (parentComponent) {
            const items = parentComponent.triggerCommand("buildTouchBar", {
                TouchBar,
                buildIcon: this.buildIcon.bind(this)
            }) as unknown as TouchBarItem[];
            touchBar = this.#buildTouchBar(items);
        }

        if (touchBar) {
            this.remote.getCurrentWindow().setTouchBar(touchBar);
        }
    }

    #buildModalTouchBar() {
        const { TouchBar } = this.remote;
        const { TouchBarButton, TouchBarLabel, TouchBarSpacer } = this.remote.TouchBar;
        const items: TouchBarItem[] = [];

        // Look for the modal title.
        const $title = this.$activeModal?.find(".modal-title");
        if ($title?.length) {
            items.push(new TouchBarLabel({ label: $title.text() }))
        }

        items.push(new TouchBarSpacer({ size: "flexible" }));

        // Look for buttons in the modal.
        const $buttons = this.$activeModal?.find(".modal-footer button");
        for (const button of $buttons ?? []) {
            items.push(new TouchBarButton({
                label: button.innerText,
                click: () => button.click(),
                enabled: !button.hasAttribute("disabled")
            }));
        }

        items.push(new TouchBarSpacer({ size: "flexible" }));
        return new TouchBar({ items });
    }

    #buildTouchBar(componentSpecificItems?: TouchBarItem[]) {
        const { TouchBar } = this.remote;
        const { TouchBarButton, TouchBarSpacer, TouchBarGroup, TouchBarSegmentedControl, TouchBarOtherItemsProxy } = this.remote.TouchBar;

        // Disregard recursive calls or empty results.
        if (!componentSpecificItems || "then" in componentSpecificItems) {
            componentSpecificItems = [];
        }

        const items = [
            new TouchBarButton({
                icon: this.buildIcon("NSTouchBarComposeTemplate"),
                click: () => this.triggerCommand("createNoteIntoInbox")
            }),
            new TouchBarSpacer({ size: "small" }),
            ...componentSpecificItems,
            new TouchBarSpacer({ size: "flexible" }),
            new TouchBarOtherItemsProxy(),
            new TouchBarButton({
                icon: this.buildIcon("NSTouchBarAddDetailTemplate"),
                click: () => this.triggerCommand("jumpToNote")
            })
        ].flat();

        console.log("Update ", items);
        return new TouchBar({
            items
        });
    }

    refreshTouchBarEvent() {
        this.#refreshTouchBar();
    }

}
