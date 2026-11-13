import { ContextualBalloon, type ObservableSetEvent, Plugin } from "ckeditor5";

/**
 * Keeps the editor's `ContextualBalloon` hidden while the editing root is out of sight, such as
 * when the user switches to another tab, and shows it again when the root comes back.
 *
 * `BalloonPanelView` hides itself when a `ResizeObserver` reports its target and `getClientRects()`
 * returns no box. The client hides the split of a background tab with `content-visibility: hidden`,
 * which keeps every size and every box, so neither notices. An `IntersectionObserver` does.
 */
export default class HiddenEditorBalloons extends Plugin {

    private observer: IntersectionObserver | null = null;
    private isRootHidden = false;

    static get requires() {
        return [ ContextualBalloon ] as const;
    }

    static get pluginName() {
        return "HiddenEditorBalloons" as const;
    }

    init() {
        const balloon = this.editor.plugins.get(ContextualBalloon);

        // `LinkUI` and others place the balloon again on every UI update, hidden editor or not.
        this.listenTo<ObservableSetEvent<boolean>>(balloon.view, "set:isVisible",
            (evt, _name, isVisible) => {
                if (isVisible && this.isRootHidden) {
                    evt.return = false;
                }
            });

        this.listenTo(this.editor.ui, "ready", () => {
            this.observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    this.update(entry.isIntersecting);
                }
            });
            for (const root of this.editor.editing.view.domRoots.values()) {
                this.observer.observe(root);
            }
        });
    }

    override destroy() {
        this.observer?.disconnect();
        super.destroy();
    }

    private update(isRootShown: boolean) {
        const balloon = this.editor.plugins.get(ContextualBalloon);
        this.isRootHidden = !isRootShown;

        if (this.isRootHidden) {
            balloon.view.hide();
        } else if (balloon.visibleView && !balloon.view.isVisible) {
            balloon.updatePosition();
        }
    }
}
