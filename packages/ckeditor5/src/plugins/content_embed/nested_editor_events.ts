import { Observer } from "ckeditor5";

/**
 * Lets an editor nested in the content of an embed handle its own events.
 *
 * An observer ignores the events from inside an element marked `data-cke-ignore-events`, as the
 * wrapper of an embed is. A nested editor is inside that wrapper too, so for an event from an
 * editable root of the observer's view, only a marked element inside that root counts.
 */
const checkShouldIgnoreEventFromTarget = Observer.prototype.checkShouldIgnoreEventFromTarget;

Observer.prototype.checkShouldIgnoreEventFromTarget = function (
    this: Observer,
    domTarget: Node | null
) {
    const element = domTarget?.nodeType === Node.TEXT_NODE ? domTarget.parentElement : domTarget;
    const root = element instanceof Element
        ? [ ...this.view.domRoots.values() ].find((domRoot) => domRoot.contains(element))
        : undefined;
    if (!root || !(element instanceof Element)) {
        return checkShouldIgnoreEventFromTarget.call(this, domTarget);
    }

    const marker = element.closest("[data-cke-ignore-events]");
    return !!marker && root.contains(marker);
};
