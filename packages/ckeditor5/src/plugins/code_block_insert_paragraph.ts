import { CodeBlock, MouseObserver, Plugin, type DowncastConversionApi, type DowncastInsertEvent, type ViewDowncastWriter, type ViewElement } from "ckeditor5";
import "../theme/code_block_insert_paragraph.css";

/*
 * Adds "insert paragraph before/after" hover buttons to code blocks, mirroring the
 * type-around affordance that CKEditor's WidgetTypeAround plugin provides for block
 * widgets (tables, images, horizontal lines, ...).
 *
 * Code blocks are NOT widgets — they downcast to a plain editable <pre><code> — so
 * WidgetTypeAround skips them and exposes no public API to opt them in. This plugin
 * re-implements the slice we need: a non-editable UI element injected into the editing
 * view, plus a click handler that inserts a paragraph next to the block.
 *
 * The UI element is injected into the <code> element (the one the model `codeBlock` is
 * bound to), exactly like WidgetTypeAround injects into its mapped widget element — NOT
 * into the parent <pre>. Injecting into a non-mapped container breaks downcast removal
 * (e.g. a code block inside a list item throws `view-writer-invalid-range-container` when
 * the content is replaced), because the stray child shifts the trimmed remove range out
 * of its container. The buttons stay positioned against the <pre> via CSS (it is the
 * nearest positioned ancestor), so the placement is unaffected.
 */

const POSITIONS = ["before", "after"] as const;
type InsertPosition = typeof POSITIONS[number];

const WRAPPER_CLASS = "ck-code-block__type-around";
const BUTTON_CLASS = "ck-code-block__type-around__button";

export default class CodeBlockInsertParagraph extends Plugin {

    static get requires() {
        return [CodeBlock] as const;
    }

    static get pluginName() {
        return "CodeBlockInsertParagraph" as const;
    }

    init() {
        // The click handler listens to view-document `mousedown`, which is only fired when a
        // MouseObserver is registered. The Widget plugin normally adds it, but register it here
        // too so this plugin works even without other widget-based features loaded.
        this.editor.editing.view.addObserver(MouseObserver);

        this._enableUIInjection();
        this._enableInsertingParagraphsOnButtonClick();
    }

    /**
     * Injects the type-around UI element into every code block created in the editing view.
     * Runs at low priority so the default CodeBlock converter has already built <pre><code>.
     * Re-fires on reconversion (e.g. language change), so the buttons survive rebuilds.
     */
    private _enableUIInjection() {
        const editor = this.editor;
        const t = editor.locale.t;
        const titles: Record<InsertPosition, string> = {
            before: t("Insert paragraph before code block"),
            after: t("Insert paragraph after code block")
        };

        editor.editing.downcastDispatcher.on<DowncastInsertEvent>("insert", (evt, data, conversionApi: DowncastConversionApi) => {
            if (!data.item.is("element", "codeBlock")) {
                return;
            }

            const viewCode = conversionApi.mapper.toViewElement(data.item);
            /* v8 ignore next 3 -- defensive: at low priority the code block has already been converted, so it always maps to a view element */
            if (!viewCode) {
                return;
            }

            injectButtons(conversionApi.writer, viewCode, titles);
        }, { priority: "low" });
    }

    /**
     * Intercepts mousedown on the injected buttons and inserts a paragraph next to the
     * related code block. A single delegated listener (rather than per-button handlers)
     * avoids having to clean up listeners as code blocks come and go.
     */
    private _enableInsertingParagraphsOnButtonClick() {
        const editor = this.editor;
        const view = editor.editing.view;

        this.listenTo(view.document, "mousedown", (evt, domEventData) => {
            const domTarget = domEventData.domTarget;
            /* v8 ignore next 3 -- defensive: a real mousedown always targets an Element (CKEditor's own widget code assumes the same) */
            if (!(domTarget instanceof Element)) {
                return;
            }

            const button = domTarget.closest(`.${BUTTON_CLASS}`);
            if (!button) {
                return;
            }

            const position: InsertPosition = button.classList.contains(`${BUTTON_CLASS}_before`) ? "before" : "after";
            const domCode = button.closest("pre")?.querySelector("code");
            const viewCode = domCode ? view.domConverter.mapDomToView(domCode) : undefined;
            const codeBlock = viewCode?.is("element") ? editor.editing.mapper.toModelElement(viewCode) : null;
            if (!codeBlock) {
                return;
            }

            editor.execute("insertParagraph", {
                position: editor.model.createPositionAt(codeBlock, position)
            });
            view.focus();
            view.scrollToTheSelection();

            domEventData.preventDefault();
            evt.stop();
        });
    }

}

const RETURN_ARROW_ICON = '<svg viewBox="0 0 10 8" xmlns="http://www.w3.org/2000/svg"><path d="M9.055.263v3.972h-6.77M1 4.216l2-2.038m-2 2 2 2.038"/></svg>';

function injectButtons(writer: ViewDowncastWriter, codeElement: ViewElement, titles: Record<InsertPosition, string>) {
    const wrapper = writer.createUIElement("div", { class: `ck ck-reset_all ${WRAPPER_CLASS}` }, function (domDocument) {
        const domElement = this.toDomElement(domDocument);
        for (const position of POSITIONS) {
            const button = domDocument.createElement("div");
            button.className = `ck ${BUTTON_CLASS} ${BUTTON_CLASS}_${position}`;
            button.title = titles[position];
            button.setAttribute("aria-hidden", "true");
            button.innerHTML = RETURN_ARROW_ICON;
            domElement.appendChild(button);
        }
        return domElement;
    });

    writer.insert(writer.createPositionAt(codeElement, "end"), wrapper);
}
