import { type DowncastConversionApi, type DowncastInsertEvent, Plugin } from "ckeditor5";

/**
 * Tags the editing-view `<pre>` of every code block with `hljs`.
 *
 * The highlight.js themes Trilium injects are rewritten by `normalizeThemeCss` (see
 * `packages/highlightjs`) to target `.hljs, .ck-content pre.hljs`, whose specificity outranks
 * CKEditor's own `.ck-content pre` colours. Without this class the editor would keep CKEditor's
 * grey code block instead of the theme the user picked.
 *
 * Only the editing view is tagged — the data downcast is untouched, so the class never reaches
 * stored note content. This replaces a patch of `@ckeditor/ckeditor5-code-block` that set the
 * same attribute inline, and which broke on every release that rebuilt the bundled dist.
 */
export default class CodeBlockHljsClass extends Plugin {

    static get pluginName() {
        return "CodeBlockHljsClass" as const;
    }

    init() {
        this.editor.editing.downcastDispatcher.on<DowncastInsertEvent>("insert:codeBlock", (evt, data, conversionApi: DowncastConversionApi) => {
            /* v8 ignore next 3 -- the "insert:codeBlock" event only fires for code blocks; the check narrows the model item's type */
            if (!data.item.is("element", "codeBlock")) {
                return;
            }

            // CodeBlockEditing binds the model element to the inner <code>, so the <pre> we want
            // is its parent. "low" priority runs us once that element exists.
            const viewCode = conversionApi.mapper.toViewElement(data.item);
            const viewPre = viewCode?.parent;

            /* v8 ignore next 3 -- defensive: the code block is always converted to <pre><code> before this runs */
            if (!viewPre?.is("element", "pre")) {
                return;
            }

            conversionApi.writer.addClass("hljs", viewPre);
        }, { priority: "low" });
    }

}
