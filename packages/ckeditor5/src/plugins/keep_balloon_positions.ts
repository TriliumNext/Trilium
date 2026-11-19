import { ContextualBalloon, type DecoratedMethodEvent, Plugin } from "ckeditor5";

/**
 * Makes `ContextualBalloon.updatePosition()` ignore a position without a target.
 *
 * `WidgetToolbarRepository` repositions the visible toolbar on `change:visibleView` at the DOM
 * element of `getRelatedElement()`, which is `undefined` when the selection is outside the widget.
 * `ContextualBalloon.remove()` can show the toolbar of a widget the selection has left, and
 * `new Rect()` throws when the balloon is later pinned to that position.
 */
export default class KeepBalloonPositions extends Plugin {

    static get requires() {
        return [ ContextualBalloon ] as const;
    }

    static get pluginName() {
        return "KeepBalloonPositions" as const;
    }

    init() {
        const balloon = this.editor.plugins.get(ContextualBalloon);
        balloon.decorate("updatePosition");
        this.listenTo<DecoratedMethodEvent<ContextualBalloon, "updatePosition">>(
            balloon, "updatePosition", (_evt, args) => {
                if (args[0] && !args[0].target) {
                    args[0] = undefined;
                }
            }, { priority: "high" });
    }

}
