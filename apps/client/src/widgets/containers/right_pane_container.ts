import type { EventData, EventNames } from "../../components/app_context.js";
import splitService from "../../services/resizer.js";
import type BasicWidget from "../basic_widget.js";
import FlexContainer from "./flex_container.js";

export default class RightPaneContainer extends FlexContainer<BasicWidget> {
    private rightPaneHidden: boolean;
    private firstRender: boolean;

    constructor() {
        super("column");

        this.id("right-pane");
        this.css("height", "100%");
        this.collapsible();

        this.rightPaneHidden = false;
        this.firstRender = true;
    }

    isEnabled() {
        return super.isEnabled() && !this.rightPaneHidden && this.children.length > 0 && !!this.children.find((ch) => ch.isEnabled() && ch.canBeShown());
    }

    async handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>) {
        const promise = super.handleEventInChildren(name, data);

        if (["activeContextChanged", "noteSwitchedAndActivated", "noteSwitched"].includes(name)) {
            // the right pane is displayed only if some child widget is active,
            // we'll reevaluate the visibility based on events which are probable to cause visibility change
            // but these events need to be finished and only then we check
            if (promise) {
                promise.then(() => this.reEvaluateRightPaneVisibilityCommand());
            } else {
                this.reEvaluateRightPaneVisibilityCommand();
            }
        }

        return promise;
    }

    reEvaluateRightPaneVisibilityCommand() {
        const oldToggle = !this.isHiddenInt();
        const newToggle = this.isEnabled();

        if (oldToggle !== newToggle || this.firstRender) {
            this.toggleInt(newToggle);

            splitService.setupRightPaneResizer();
            this.firstRender = false;
        }
    }

    toggleRightPaneEvent() {
        this.rightPaneHidden = !this.rightPaneHidden;

        this.reEvaluateRightPaneVisibilityCommand();
    }
}
