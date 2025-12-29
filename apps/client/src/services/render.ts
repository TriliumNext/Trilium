import { h, VNode } from "preact";

import type FNote from "../entities/fnote.js";
import { renderReactWidgetAtElement } from "../widgets/react/react_utils.jsx";
import bundleService, { type Bundle } from "./bundle.js";
import froca from "./froca.js";
import server from "./server.js";

async function render(note: FNote, $el: JQuery<HTMLElement>) {
    const relations = note.getRelations("renderNote");
    const renderNoteIds = relations.map((rel) => rel.value).filter((noteId) => noteId);

    $el.empty().toggle(renderNoteIds.length > 0);

    for (const renderNoteId of renderNoteIds) {
        const bundle = await server.post<Bundle>(`script/bundle/${renderNoteId}`);

        const $scriptContainer = $("<div>");
        $el.append($scriptContainer);

        $scriptContainer.append(bundle.html);

        // async so that scripts cannot block trilium execution
        bundleService.executeBundle(bundle, note, $scriptContainer).then(result => {
            // Render JSX
            if (bundle.html === "") {
                renderIfJsx(bundle, result, $el);
            }
        });
    }

    return renderNoteIds.length > 0;
}

async function renderIfJsx(bundle: Bundle, result: unknown, $el: JQuery<HTMLElement>) {
    // Ensure the root script note is actually a JSX.
    const rootScriptNoteId = await froca.getNote(bundle.noteId);
    if (rootScriptNoteId?.mime !== "text/jsx") return;

    // Ensure the output is a valid el.
    if (typeof result !== "function") return;

    // Obtain the parent component.
    const closestComponent = glob.getComponentByEl($el.closest(".component")[0]);
    if (!closestComponent) return;

    // Render the element.
    const el = h(result as () => VNode, {});
    renderReactWidgetAtElement(closestComponent, el, $el[0]);
}

export default {
    render
};
