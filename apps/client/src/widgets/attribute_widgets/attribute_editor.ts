import { t } from "../../services/i18n.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import noteAutocompleteService, { type Suggestion } from "../../services/note_autocomplete.js";
import server from "../../services/server.js";
import contextMenuService from "../../menus/context_menu.js";
import attributeParser, { type Attribute } from "../../services/attribute_parser.js";
import { AttributeEditor, type EditorConfig, type ModelElement, type MentionFeed, type ModelNode, type ModelPosition } from "@triliumnext/ckeditor5";
import froca from "../../services/froca.js";
import attributeRenderer from "../../services/attribute_renderer.js";
import noteCreateService from "../../services/note_create.js";
import attributeService from "../../services/attributes.js";
import linkService from "../../services/link.js";
import type AttributeDetailWidget from "./attribute_detail.js";
import type { CommandData, EventData, EventListener, FilteredCommandNames } from "../../components/app_context.js";
import type { default as FAttribute, AttributeType } from "../../entities/fattribute.js";
import type FNote from "../../entities/fnote.js";
import { escapeQuotes } from "../../services/utils.js";

const HELP_TEXT = `
<p>${t("attribute_editor.help_text_body1")}</p>

<p>${t("attribute_editor.help_text_body2")}</p>

<p>${t("attribute_editor.help_text_body3")}</p>`;

const TPL = /*html*/`
<div style="position: relative; padding-top: 10px; padding-bottom: 10px">
    <style>
    .attribute-list-editor {
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        padding: 0 100px 0 5px !important;
        margin: 0 !important;
        max-height: 100px;
        overflow: auto;
        transition: opacity .1s linear;
    }

    .attribute-list-editor.ck-content .mention {
        color: var(--muted-text-color) !important;
        background: transparent !important;
    }

    .attribute-editor-buttons {
        display: flex;
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        align-items: center;
        gap: 10px;
    }

    .attribute-errors {
        color: red;
        padding: 5px 100px 0px 5px; /* large right padding to avoid buttons */
    }
    </style>

    <div class="attribute-list-editor" tabindex="200"></div>

    <div class="attribute-editor-buttons">
        <button class="bx bx-save save-attributes-button btn icon-action tn-tool-button" title="${escapeQuotes(t("attribute_editor.save_attributes"))}"></button>
        <button class="bx bx-plus add-new-attribute-button btn icon-action tn-tool-button" title="${escapeQuotes(t("attribute_editor.add_a_new_attribute"))}"></button>
    </div>

    <div class="attribute-errors" style="display: none;"></div>
</div>
`;

const mentionSetup: MentionFeed[] = [
    {
        marker: "@",
        feed: (queryText) => noteAutocompleteService.autocompleteSourceForCKEditor(queryText),
        itemRenderer: (_item) => {
            const item = _item as Suggestion;
            const itemElement = document.createElement("button");

            itemElement.innerHTML = `${item.highlightedNotePathTitle} `;

            return itemElement;
        },
        minimumCharacters: 0
    },
    {
        marker: "#",
        feed: async (queryText) => {
            const names = await server.get<string[]>(`attribute-names/?type=label&query=${encodeURIComponent(queryText)}`);

            return names.map((name) => {
                return {
                    id: `#${name}`,
                    name: name
                };
            });
        },
        minimumCharacters: 0
    },
    {
        marker: "~",
        feed: async (queryText) => {
            const names = await server.get<string[]>(`attribute-names/?type=relation&query=${encodeURIComponent(queryText)}`);

            return names.map((name) => {
                return {
                    id: `~${name}`,
                    name: name
                };
            });
        },
        minimumCharacters: 0
    }
];

const editorConfig: EditorConfig = {
    toolbar: {
        items: []
    },
    placeholder: t("attribute_editor.placeholder"),
    mention: {
        feeds: mentionSetup
    },
    licenseKey: "GPL"
};

type AttributeCommandNames = FilteredCommandNames<CommandData>;

export default class AttributeEditorWidget extends NoteContextAwareWidget implements EventListener<"entitiesReloaded">, EventListener<"addNewLabel">, EventListener<"addNewRelation"> {
    private attributeDetailWidget: AttributeDetailWidget;
    private $editor!: JQuery<HTMLElement>;
    private $addNewAttributeButton!: JQuery<HTMLElement>;
    private $saveAttributesButton!: JQuery<HTMLElement>;
    private $errors!: JQuery<HTMLElement>;

    private textEditor!: AttributeEditor;
    private lastUpdatedNoteId!: string | undefined;
    private lastSavedContent!: string;

    constructor(attributeDetailWidget: AttributeDetailWidget) {
        super();

        this.attributeDetailWidget = attributeDetailWidget;
    }

    doRender() {
        this.$widget = $(TPL);
        this.$editor = this.$widget.find(".attribute-list-editor");

        this.initialized = this.initEditor();

        this.$editor.on("keydown", async (e) => {
            if (e.which === 13) {
                // allow autocomplete to fill the result textarea
                setTimeout(() => this.save(), 100);
            }

            this.attributeDetailWidget.hide();
        });

        this.$editor.on("blur", () => setTimeout(() => this.save(), 100)); // Timeout to fix https://github.com/zadam/trilium/issues/4160

        this.$addNewAttributeButton = this.$widget.find(".add-new-attribute-button");
        this.$addNewAttributeButton.on("click", (e) => this.addNewAttribute(e));

        this.$saveAttributesButton = this.$widget.find(".save-attributes-button");
        this.$saveAttributesButton.on("click", () => this.save());

        this.$errors = this.$widget.find(".attribute-errors");
    }

    addNewAttribute(e: JQuery.ClickEvent) {
        contextMenuService.show<AttributeCommandNames>({
            x: e.pageX,
            y: e.pageY,
            orientation: "left",
            items: [
                { title: t("attribute_editor.add_new_label"), command: "addNewLabel", uiIcon: "bx bx-hash" },
                { title: t("attribute_editor.add_new_relation"), command: "addNewRelation", uiIcon: "bx bx-transfer" },
                { title: "----" },
                { title: t("attribute_editor.add_new_label_definition"), command: "addNewLabelDefinition", uiIcon: "bx bx-empty" },
                { title: t("attribute_editor.add_new_relation_definition"), command: "addNewRelationDefinition", uiIcon: "bx bx-empty" }
            ],
            selectMenuItemHandler: ({ command }) => this.handleAddNewAttributeCommand(command)
        });
        // Prevent automatic hiding of the context menu due to the button being clicked.
        e.stopPropagation();
    }

    // triggered from keyboard shortcut
    async addNewLabelEvent({ ntxId }: EventData<"addNewLabel">) {
        if (this.isNoteContext(ntxId)) {
            await this.refresh();

            this.handleAddNewAttributeCommand("addNewLabel");
        }
    }

    // triggered from keyboard shortcut
    async addNewRelationEvent({ ntxId }: EventData<"addNewRelation">) {
        if (this.isNoteContext(ntxId)) {
            await this.refresh();

            this.handleAddNewAttributeCommand("addNewRelation");
        }
    }

    async handleAddNewAttributeCommand(command: AttributeCommandNames | undefined) {
        // TODO: Not sure what the relation between FAttribute[] and Attribute[] is.
        const attrs = this.parseAttributes() as FAttribute[];

        if (!attrs) {
            return;
        }

        let type: AttributeType;
        let name;
        let value;

        if (command === "addNewLabel") {
            type = "label";
            name = "myLabel";
            value = "";
        } else if (command === "addNewRelation") {
            type = "relation";
            name = "myRelation";
            value = "";
        } else if (command === "addNewLabelDefinition") {
            type = "label";
            name = "label:myLabel";
            value = "promoted,single,text";
        } else if (command === "addNewRelationDefinition") {
            type = "label";
            name = "relation:myRelation";
            value = "promoted,single";
        } else {
            return;
        }

        // TODO: Incomplete type
        //@ts-ignore
        attrs.push({
            type,
            name,
            value,
            isInheritable: false
        });

        await this.renderOwnedAttributes(attrs, false);

        this.$editor.scrollTop(this.$editor[0].scrollHeight);

        const rect = this.$editor[0].getBoundingClientRect();

        setTimeout(() => {
            // showing a little bit later because there's a conflict with outside click closing the attr detail
            this.attributeDetailWidget.showAttributeDetail({
                allAttributes: attrs,
                attribute: attrs[attrs.length - 1],
                isOwned: true,
                x: (rect.left + rect.right) / 2,
                y: rect.bottom,
                focus: "name"
            });
        }, 100);
    }

    async save() {
        if (this.lastUpdatedNoteId !== this.noteId) {
            // https://github.com/zadam/trilium/issues/3090
            console.warn("Ignoring blur event because a different note is loaded.");
            return;
        }

        const attributes = this.parseAttributes();

        if (attributes) {
            await server.put(`notes/${this.noteId}/attributes`, attributes, this.componentId);

            this.$saveAttributesButton.fadeOut();

            // blink the attribute text to give a visual hint that save has been executed
            this.$editor.css("opacity", 0);

            // revert back
            setTimeout(() => this.$editor.css("opacity", 1), 100);
        }
    }

    parseAttributes() {
        try {
            return attributeParser.lexAndParse(this.getPreprocessedData());
        } catch (e: any) {
            this.$errors.text(e.message).slideDown();
        }
    }

    getPreprocessedData() {
        const str = this.textEditor
            .getData()
            .replace(/<a[^>]+href="(#[A-Za-z0-9_/]*)"[^>]*>[^<]*<\/a>/g, "$1")
            .replace(/&nbsp;/g, " "); // otherwise .text() below outputs non-breaking space in unicode

        return $("<div>").html(str).text();
    }

    async initEditor() {
        this.$widget.show();

        this.$editor.on("click", (e) => this.handleEditorClick(e));

        this.textEditor = await AttributeEditor.create(this.$editor[0], editorConfig);
        this.textEditor.model.document.on("change:data", () => this.dataChanged());
        this.textEditor.editing.view.document.on(
            "enter",
            (event, data) => {
                // disable entering new line - see https://github.com/ckeditor/ckeditor5/issues/9422
                data.preventDefault();
                event.stop();
            },
            { priority: "high" }
        );

        // disable spellcheck for attribute editor
        const documentRoot = this.textEditor.editing.view.document.getRoot();
        if (documentRoot) {
            this.textEditor.editing.view.change((writer) => writer.setAttribute("spellcheck", "false", documentRoot));
        }
    }

    dataChanged() {
        this.lastUpdatedNoteId = this.noteId;

        if (this.lastSavedContent === this.textEditor.getData()) {
            this.$saveAttributesButton.fadeOut();
        } else {
            this.$saveAttributesButton.fadeIn();
        }

        if (this.$errors.is(":visible")) {
            // using .hide() instead of .slideUp() since this will also hide the error after confirming
            // mention for relation name which suits up. When using.slideUp() error will appear and the slideUp which is weird
            this.$errors.hide();
        }
    }

    async handleEditorClick(e: JQuery.ClickEvent) {
        const pos = this.textEditor.model.document.selection.getFirstPosition();

        if (pos && pos.textNode && pos.textNode.data) {
            const clickIndex = this.getClickIndex(pos);

            let parsedAttrs;

            try {
                parsedAttrs = attributeParser.lexAndParse(this.getPreprocessedData(), true);
            } catch (e) {
                // the input is incorrect because the user messed up with it and now needs to fix it manually
                return null;
            }

            let matchedAttr: Attribute | null = null;

            for (const attr of parsedAttrs) {
                if (attr.startIndex && clickIndex > attr.startIndex && attr.endIndex && clickIndex <= attr.endIndex) {
                    matchedAttr = attr;
                    break;
                }
            }

            setTimeout(() => {
                if (matchedAttr) {
                    this.$editor.tooltip("hide");

                    this.attributeDetailWidget.showAttributeDetail({
                        allAttributes: parsedAttrs,
                        attribute: matchedAttr,
                        isOwned: true,
                        x: e.pageX,
                        y: e.pageY
                    });
                } else {
                    this.showHelpTooltip();
                }
            }, 100);
        } else {
            this.showHelpTooltip();
        }
    }

    showHelpTooltip() {
        this.attributeDetailWidget.hide();

        this.$editor.tooltip({
            trigger: "focus",
            html: true,
            title: HELP_TEXT,
            placement: "bottom",
            offset: "0,30"
        });

        this.$editor.tooltip("show");
    }

    getClickIndex(pos: ModelPosition) {
        let clickIndex = pos.offset - (pos.textNode?.startOffset ?? 0);

        let curNode: ModelNode | Text | ModelElement | null = pos.textNode;

        while (curNode?.previousSibling) {
            curNode = curNode.previousSibling;

            if ((curNode as ModelElement).name === "reference") {
                clickIndex += (curNode.getAttribute("href") as string).length + 1;
            } else if ("data" in curNode) {
                clickIndex += (curNode.data as string).length;
            }
        }

        return clickIndex;
    }

    async loadReferenceLinkTitle($el: JQuery<HTMLElement>, href: string) {
        const { noteId } = linkService.parseNavigationStateFromUrl(href);
        const note = noteId ? await froca.getNote(noteId, true) : null;
        const title = note ? note.title : "[missing]";

        $el.text(title);
    }

    async refreshWithNote(note: FNote) {
        await this.renderOwnedAttributes(note.getOwnedAttributes(), true);
    }

    async renderOwnedAttributes(ownedAttributes: FAttribute[], saved: boolean) {
        // attrs are not resorted if position changes after the initial load
        ownedAttributes.sort((a, b) => a.position - b.position);

        let htmlAttrs = (await attributeRenderer.renderAttributes(ownedAttributes, true)).html();

        if (htmlAttrs.length > 0) {
            htmlAttrs += "&nbsp;";
        }

        this.textEditor.setData(htmlAttrs);

        if (saved) {
            this.lastSavedContent = this.textEditor.getData();

            this.$saveAttributesButton.fadeOut(0);
        }
    }

    async createNoteForReferenceLink(title: string) {
        let result;
        if (this.notePath) {
            result = await noteCreateService.createNoteWithTypePrompt(this.notePath, {
                activate: false,
                title: title
            });
        }

        return result?.note?.getBestNotePathString();
    }

    async updateAttributeList(attributes: FAttribute[]) {
        await this.renderOwnedAttributes(attributes, false);
    }

    focus() {
        this.$editor.trigger("focus");

        this.textEditor.model.change((writer) => {
            const documentRoot = this.textEditor.editing.model.document.getRoot();
            if (!documentRoot) {
                return;
            }

            const positionAt = writer.createPositionAt(documentRoot, "end");
            writer.setSelection(positionAt);
        });
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows(this.componentId).find((attr) => attributeService.isAffecting(attr, this.note))) {
            this.refresh();
        }
    }
}
