import { Component, h, VNode } from "preact";

import type FNote from "../entities/fnote.js";
import { renderReactWidgetAtElement } from "../widgets/react/react_utils.jsx";
import { type Bundle, executeBundleWithoutErrorHandling } from "./bundle.js";
import froca from "./froca.js";
import server from "./server.js";

type ErrorHandler = (e: unknown) => void;

async function render(note: FNote, $el: JQuery<HTMLElement>, onError?: ErrorHandler) {
    const relations = note.getRelations("renderNote");
    const renderNoteIds = relations.map((rel) => rel.value).filter((noteId) => noteId);

    $el.empty().toggle(renderNoteIds.length > 0);

    try {
        for (const renderNoteId of renderNoteIds) {
            const bundle = await server.postWithSilentInternalServerError<Bundle>(`script/bundle/${renderNoteId}`);

            const $scriptContainer = $("<div>");
            $el.append($scriptContainer);

            $scriptContainer.append(bundle.html);

            // async so that scripts cannot block trilium execution
            executeBundleWithoutErrorHandling(bundle, note, $scriptContainer)
                .catch(onError)
                .then(result => {
                    // Render JSX
                    if (bundle.html === "") {
                        renderIfJsx(bundle, result, $el, onError).catch(onError);
                    }
                });
        }

        return renderNoteIds.length > 0;
    } catch (e) {
        if (typeof e === "string" && e.startsWith("{") && e.endsWith("}")) {
            try {
                onError?.(JSON.parse(e));
            } catch (e) {
                onError?.(e);
            }
        } else {
            onError?.(e);
        }
    }
}

async function renderIfJsx(bundle: Bundle, result: unknown, $el: JQuery<HTMLElement>, onError?: ErrorHandler) {
    // Ensure the root script note is actually a JSX.
    const rootScriptNoteId = await froca.getNote(bundle.noteId);
    if (rootScriptNoteId?.mime !== "text/jsx") return;

    // Ensure the output is a valid el.
    if (typeof result !== "function") return;

    // Obtain the parent component.
    const closestComponent = glob.getComponentByEl($el.closest(".component")[0]);
    if (!closestComponent) return;

    // Render the element.
    const UserErrorBoundary = class UserErrorBoundary extends Component {
        constructor(props: object) {
            super(props);
            this.state = { error: null };
        }

        componentDidCatch(error: unknown) {
            onError?.(error);
            this.setState({ error });
        }

        render() {
            if ("error" in this.state && this.state?.error) return null;
            return this.props.children;
        }
    };
    const el = h(UserErrorBoundary, {}, h(result as () => VNode, {}));
    renderReactWidgetAtElement(closestComponent, el, $el[0]);
}

export default {
    render
};
