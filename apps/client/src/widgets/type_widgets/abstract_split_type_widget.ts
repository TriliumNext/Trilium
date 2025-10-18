import type FNote from "../../entities/fnote.js";
import utils from "../../services/utils.js";
import EditableCodeTypeWidget from "./editable_code.js";
import TypeWidget from "./type_widget.js";
import Split from "split.js";
import { DEFAULT_GUTTER_SIZE } from "../../services/resizer.js";
import options from "../../services/options.js";
import type { EventData } from "../../components/app_context.js";
import type OnClickButtonWidget from "../buttons/onclick_button.js";
import type { EditorConfig } from "@triliumnext/codemirror";

const TPL = /*html*/`\
<div class="note-detail-split note-detail-printable">
    <div class="note-detail-split-editor-col">
        <div class="note-detail-split-editor"></div>
        <div class="admonition caution note-detail-error-container hidden-ext"></div>
    </div>
    <div class="note-detail-split-preview-col">
        <div class="note-detail-split-preview"></div>
        <div class="btn-group btn-group-sm map-type-switcher content-floating-buttons preview-buttons bottom-right" role="group"></div>
    </div>

    <style>
        .note-detail-split {
            display: flex;
            height: 100%;
        }

        .note-detail-split-editor-col {
            display: flex;
            flex-direction: column;
        }

        .note-detail-split-preview-col {
            position: relative;
        }

        .note-detail-split .note-detail-split-editor {
            width: 100%;
            flex-grow: 1;
        }

        .note-detail-split .note-detail-split-editor .note-detail-code {
            contain: size !important;
        }

        .note-detail-split .note-detail-error-container {
            font-family: var(--monospace-font-family);
            margin: 5px;
            white-space: pre-wrap;
            font-size: 0.85em;
        }

        .note-detail-split .note-detail-split-preview {
            transition: opacity 250ms ease-in-out;
            height: 100%;
        }

        .note-detail-split .note-detail-split-preview.on-error {
            opacity: 0.5;
        }

        /* Horizontal layout */

        .note-detail-split.split-horizontal > .note-detail-split-preview-col {
            border-inline-start: 1px solid var(--main-border-color);
        }

        .note-detail-split.split-horizontal > .note-detail-split-editor-col,
        .note-detail-split.split-horizontal > .note-detail-split-preview-col {
            height: 100%;
            width: 50%;
        }

        .note-detail-split.split-horizontal .note-detail-split-preview {
            height: 100%;
        }

        /* Vertical layout */

        .note-detail-split.split-vertical {
            flex-direction: column;
        }

        .note-detail-split.split-vertical > .note-detail-split-editor-col,
        .note-detail-split.split-vertical > .note-detail-split-preview-col {
            width: 100%;
            height: 50%;
        }

        .note-detail-split.split-vertical > .note-detail-split-editor-col {
            border-top: 1px solid var(--main-border-color);
        }

        .note-detail-split.split-vertical .note-detail-split-preview-col {
            order: -1;
        }

        /* Read-only view */

        .note-detail-split.split-read-only .note-detail-split-preview-col {
            width: 100%;
        }
    </style>
</div>
`;

/**
 * Abstract `TypeWidget` which contains a preview and editor pane, each displayed on half of the available screen.
 *
 * Features:
 *
 * - The two panes are resizeable via a split, on desktop. The split can be optionally customized via {@link buildSplitExtraOptions}.
 * - Can display errors to the user via {@link setError}.
 * - Horizontal or vertical orientation for the editor/preview split, adjustable via the switch split orientation button floating button.
 */
export default abstract class AbstractSplitTypeWidget extends TypeWidget {

    private splitInstance?: Split.Instance;

    protected $preview!: JQuery<HTMLElement>;
    private $editorCol!: JQuery<HTMLElement>;
    private $previewCol!: JQuery<HTMLElement>;
    private $editor!: JQuery<HTMLElement>;
    private $errorContainer!: JQuery<HTMLElement>;
    private editorTypeWidget: EditableCodeTypeWidget;
    private layoutOrientation?: "horizontal" | "vertical";
    private isReadOnly?: boolean;

    constructor() {
        super();

        this.editorTypeWidget = new EditableCodeTypeWidget(true);
        this.editorTypeWidget.updateBackgroundColor = () => {};
        this.editorTypeWidget.isEnabled = () => true;

        const defaultOptions = this.editorTypeWidget.getExtraOpts();
        this.editorTypeWidget.getExtraOpts = () => {
            return {
                ...defaultOptions,
                ...this.buildEditorExtraOptions()
            };
        };
    }

    doRender(): void {
        this.$widget = $(TPL);

        this.spacedUpdate.setUpdateInterval(750);

        // Preview pane
        this.$previewCol = this.$widget.find(".note-detail-split-preview-col");
        this.$preview = this.$widget.find(".note-detail-split-preview");

        // Editor pane
        this.$editorCol = this.$widget.find(".note-detail-split-editor-col");
        this.$editor = this.$widget.find(".note-detail-split-editor");
        this.$editor.append(this.editorTypeWidget.render());
        this.$errorContainer = this.$widget.find(".note-detail-error-container");
        this.#adjustLayoutOrientation();

        // Preview pane buttons
        const $previewButtons = this.$previewCol.find(".preview-buttons");
        const previewButtons = this.buildPreviewButtons();
        $previewButtons.toggle(previewButtons.length > 0);
        for (const previewButton of previewButtons) {
            const $button = previewButton.render();
            $button.removeClass("button-widget")
                .addClass("btn")
                .addClass("tn-tool-button");
            $previewButtons.append($button);
            previewButton.refreshIcon();
        }

        super.doRender();
    }

    cleanup(): void {
        this.#destroyResizer();
        this.editorTypeWidget.cleanup();
    }

    async doRefresh(note: FNote) {
        this.#adjustLayoutOrientation();

        if (!this.isReadOnly) {
            await this.editorTypeWidget.initialized;
            this.editorTypeWidget.noteContext = this.noteContext;
            this.editorTypeWidget.spacedUpdate = this.spacedUpdate;
            this.editorTypeWidget.doRefresh(note);
        }
    }

    #adjustLayoutOrientation() {
        // Read-only
        const isReadOnly = this.note?.hasLabel("readOnly");
        if (this.isReadOnly !== isReadOnly) {
            this.$editorCol.toggle(!isReadOnly);
        }

        // Vertical vs horizontal layout
        const layoutOrientation = (!utils.isMobile() ? options.get("splitEditorOrientation") ?? "horizontal" : "vertical");
        if (this.layoutOrientation !== layoutOrientation || this.isReadOnly !== isReadOnly) {
            this.$widget
                .toggleClass("split-horizontal", !isReadOnly && layoutOrientation === "horizontal")
                .toggleClass("split-vertical", !isReadOnly && layoutOrientation === "vertical")
                .toggleClass("split-read-only", isReadOnly);
            this.layoutOrientation = layoutOrientation as ("horizontal" | "vertical");
            this.isReadOnly = isReadOnly;
            this.#destroyResizer();
        }

        if (!this.splitInstance) {
            this.#setupResizer();
        }
    }

    #setupResizer() {
        if (!utils.isDesktop()) {
            return;
        }

        let elements = [ this.$editorCol[0], this.$previewCol[0] ];
        if (this.layoutOrientation === "vertical") {
            elements.reverse();
        }

        this.splitInstance?.destroy();

        if (!this.isReadOnly) {
            this.splitInstance = Split(elements, {
                sizes: [ 50, 50 ],
                direction: this.layoutOrientation,
                gutterSize: DEFAULT_GUTTER_SIZE,
                ...this.buildSplitExtraOptions()
            });
        } else {
            this.splitInstance = undefined;
        }
    }

    #destroyResizer() {
        this.splitInstance?.destroy();
        this.splitInstance = undefined;
    }

    /**
     * Called upon when the split between the preview and content pane is initialized. Can be used to add additional listeners if needed.
     */
    buildSplitExtraOptions(): Split.Options {
        return {};
    }

    /**
     * Called upon when the code editor is being initialized. Can be used to add additional options to the editor.
     */
    buildEditorExtraOptions(): Partial<EditorConfig> {
        return {
            lineWrapping: false
        };
    }

    buildPreviewButtons(): OnClickButtonWidget[] {
        return [];
    }

    setError(message: string | null | undefined) {
        this.$errorContainer.toggleClass("hidden-ext", !message);
        this.$preview.toggleClass("on-error", !!message);
        this.$errorContainer.text(message ?? "");
    }

    getData() {
        return this.editorTypeWidget.getData();
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.isOptionReloaded("splitEditorOrientation")) {
            this.refresh();
        }
    }

}
