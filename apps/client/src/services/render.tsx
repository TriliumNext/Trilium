import { Component, h, VNode } from "preact";

import type AppComponent from "../components/component.js";

import type FNote from "../entities/fnote.js";
import { disposeReactWidget, renderReactWidgetAtElement } from "../widgets/react/react_utils.jsx";
import { type Bundle, executeBundleWithoutErrorHandling } from "./bundle.js";
import froca from "./froca.js";
import { trackPendingRender } from "./pending_renders.js";
import { keepStylesScoped, RENDER_SCOPE_CLASS } from "./render_css_scope.js";

/**
 * @param noteId the render note the error is attributed to, so the caller can link back to it.
 */
type ErrorHandler = (e: unknown, noteId?: string) => void;

interface RenderOptions {
    /** The component a JSX render note's element mounts under; by default the closest `.component` element's. */
    parentComponent?: AppComponent;
    /** Once aborted, the render mounts nothing and reports no errors, so a stale render cannot leave a portal behind. */
    signal?: AbortSignal;
}

export async function render(note: FNote, $el: JQuery<HTMLElement>, onError?: ErrorHandler, options: RenderOptions = {}) {
    const { signal } = options;
    const relations = note.getRelations("renderNote");
    const renderNoteIds = relations.map((rel) => rel.value).filter((noteId) => noteId);
    const reportError: ErrorHandler = (e, noteId) => {
        if (!signal?.aborted) onError?.(e, noteId);
    };

    disposeReactWidget($el[0]);
    $el.empty().toggle(renderNoteIds.length > 0);

    let currentRenderNoteId: string | undefined;
    try {
        for (const renderNoteId of renderNoteIds) {
            currentRenderNoteId = renderNoteId;
            const bundle = await froca.getScriptBundle(renderNoteId);
            if (signal?.aborted) return;

            if (!bundle) {
                throw new Error(`Script note '${renderNoteId}' could not be loaded. It may be protected and require an active protected session.`);
            }

            const $scriptContainer = $("<div>").addClass(RENDER_SCOPE_CLASS);
            $el.append($scriptContainer);

            $scriptContainer.append(bundle.html);
            keepStylesScoped($scriptContainer[0]);

            // Not awaited, so that a script cannot block Trilium. `trackPendingRender` lets printing
            // wait for the script and its JSX mount before it captures the page.
            const work = executeBundleWithoutErrorHandling(bundle, note, $scriptContainer)
                .catch((e) => reportError(e, renderNoteId))
                .then(async (result) => {
                    if (bundle.html === "") {
                        await renderIfJsx(bundle, result, $el, reportError, options).catch((e) => reportError(e, bundle.noteId));
                    }
                });
            trackPendingRender($el[0], work);
        }

        return renderNoteIds.length > 0;
    } catch (e) {
        if (typeof e === "string" && e.startsWith("{") && e.endsWith("}")) {
            try {
                reportError(JSON.parse(e), currentRenderNoteId);
            } catch (e) {
                reportError(e, currentRenderNoteId);
            }
        } else {
            reportError(e, currentRenderNoteId);
        }
    }
}

export async function renderIfJsx(bundle: Bundle, result: unknown, $el: JQuery<HTMLElement>, onError?: ErrorHandler, { parentComponent, signal }: RenderOptions = {}) {
    // Ensure the root script note is actually a JSX.
    const rootScriptNoteId = await froca.getNote(bundle.noteId);
    if (signal?.aborted) return;
    if (rootScriptNoteId?.mime !== "text/jsx") return;

    // Ensure the output is a valid el.
    if (typeof result !== "function") return;

    // Obtain the parent component.
    const closestComponent = parentComponent ?? glob.getComponentByEl($el.closest(".component")[0]);
    if (!closestComponent) return;

    // Render the element.
    const UserErrorBoundary = class UserErrorBoundary extends Component {
        constructor(props: object) {
            super(props);
            this.state = { error: null };
        }

        componentDidCatch(error: unknown) {
            onError?.(error, bundle.noteId);
            this.setState({ error });
        }

        render() {
            if ("error" in this.state && this.state?.error) return null;
            return this.props.children;
        }
    };
    // The tree replaces the container `render()` scoped the note's styles to, so it brings its own:
    // `keepStylesScoped()` watches it and the `@scope` rules are rooted at it.
    const el = h("div", { className: RENDER_SCOPE_CLASS, ref: scopeStyles },
        h(UserErrorBoundary, {}, h(result as () => VNode, {})));
    renderReactWidgetAtElement(closestComponent, el, $el[0]);
}

function scopeStyles(container: HTMLDivElement | null) {
    if (container) {
        keepStylesScoped(container);
    }
}

export default {
    render
};
