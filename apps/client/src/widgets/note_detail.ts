import { t } from "../services/i18n.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import SpacedUpdate from "../services/spaced_update.js";
import server from "../services/server.js";
import appContext, { type CommandListenerData, type EventData } from "../components/app_context.js";
import keyboardActionsService from "../services/keyboard_actions.js";
import noteCreateService from "../services/note_create.js";
import attributeService from "../services/attributes.js";

import EmptyTypeWidget from "./type_widgets/empty.js";
import EditableTextTypeWidget from "./type_widgets/editable_text.js";
import EditableCodeTypeWidget from "./type_widgets/editable_code.js";
import FileTypeWidget from "./type_widgets/file.js";
import ImageTypeWidget from "./type_widgets/image.js";
import RenderTypeWidget from "./type_widgets/render.js";
import RelationMapTypeWidget from "./type_widgets/relation_map.js";
import CanvasTypeWidget from "./type_widgets/canvas.js";
import ProtectedSessionTypeWidget from "./type_widgets/protected_session.js";
import BookTypeWidget from "./type_widgets/book.js";
import ReadOnlyTextTypeWidget from "./type_widgets/read_only_text.js";
import ReadOnlyCodeTypeWidget from "./type_widgets/read_only_code.js";
import NoneTypeWidget from "./type_widgets/none.js";
import NoteMapTypeWidget from "./type_widgets/note_map.js";
import WebViewTypeWidget from "./type_widgets/web_view.js";
import DocTypeWidget from "./type_widgets/doc.js";
import ContentWidgetTypeWidget from "./type_widgets/content_widget.js";
import AttachmentListTypeWidget from "./type_widgets/attachment_list.js";
import AttachmentDetailTypeWidget from "./type_widgets/attachment_detail.js";
import MindMapWidget from "./type_widgets/mind_map.js";
import ReadOnlyOCRTextWidget from "./type_widgets/read_only_ocr_text.js";
import utils from "../services/utils.js";
import type { NoteType } from "../entities/fnote.js";
import type TypeWidget from "./type_widgets/type_widget.js";
import { MermaidTypeWidget } from "./type_widgets/mermaid.js";
import AiChatTypeWidget from "./type_widgets/ai_chat.js";

const TPL = /*html*/`
<div class="note-detail">
    <style>
    .note-detail {
        font-family: var(--detail-font-family);
        font-size: var(--detail-font-size);
    }

    .note-detail.full-height {
        height: 100%;
    }
    </style>
</div>
`;

const typeWidgetClasses = {
    empty: EmptyTypeWidget,
    editableText: EditableTextTypeWidget,
    readOnlyText: ReadOnlyTextTypeWidget,
    editableCode: EditableCodeTypeWidget,
    readOnlyCode: ReadOnlyCodeTypeWidget,
    readOnlyOCRText: ReadOnlyOCRTextWidget,
    file: FileTypeWidget,
    image: ImageTypeWidget,
    search: NoneTypeWidget,
    render: RenderTypeWidget,
    relationMap: RelationMapTypeWidget,
    canvas: CanvasTypeWidget,
    protectedSession: ProtectedSessionTypeWidget,
    book: BookTypeWidget,
    noteMap: NoteMapTypeWidget,
    webView: WebViewTypeWidget,
    doc: DocTypeWidget,
    contentWidget: ContentWidgetTypeWidget,
    attachmentDetail: AttachmentDetailTypeWidget,
    attachmentList: AttachmentListTypeWidget,
    mindMap: MindMapWidget,
    aiChat: AiChatTypeWidget,

    // Split type editors
    mermaid: MermaidTypeWidget
};

/**
 * A `NoteType` altered by the note detail widget, taking into consideration whether the note is editable or not and adding special note types such as an empty one,
 * for protected session or attachment information.
 */
type ExtendedNoteType =
    | Exclude<NoteType, "launcher" | "text" | "code">
    | "empty"
    | "readOnlyCode"
    | "readOnlyText"
    | "readOnlyOCRText"
    | "editableText"
    | "editableCode"
    | "attachmentDetail"
    | "attachmentList"
    | "protectedSession"
    | "aiChat";

export default class NoteDetailWidget extends NoteContextAwareWidget {

    private typeWidgets: Record<string, TypeWidget>;
    private spacedUpdate: SpacedUpdate;
    private type?: ExtendedNoteType;
    private mime?: string;

    constructor() {
        super();

        this.typeWidgets = {};

        this.spacedUpdate = new SpacedUpdate(async () => {
            if (!this.noteContext) {
                return;
            }

            const { note } = this.noteContext;
            if (!note) {
                return;
            }

            const { noteId } = note;

            const data = await this.getTypeWidget().getData();

            // for read only notes
            if (data === undefined) {
                return;
            }

            protectedSessionHolder.touchProtectedSessionIfNecessary(note);

            await server.put(`notes/${noteId}/data`, data, this.componentId);

            this.getTypeWidget().dataSaved();
        });

        appContext.addBeforeUnloadListener(this);
    }

    isEnabled() {
        return true;
    }

    doRender() {
        this.$widget = $(TPL);
        this.contentSized();
    }

    async refresh() {
        this.type = await this.getWidgetType();
        this.mime = this.note?.mime;

        if (!(this.type in this.typeWidgets)) {
            const clazz = typeWidgetClasses[this.type];

            if (!clazz) {
                throw new Error(`Cannot find type widget for type '${this.type}'`);
            }

            const typeWidget = (this.typeWidgets[this.type] = new clazz());
            typeWidget.spacedUpdate = this.spacedUpdate;
            typeWidget.setParent(this);

            if (this.noteContext) {
                typeWidget.setNoteContextEvent({ noteContext: this.noteContext });
            }
            const $renderedWidget = typeWidget.render();
            keyboardActionsService.updateDisplayedShortcuts($renderedWidget);

            this.$widget.append($renderedWidget);

            if (this.noteContext) {
                await typeWidget.handleEvent("setNoteContext", { noteContext: this.noteContext });
            }

            // this is happening in update(), so note has been already set, and we need to reflect this
            if (this.noteContext) {
                await typeWidget.handleEvent("noteSwitched", {
                    noteContext: this.noteContext,
                    notePath: this.noteContext.notePath
                });
            }

            this.child(typeWidget);
        }

        this.checkFullHeight();

        if (utils.isMobile()) {
            const hasFixedTree = this.noteContext?.hoistedNoteId === "_lbMobileRoot";
            $("body").toggleClass("force-fixed-tree", hasFixedTree);
        }
    }

    /**
     * sets full height of container that contains note content for a subset of note-types
     */
    checkFullHeight() {
        // https://github.com/zadam/trilium/issues/2522
        const isBackendNote = this.noteContext?.noteId === "_backendLog";
        const isSqlNote = this.mime === "text/x-sqlite;schema=trilium";
        const isFullHeightNoteType = ["canvas", "webView", "noteMap", "mindMap", "mermaid", "file"].includes(this.type ?? "");
        const isFullHeight = (!this.noteContext?.hasNoteList() && isFullHeightNoteType && !isSqlNote)
            || this.noteContext?.viewScope?.viewMode === "attachments"
            || isBackendNote;

        this.$widget.toggleClass("full-height", isFullHeight);
    }

    getTypeWidget() {
        if (!this.type || !this.typeWidgets[this.type]) {
            throw new Error(t(`note_detail.could_not_find_typewidget`, { type: this.type }));
        }

        return this.typeWidgets[this.type];
    }

    async getWidgetType(): Promise<ExtendedNoteType> {
        const note = this.note;
        if (!note) {
            return "empty";
        }

        const type = note.type;
        let resultingType: ExtendedNoteType;
        const viewScope = this.noteContext?.viewScope;

        if (viewScope?.viewMode === "source") {
            resultingType = "readOnlyCode";
        } else if (viewScope?.viewMode === "ocr") {
            resultingType = "readOnlyOCRText";
        } else if (viewScope && viewScope.viewMode === "attachments") {
            resultingType = viewScope.attachmentId ? "attachmentDetail" : "attachmentList";
        } else if (type === "text" && (await this.noteContext?.isReadOnly())) {
            resultingType = "readOnlyText";
        } else if ((type === "code" || type === "mermaid") && (await this.noteContext?.isReadOnly())) {
            resultingType = "readOnlyCode";
        } else if (type === "text") {
            resultingType = "editableText";
        } else if (type === "code") {
            resultingType = "editableCode";
        } else if (type === "launcher") {
            resultingType = "doc";
        } else {
            resultingType = type;
        }

        if (note.isProtected && !protectedSessionHolder.isProtectedSessionAvailable()) {
            resultingType = "protectedSession";
        }

        return resultingType;
    }

    async focusOnDetailEvent({ ntxId }: EventData<"focusOnDetail">) {
        if (this.noteContext?.ntxId !== ntxId) {
            return;
        }

        await this.refresh();
        const widget = this.getTypeWidget();
        await widget.initialized;
        widget.focus();
    }

    async scrollToEndEvent({ ntxId }: EventData<"scrollToEnd">) {
        if (this.noteContext?.ntxId !== ntxId) {
            return;
        }

        await this.refresh();
        const widget = this.getTypeWidget();
        await widget.initialized;

        if (widget.scrollToEnd) {
            widget.scrollToEnd();
        }
    }

    async beforeNoteSwitchEvent({ noteContext }: EventData<"beforeNoteSwitch">) {
        if (this.isNoteContext(noteContext.ntxId)) {
            await this.spacedUpdate.updateNowIfNecessary();
        }
    }

    async beforeNoteContextRemoveEvent({ ntxIds }: EventData<"beforeNoteContextRemove">) {
        if (this.isNoteContext(ntxIds)) {
            await this.spacedUpdate.updateNowIfNecessary();
        }
    }

    async runActiveNoteCommand(params: CommandListenerData<"runActiveNote">) {
        if (this.isNoteContext(params.ntxId)) {
            // make sure that script is saved before running it #4028
            await this.spacedUpdate.updateNowIfNecessary();
        }

        return await this.parent?.triggerCommand("runActiveNote", params);
    }

    async printActiveNoteEvent() {
        if (!this.noteContext?.isActive()) {
            return;
        }

        window.print();
    }

    async exportAsPdfEvent() {
        if (!this.noteContext?.isActive() || !this.note) {
            return;
        }

        const { ipcRenderer } = utils.dynamicRequire("electron");
        ipcRenderer.send("export-as-pdf", {
            title: this.note.title,
            pageSize: this.note.getAttributeValue("label", "printPageSize") ?? "Letter",
            landscape: this.note.hasAttribute("label", "printLandscape")
        });
    }

    hoistedNoteChangedEvent({ ntxId }: EventData<"hoistedNoteChanged">) {
        if (this.isNoteContext(ntxId)) {
            this.refresh();
        }
    }

    async entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        // we're detecting note type change on the note_detail level, but triggering the noteTypeMimeChanged
        // globally, so it gets also to e.g. ribbon components. But this means that the event can be generated multiple
        // times if the same note is open in several tabs.

        if (this.noteId && loadResults.isNoteContentReloaded(this.noteId, this.componentId)) {
            // probably incorrect event
            // calling this.refresh() is not enough since the event needs to be propagated to children as well
            // FIXME: create a separate event to force hierarchical refresh

            // this uses handleEvent to make sure that the ordinary content updates are propagated only in the subtree
            // to avoid the problem in #3365
            this.handleEvent("noteTypeMimeChanged", { noteId: this.noteId });
        } else if (this.noteId && loadResults.isNoteReloaded(this.noteId, this.componentId) && (this.type !== (await this.getWidgetType()) || this.mime !== this.note?.mime)) {
            // this needs to have a triggerEvent so that e.g., note type (not in the component subtree) is updated
            this.triggerEvent("noteTypeMimeChanged", { noteId: this.noteId });
        } else {
            const attrs = loadResults.getAttributeRows();

            const label = attrs.find(
                (attr) =>
                    attr.type === "label" &&
                    ["readOnly", "autoReadOnlyDisabled", "cssClass", "displayRelations", "hideRelations"].includes(attr.name ?? "") &&
                    attributeService.isAffecting(attr, this.note)
            );

            const relation = attrs.find((attr) => attr.type === "relation" && ["template", "inherit", "renderNote"].includes(attr.name ?? "") && attributeService.isAffecting(attr, this.note));

            if (this.noteId && (label || relation)) {
                // probably incorrect event
                // calling this.refresh() is not enough since the event needs to be propagated to children as well
                this.triggerEvent("noteTypeMimeChanged", { noteId: this.noteId });
            }
        }
    }

    beforeUnloadEvent() {
        return this.spacedUpdate.isAllSavedAndTriggerUpdate();
    }

    readOnlyTemporarilyDisabledEvent({ noteContext }: EventData<"readOnlyTemporarilyDisabled">) {
        if (this.isNoteContext(noteContext.ntxId)) {
            this.refresh();
        }
    }

    async executeInActiveNoteDetailWidgetEvent({ callback }: EventData<"executeInActiveNoteDetailWidget">) {
        if (!this.isActiveNoteContext()) {
            return;
        }

        await this.initialized;

        callback(this);
    }

    async cutIntoNoteCommand() {
        const note = appContext.tabManager.getActiveContextNote();

        if (!note) {
            return;
        }

        // without await as this otherwise causes deadlock through component mutex
        const parentNotePath = appContext.tabManager.getActiveContextNotePath();
        if (this.noteContext && parentNotePath) {
            noteCreateService.createNote(parentNotePath, {
                isProtected: note.isProtected,
                saveSelection: true,
                textEditor: await this.noteContext.getTextEditor()
            });
        }
    }

    // used by cutToNote in CKEditor build
    async saveNoteDetailNowCommand() {
        await this.spacedUpdate.updateNowIfNecessary();
    }

    renderActiveNoteEvent() {
        if (this.noteContext?.isActive()) {
            this.refresh();
        }
    }

    async executeWithTypeWidgetEvent({ resolve, ntxId }: EventData<"executeWithTypeWidget">) {
        if (!this.isNoteContext(ntxId)) {
            return;
        }

        await this.initialized;

        await this.getWidgetType();

        resolve(this.getTypeWidget());
    }
}
