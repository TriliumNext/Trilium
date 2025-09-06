import type { EventData } from "../../components/app_context.js";
import type FNote from "../../entities/fnote.js";
import AbstractCodeTypeWidget from "./abstract_code_type_widget.js";
import utils from "../../services/utils.js";

const TPL = /*html*/`
<div class="note-detail-readonly-code note-detail-printable">
    <style>
    .note-detail-readonly-code {
        min-height: 50px;
        position: relative;
    }
    </style>

    <pre class="note-detail-readonly-code-content"></pre>
</div>`;

export default class ReadOnlyCodeTypeWidget extends AbstractCodeTypeWidget {

    static getType() {
        return "readOnlyCode";
    }

    doRender() {
        this.$widget = $(TPL);
        this.contentSized();
        this.$editor = this.$widget.find(".note-detail-readonly-code-content");

        super.doRender();
    }

    async doRefresh(note: FNote) {
        const blob = await this.note?.getBlob();
        if (!blob) return;

        const isFormattable = note.type === "text" && this.noteContext?.viewScope?.viewMode === "source";
        const content = isFormattable ? utils.formatHtml(blob.content) : blob.content;

        this._update(note, content);
        this.show();
    }

    getExtraOpts() {
        return {
            readOnly: true
        };
    }

    async executeWithContentElementEvent({ resolve, ntxId }: EventData<"executeWithContentElement">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        await this.initialized;

        resolve(this.$editor);
    }
}
