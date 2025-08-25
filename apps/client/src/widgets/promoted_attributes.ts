import { t } from "../services/i18n.js";
import server from "../services/server.js";
import ws from "../services/ws.js";
import treeService from "../services/tree.js";
import noteAutocompleteService from "../services/note_autocomplete.js";
import NoteContextAwareWidget from "./note_context_aware_widget.js";
import attributeService from "../services/attributes.js";
import options from "../services/options.js";
import utils from "../services/utils.js";
import type FNote from "../entities/fnote.js";
import type { Attribute } from "../services/attribute_parser.js";
import type FAttribute from "../entities/fattribute.js";
import type { EventData } from "../components/app_context.js";

const TPL = /*html*/`
<div class="promoted-attributes-widget">
    <style>
    body.mobile .promoted-attributes-widget {
        /* https://github.com/zadam/trilium/issues/4468 */
        flex-shrink: 0.4;
        overflow: auto;
    }

    .promoted-attributes-container {
        margin: 0 1.5em;
        overflow: auto;
        max-height: 400px;
        flex-wrap: wrap;
        display: table;
    }
    .promoted-attribute-cell {
        display: flex;
        align-items: center;
        margin: 10px;
        display: table-row;
    }
    .promoted-attribute-cell > label {
        user-select: none;
        font-weight: bold;
        vertical-align: middle;
    }
    .promoted-attribute-cell > * {
        display: table-cell;
        padding: 1px 0;
    }

    .promoted-attribute-cell div.input-group {
        margin-left: 10px;
        display: flex;
        min-height: 40px;
    }
    .promoted-attribute-cell strong {
        word-break:keep-all;
        white-space: nowrap;
    }

    .promoted-attribute-cell input[type="checkbox"] {
        width: 22px !important;
        flex-grow: 0;
        width: unset;
    }

    /* Restore default apperance */
    .promoted-attribute-cell input[type="number"],
    .promoted-attribute-cell input[type="checkbox"] {
        appearance: auto;
    }

    .promoted-attribute-cell input[type="color"] {
        width: 24px;
        height: 24px;
        margin-top: 2px;
        appearance: none;
        padding: 0;
        border: 0;
        outline: none;
        border-radius: 25% !important;
    }

    .promoted-attribute-cell input[type="color"]::-webkit-color-swatch-wrapper {
        padding: 0;
    }

    .promoted-attribute-cell input[type="color"]::-webkit-color-swatch {
        border: none;
        border-radius: 25%;
    }

    .promoted-attribute-label-color input[type="hidden"][value=""] + input[type="color"] {
        position: relative;
        opacity: 0.5;
    }

    .promoted-attribute-label-color input[type="hidden"][value=""] + input[type="color"]:after {
        content: "";
        position: absolute;
        top: 10px;
        left: 0px;
        right: 0;
        height: 2px;
        background: rgba(0, 0, 0, 0.5);
        transform: rotate(45deg);
        pointer-events: none;
    }

    </style>

    <div class="promoted-attributes-container"></div>
</div>`;

// TODO: Deduplicate
interface AttributeResult {
    attributeId: string;
}

export default class PromotedAttributesWidget extends NoteContextAwareWidget {

    private $container!: JQuery<HTMLElement>;

    get name() {
        return "promotedAttributes";
    }

    get toggleCommand() {
        return "toggleRibbonTabPromotedAttributes";
    }

    doRender() {
        this.$widget = $(TPL);
        this.contentSized();
        this.$container = this.$widget.find(".promoted-attributes-container");
    }

    getTitle(note: FNote) {
        const promotedDefAttrs = note.getPromotedDefinitionAttributes();

        if (promotedDefAttrs.length === 0) {
            return { show: false };
        }

        return {
            show: true,
            activate: options.is("promotedAttributesOpenInRibbon"),
            title: t("promoted_attributes.promoted_attributes"),
            icon: "bx bx-table"
        };
    }

    async refreshWithNote(note: FNote) {
        this.$container.empty();

        const promotedDefAttrs = note.getPromotedDefinitionAttributes();
        const ownedAttributes = note.getOwnedAttributes();
        // attrs are not resorted if position changes after the initial load
        // promoted attrs are sorted primarily by order of definitions, but with multi-valued promoted attrs
        // the order of attributes is important as well
        ownedAttributes.sort((a, b) => a.position - b.position);

        if (promotedDefAttrs.length === 0 || note.getLabelValue("viewType") === "table") {
            this.toggleInt(false);
            return;
        }

        const $cells: JQuery<HTMLElement>[] = [];

        for (const definitionAttr of promotedDefAttrs) {
            const valueType = definitionAttr.name.startsWith("label:") ? "label" : "relation";
            const valueName = definitionAttr.name.substr(valueType.length + 1);

            let valueAttrs = ownedAttributes.filter((el) => el.name === valueName && el.type === valueType) as Attribute[];

            if (valueAttrs.length === 0) {
                valueAttrs.push({
                    attributeId: "",
                    type: valueType,
                    name: valueName,
                    value: ""
                });
            }

            if (definitionAttr.getDefinition().multiplicity === "single") {
                valueAttrs = valueAttrs.slice(0, 1);
            }

            for (const valueAttr of valueAttrs) {
                const $cell = await this.createPromotedAttributeCell(definitionAttr, valueAttr, valueName);

                if ($cell) {
                    $cells.push($cell);
                }
            }
        }

        // we replace the whole content in one step, so there can't be any race conditions
        // (previously we saw promoted attributes doubling)
        this.$container.empty().append(...$cells);
        this.toggleInt(true);
    }

    async createPromotedAttributeCell(definitionAttr: FAttribute, valueAttr: Attribute, valueName: string) {
        const definition = definitionAttr.getDefinition();
        const id = `value-${valueAttr.attributeId}`;

        const $input = $("<input>")
            .prop("tabindex", 200 + definitionAttr.position)
            .prop("id", id)
            .attr("data-attribute-id", valueAttr.noteId === this.noteId ? valueAttr.attributeId ?? "" : "") // if not owned, we'll force creation of a new attribute instead of updating the inherited one
            .attr("data-attribute-type", valueAttr.type)
            .attr("data-attribute-name", valueAttr.name)
            .prop("value", valueAttr.value)
            .prop("placeholder", t("promoted_attributes.unset-field-placeholder"))
            .addClass("form-control")
            .addClass("promoted-attribute-input")
            .on("change", (event) => this.promotedAttributeChanged(event));

        const $actionCell = $("<div>");
        const $multiplicityCell = $("<td>").addClass("multiplicity").attr("nowrap", "true");

        const $wrapper = $('<div class="promoted-attribute-cell">')
            .append(
                $("<label>")
                    .prop("for", id)
                    .text(definition.promotedAlias ?? valueName)
            )
            .append($("<div>").addClass("input-group").append($input))
            .append($actionCell)
            .append($multiplicityCell);

        if (valueAttr.type === "label") {
            $wrapper.addClass(`promoted-attribute-label-${definition.labelType}`);
            if (definition.labelType === "text") {
                $input.prop("type", "text");

                // autocomplete for label values is just nice to have, mobile can keep labels editable without autocomplete
                if (utils.isDesktop()) {
                    // no need to await for this, can be done asynchronously
                    server.get<string[]>(`attribute-values/${encodeURIComponent(valueAttr.name)}`).then((_attributeValues) => {
                        if (_attributeValues.length === 0) {
                            return;
                        }

                        const attributeValues = _attributeValues.map((attribute) => ({ value: attribute }));

                        $input.autocomplete(
                            {
                                appendTo: document.querySelector("body"),
                                hint: false,
                                autoselect: false,
                                openOnFocus: true,
                                minLength: 0,
                                tabAutocomplete: false
                            },
                            [
                                {
                                    displayKey: "value",
                                    source: function (term, cb) {
                                        term = term.toLowerCase();

                                        const filtered = attributeValues.filter((attr) => attr.value.toLowerCase().includes(term));

                                        cb(filtered);
                                    }
                                }
                            ]
                        );

                        $input.on("autocomplete:selected", (e) => this.promotedAttributeChanged(e));
                    });
                }
            } else if (definition.labelType === "number") {
                $input.prop("type", "number");

                let step = 1;

                for (let i = 0; i < (definition.numberPrecision || 0) && i < 10; i++) {
                    step /= 10;
                }

                $input.prop("step", step);
                $input.css("text-align", "right").css("width", "120");
            } else if (definition.labelType === "boolean") {
                $input.prop("type", "checkbox");

                $input.wrap($(`<label class="tn-checkbox"></label>`));
                $wrapper.find(".input-group").removeClass("input-group");

                if (valueAttr.value === "true") {
                    $input.prop("checked", "checked");
                }
            } else if (definition.labelType === "date") {
                $input.prop("type", "date");
            } else if (definition.labelType === "datetime") {
                $input.prop("type", "datetime-local");
            } else if (definition.labelType === "time") {
                $input.prop("type", "time");
            } else if (definition.labelType === "url") {
                $input.prop("placeholder", t("promoted_attributes.url_placeholder"));

                const $openButton = $("<span>")
                    .addClass("input-group-text open-external-link-button bx bx-window-open")
                    .prop("title", t("promoted_attributes.open_external_link"))
                    .on("click", () => window.open($input.val() as string, "_blank"));

                $input.after($openButton);
            } else if (definition.labelType === "color") {
                const defaultColor = "#ffffff";
                $input.prop("type", "hidden");
                $input.val(valueAttr.value ?? "");

                // We insert a separate input since the color input does not support empty value.
                // This is a workaround to allow clearing the color input.
                const $colorInput = $("<input>")
                    .prop("type", "color")
                    .prop("value", valueAttr.value || defaultColor)
                    .addClass("form-control promoted-attribute-input")
                    .on("change", e => setValue((e.target as HTMLInputElement).value, e));
                $input.after($colorInput);

                const $clearButton = $("<span>")
                    .addClass("input-group-text bx bxs-tag-x")
                    .prop("title", t("promoted_attributes.remove_color"))
                    .on("click", e => setValue("", e));

                const setValue = (color: string, event: JQuery.TriggeredEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) => {
                    $input.val(color);
                    if (!color) {
                        $colorInput.val(defaultColor);
                    }
                    event.target = $input[0]; // Set the event target to the main input
                    this.promotedAttributeChanged(event);
                };

                $colorInput.after($clearButton);
            } else {
                ws.logError(t("promoted_attributes.unknown_label_type", { type: definition.labelType }));
            }
        } else if (valueAttr.type === "relation") {
            if (valueAttr.value) {
                $input.val(await treeService.getNoteTitle(valueAttr.value));
            }

            if (utils.isDesktop()) {
                // no need to wait for this
                noteAutocompleteService.initNoteAutocomplete($input, { allowCreatingNotes: true });

                $input.on("autocomplete:noteselected", (event, suggestion, dataset) => {
                    this.promotedAttributeChanged(event);
                });

                $input.setSelectedNotePath(valueAttr.value);
            } else {
                // we can't provide user a way to edit the relation so make it read only
                $input.attr("readonly", "readonly");
            }
        } else {
            ws.logError(t(`promoted_attributes.unknown_attribute_type`, { type: valueAttr.type }));
            return;
        }

        if (definition.multiplicity === "multi") {
            const $addButton = $("<span>")
                .addClass("bx bx-plus pointer tn-tool-button")
                .prop("title", t("promoted_attributes.add_new_attribute"))
                .on("click", async () => {
                    const $new = await this.createPromotedAttributeCell(
                        definitionAttr,
                        {
                            attributeId: "",
                            type: valueAttr.type,
                            name: valueName,
                            value: ""
                        },
                        valueName
                    );

                    if ($new) {
                        $wrapper.after($new);

                        $new.find("input").trigger("focus");
                    }
                });

            const $removeButton = $("<span>")
                .addClass("bx bx-trash pointer tn-tool-button")
                .prop("title", t("promoted_attributes.remove_this_attribute"))
                .on("click", async () => {
                    const attributeId = $input.attr("data-attribute-id");

                    if (attributeId) {
                        await server.remove(`notes/${this.noteId}/attributes/${attributeId}`, this.componentId);
                    }

                    // if it's the last one the create new empty form immediately
                    const sameAttrSelector = `input[data-attribute-type='${valueAttr.type}'][data-attribute-name='${valueName}']`;

                    if (this.$widget.find(sameAttrSelector).length <= 1) {
                        const $new = await this.createPromotedAttributeCell(
                            definitionAttr,
                            {
                                attributeId: "",
                                type: valueAttr.type,
                                name: valueName,
                                value: ""
                            },
                            valueName
                        );

                        if ($new) {
                            $wrapper.after($new);
                        }
                    }

                    $wrapper.remove();
                });

            $multiplicityCell.append(" &nbsp;").append($addButton).append(" &nbsp;").append($removeButton);
        }

        return $wrapper;
    }

    async promotedAttributeChanged(event: JQuery.TriggeredEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) {
        const $attr = $(event.target);

        let value;

        if ($attr.prop("type") === "checkbox") {
            value = $attr.is(":checked") ? "true" : "false";
        } else if ($attr.attr("data-attribute-type") === "relation") {
            const selectedPath = $attr.getSelectedNotePath();

            value = selectedPath ? treeService.getNoteIdFromUrl(selectedPath) : "";
        } else {
            value = $attr.val();
        }

        const result = await server.put<AttributeResult>(
            `notes/${this.noteId}/attribute`,
            {
                attributeId: $attr.attr("data-attribute-id"),
                type: $attr.attr("data-attribute-type"),
                name: $attr.attr("data-attribute-name"),
                value: value
            },
            this.componentId
        );

        $attr.attr("data-attribute-id", result.attributeId);
    }

    focus() {
        this.$widget.find(".promoted-attribute-input:first").focus();
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.getAttributeRows(this.componentId).find((attr) => attributeService.isAffecting(attr, this.note))) {
            this.refresh();
        }
    }
}
