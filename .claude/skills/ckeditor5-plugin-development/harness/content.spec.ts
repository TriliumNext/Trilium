/**
 * Renders one note holding every kind of content element under the old and the new CKEditor
 * stylesheet, in each context of `CONTEXTS`, and prints what changed.
 */
import { it } from "vitest";

import { computed, CONTEXTS, mountStyles, probe, report, type Side } from "./zz_ckcss_kit";

const IMAGE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'/>";
const FIXTURE = `
<h2 data-k="h2">Heading 2</h2>
<h3 data-k="h3">Heading 3</h3>
<p data-k="p">Text <code data-k="code-inline">inline</code> <mark class="marker-yellow" data-k="marker">mark</mark>
    <a href="#x" data-k="link">link</a> <span class="text-tiny" data-k="text-tiny">t</span><span class="text-huge" data-k="text-huge">h</span>
    <span class="mention" data-k="mention">@m</span> <kbd data-k="kbd">Ctrl</kbd></p>
<blockquote data-k="blockquote"><p data-k="blockquote-p">Quote</p></blockquote>
<pre data-k="pre"><code class="language-plaintext" data-k="pre-code">code</code></pre>
<hr data-k="hr">
<figure class="table" data-k="figure-table"><table data-k="table"><thead><tr><th data-k="th">h</th></tr></thead>
    <tbody><tr><td data-k="td">a</td></tr></tbody></table><figcaption data-k="table-caption">Table caption</figcaption></figure>
<figure class="image" data-k="figure-image"><img src="${IMAGE}" data-k="img"><figcaption data-k="image-caption">Image caption</figcaption></figure>
<ul class="todo-list" data-k="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled checked data-k="todo-checkbox">
    <span class="todo-list__label__description" data-k="todo-text">todo</span></label></li></ul>
<ul data-k="ul"><li data-k="ul-li">bullet</li></ul>
<ol data-k="ol"><li data-k="ol-li">number</li></ol>
<div class="page-break" data-k="page-break"><span class="page-break__label" data-k="page-break-label">Page break</span></div>
<aside class="admonition note" data-k="admonition"><p>adm</p></aside>
`;
const PROPS = [ "color", "background-color", "border-top", "border-right", "border-bottom", "border-left", "border-radius",
    "padding", "margin", "font-size", "font-family", "font-style", "font-weight", "line-height", "height", "opacity",
    "box-shadow", "list-style-type", "text-decoration-line" ];
/** The editable a note renders in, in the app; elsewhere content sits in a plain `.ck-content`. */
const APP_WRAPPER = "note-detail-editable-text-editor ck ck-content ck-editor__editable ck-editor__editable_inline ck-rounded-corners ck-blurred";
/** Elements whose rules to list in the app context, by `data-k` (`editable` is the wrapper). */
const PROBE: Record<string, string[]> = {};

function measure(context: string, side: Side) {
    const unmount = mountStyles(CONTEXTS[context](side));
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "700px";
    const wrapper = host.appendChild(document.createElement("div"));
    wrapper.className = context.startsWith("app") ? APP_WRAPPER : "ck-content";
    if (context === "share") wrapper.id = "content";
    wrapper.dataset.k = "editable";
    wrapper.innerHTML = FIXTURE;
    const elements = [ wrapper, ...wrapper.querySelectorAll<HTMLElement>("[data-k]") ];
    const result = Object.fromEntries(elements.map((e) => [ e.dataset.k as string, computed(e, PROPS) ]));
    if (context === "app") {
        for (const [ key, props ] of Object.entries(PROBE)) {
            const element = elements.find((e) => e.dataset.k === key);
            if (element) probe(`${side} ${key}`, element, props);
        }
    }
    host.remove();
    unmount();
    return result;
}

for (const context of Object.keys(CONTEXTS)) {
    it(`content in ${context}`, () => {
        report(context, measure(context, "old"), measure(context, "new"));
    });
}
