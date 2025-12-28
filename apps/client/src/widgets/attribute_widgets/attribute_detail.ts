import { t } from "../../services/i18n.js";
import server from "../../services/server.js";
import froca from "../../services/froca.js";
import linkService from "../../services/link.js";
import attributeAutocompleteService from "../../services/attribute_autocomplete.js";
import noteAutocompleteService from "../../services/note_autocomplete.js";
import promotedAttributeDefinitionParser from "../../services/promoted_attribute_definition_parser.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import SpacedUpdate from "../../services/spaced_update.js";
import utils from "../../services/utils.js";
import shortcutService from "../../services/shortcuts.js";
import appContext from "../../components/app_context.js";
import type { Attribute } from "../../services/attribute_parser.js";
import { focusSavedElement, saveFocusedElement } from "../../services/focus.js";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features.js";

const TPL = /*html*/`
<div class="attr-detail tn-tool-dialog">
    <style>
        .attr-detail {
            display: block;
            background-color: var(--accented-background-color);
            border: 1px solid var(--main-border-color);
            border-radius: 4px;
            z-index: 1000;
            padding: 15px;
            position: absolute;
            width: 500px;
            max-height: 600px;
            overflow: auto;
            box-shadow: 10px 10px 93px -25px black;
        }

        .attr-help td {
            color: var(--muted-text-color);
            padding: 5px;
        }

        .related-notes-list {
            padding-inline-start: 20px;
            margin-top: 10px;
            margin-bottom: 10px;
        }

        .attr-edit-table {
            width: 100%;
        }

        .attr-edit-table th {
            text-align: start;
        }

        .attr-edit-table td input[not(type="checkbox")] {
            width: 100%;
        }

        .attr-edit-table td input[type="checkbox"] {
            display: inline-block;
        }

        .close-attr-detail-button {
            font-size: x-large;
            cursor: pointer;
            position: relative;
            top: -2px;
        }

        .attr-save-delete-button-container {
            display: flex;
            margin-top: 15px;
        }

        .attr-detail input[readonly] {
            background-color: var(--accented-background-color) !important;
        }

        .attr-edit-table td {
            padding: 4px 0;
        }
    </style>

    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <h5 class="attr-detail-title">${t("attribute_detail.attr_detail_title")}</h5>

        <button class="close-attr-detail-button icon-action bx bx-x" title="${t("attribute_detail.close_button_title")}"></button>
    </div>

    <div class="attr-is-owned-by">${t("attribute_detail.attr_is_owned_by")}</div>

    <table class="attr-edit-table">
        <tr title="${t("attribute_detail.attr_name_title")}">
            <th>${t("attribute_detail.name")}</th>
            <td><input type="text" class="attr-input-name form-control" /></td>
        </tr>
        <tr class="attr-help"></tr>
        <tr class="attr-row-value">
            <th>${t("attribute_detail.value")}</th>
            <td><input type="text" class="attr-input-value form-control" /></td>
        </tr>
        <tr class="attr-row-target-note">
            <th title="${t("attribute_detail.target_note_title")}">${t("attribute_detail.target_note")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-target-note form-control" />
                </div>
            </td>
        </tr>
        <tr class="attr-row-promoted"
            title="${t("attribute_detail.promoted_title")}">
            <th></th>
            <td>
                <label class="tn-checkbox">
                    <input type="checkbox" class="attr-input-promoted" />
                    ${t("attribute_detail.promoted")}
                </label>
            </td>
        </tr>
        <tr class="attr-row-promoted-alias">
            <th title="${t("attribute_detail.promoted_alias_title")}">${t("attribute_detail.promoted_alias")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-promoted-alias form-control" />
                </div>
            </td>
        </tr>
        <tr class="attr-row-multiplicity">
            <th title="${t("attribute_detail.multiplicity_title")}">${t("attribute_detail.multiplicity")}</th>
            <td>
                <select class="attr-input-multiplicity form-control">
                  <option value="single">${t("attribute_detail.single_value")}</option>
                  <option value="multi">${t("attribute_detail.multi_value")}</option>
                </select>
            </td>
        </tr>
        <tr class="attr-row-label-type">
            <th title="${t("attribute_detail.label_type_title")}">${t("attribute_detail.label_type")}</th>
            <td>
                <select class="attr-input-label-type form-control">
                  <option value="text">${t("attribute_detail.text")}</option>
                  <option value="number">${t("attribute_detail.number")}</option>
                  <option value="boolean">${t("attribute_detail.boolean")}</option>
                  <option value="date">${t("attribute_detail.date")}</option>
                  <option value="datetime">${t("attribute_detail.date_time")}</option>
                  <option value="time">${t("attribute_detail.time")}</option>
                  <option value="url">${t("attribute_detail.url")}</option>
                  <option value="color">${t("attribute_detail.color_type")}</option>
                </select>
            </td>
        </tr>
        <tr class="attr-row-number-precision">
            <th title="${t("attribute_detail.precision_title")}">${t("attribute_detail.precision")}</th>
            <td>
                <div class="input-group">
                    <input type="number" class="form-control attr-input-number-precision" style="text-align: end">
                    <span class="input-group-text">${t("attribute_detail.digits")}</span>
                </div>
            </td>
        </tr>
        <tr class="attr-row-inverse-relation">
            <th title="${t("attribute_detail.inverse_relation_title")}">${t("attribute_detail.inverse_relation")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-inverse-relation form-control" />
                </div>
            </td>
        </tr>
        <tr title="${t("attribute_detail.inheritable_title")}">
            <th></th>
            <td>
                <label class="tn-checkbox">
                    <input type="checkbox" class="attr-input-inheritable" />
                    ${t("attribute_detail.inheritable")}
                </label>
            </td>
        </tr>
    </table>

    <div class="attr-save-delete-button-container">
        <button class="btn btn-primary btn-sm attr-save-changes-and-close-button"
            style="flex-grow: 1; margin-inline-end: 20px">
            ${t("attribute_detail.save_and_close")}</button>

        <button class="btn btn-secondary btn-sm attr-delete-button">
            ${t("attribute_detail.delete")}</button>
    </div>

    <div class="related-notes-container">
        <br/>

        <h5 class="related-notes-tile">${t("attribute_detail.related_notes_title")}</h5>

        <ul class="related-notes-list"></ul>

        <div class="related-notes-more-notes">${t("attribute_detail.more_notes")}</div>
    </div>
</div>`;

const DISPLAYED_NOTES = 10;

const ATTR_TITLES: Record<string, string> = {
    label: t("attribute_detail.label"),
    "label-definition": t("attribute_detail.label_definition"),
    relation: t("attribute_detail.relation"),
    "relation-definition": t("attribute_detail.relation_definition")
};

const ATTR_HELP: Record<string, Record<string, string>> = {
    label: {
        disableVersioning: t("attribute_detail.disable_versioning"),
        calendarRoot: t("attribute_detail.calendar_root"),
        archived: t("attribute_detail.archived"),
        excludeFromExport: t("attribute_detail.exclude_from_export"),
        run: t("attribute_detail.run"),
        runOnInstance: t("attribute_detail.run_on_instance"),
        runAtHour: t("attribute_detail.run_at_hour"),
        disableInclusion: t("attribute_detail.disable_inclusion"),
        sorted: t("attribute_detail.sorted"),
        sortDirection: t("attribute_detail.sort_direction"),
        sortFoldersFirst: t("attribute_detail.sort_folders_first"),
        top: t("attribute_detail.top"),
        hidePromotedAttributes: t("attribute_detail.hide_promoted_attributes"),
        readOnly: t("attribute_detail.read_only"),
        autoReadOnlyDisabled: t("attribute_detail.auto_read_only_disabled"),
        appCss: t("attribute_detail.app_css"),
        appTheme: t("attribute_detail.app_theme"),
        appThemeBase: t("attribute_detail.app_theme_base"),
        cssClass: t("attribute_detail.css_class"),
        iconClass: t("attribute_detail.icon_class"),
        pageSize: t("attribute_detail.page_size"),
        customRequestHandler: t("attribute_detail.custom_request_handler"),
        customResourceProvider: t("attribute_detail.custom_resource_provider"),
        widget: t("attribute_detail.widget"),
        workspace: t("attribute_detail.workspace"),
        workspaceIconClass: t("attribute_detail.workspace_icon_class"),
        workspaceTabBackgroundColor: t("attribute_detail.workspace_tab_background_color"),
        workspaceCalendarRoot: t("attribute_detail.workspace_calendar_root"),
        workspaceTemplate: t("attribute_detail.workspace_template"),
        searchHome: t("attribute_detail.search_home"),
        workspaceSearchHome: t("attribute_detail.workspace_search_home"),
        inbox: t("attribute_detail.inbox"),
        workspaceInbox: t("attribute_detail.workspace_inbox"),
        sqlConsoleHome: t("attribute_detail.sql_console_home"),
        bookmarkFolder: t("attribute_detail.bookmark_folder"),
        shareHiddenFromTree: t("attribute_detail.share_hidden_from_tree"),
        shareExternalLink: t("attribute_detail.share_external_link"),
        shareAlias: t("attribute_detail.share_alias"),
        shareOmitDefaultCss: t("attribute_detail.share_omit_default_css"),
        shareRoot: t("attribute_detail.share_root"),
        shareDescription: t("attribute_detail.share_description"),
        shareRaw: t("attribute_detail.share_raw"),
        shareDisallowRobotIndexing: t("attribute_detail.share_disallow_robot_indexing"),
        shareCredentials: t("attribute_detail.share_credentials"),
        shareIndex: t("attribute_detail.share_index"),
        displayRelations: t("attribute_detail.display_relations"),
        hideRelations: t("attribute_detail.hide_relations"),
        titleTemplate: t("attribute_detail.title_template"),
        template: t("attribute_detail.template"),
        toc: t("attribute_detail.toc"),
        color: t("attribute_detail.color"),
        keyboardShortcut: t("attribute_detail.keyboard_shortcut"),
        keepCurrentHoisting: t("attribute_detail.keep_current_hoisting"),
        executeButton: t("attribute_detail.execute_button"),
        executeDescription: t("attribute_detail.execute_description"),
        excludeFromNoteMap: t("attribute_detail.exclude_from_note_map"),
        newNotesOnTop: t("attribute_detail.new_notes_on_top"),
        hideHighlightWidget: t("attribute_detail.hide_highlight_widget"),
        printLandscape: t("attribute_detail.print_landscape"),
        printPageSize: t("attribute_detail.print_page_size")
    },
    relation: {
        runOnNoteCreation: t("attribute_detail.run_on_note_creation"),
        runOnChildNoteCreation: t("attribute_detail.run_on_child_note_creation"),
        runOnNoteTitleChange: t("attribute_detail.run_on_note_title_change"),
        runOnNoteContentChange: t("attribute_detail.run_on_note_content_change"),
        runOnNoteChange: t("attribute_detail.run_on_note_change"),
        runOnNoteDeletion: t("attribute_detail.run_on_note_deletion"),
        runOnBranchCreation: t("attribute_detail.run_on_branch_creation"),
        runOnBranchChange: t("attribute_detail.run_on_branch_change"),
        runOnBranchDeletion: t("attribute_detail.run_on_branch_deletion"),
        runOnAttributeCreation: t("attribute_detail.run_on_attribute_creation"),
        runOnAttributeChange: t("attribute_detail.run_on_attribute_change"),
        template: t("attribute_detail.relation_template"),
        inherit: t("attribute_detail.inherit"),
        renderNote: t("attribute_detail.render_note"),
        widget: t("attribute_detail.widget_relation"),
        shareCss: t("attribute_detail.share_css"),
        shareJs: t("attribute_detail.share_js"),
        shareTemplate: t("attribute_detail.share_template"),
        shareFavicon: t("attribute_detail.share_favicon")
    }
};

interface AttributeDetailOpts {
    allAttributes?: Attribute[];
    attribute: Attribute;
    isOwned: boolean;
    x: number;
    y: number;
    focus?: "name";
    parent?: HTMLElement;
    hideMultiplicity?: boolean;
}

interface SearchRelatedResponse {
    // TODO: Deduplicate once we split client from server.
    results: {
        noteId: string;
        notePathArray: string[];
    }[];
    count: number;
}

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private $title!: JQuery<HTMLElement>;
    private $inputName!: JQuery<HTMLElement>;
    private $inputValue!: JQuery<HTMLElement>;
    private $rowPromoted!: JQuery<HTMLElement>;
    private $inputPromoted!: JQuery<HTMLElement>;
    private $inputPromotedAlias!: JQuery<HTMLElement>;
    private $inputMultiplicity!: JQuery<HTMLElement>;
    private $inputInverseRelation!: JQuery<HTMLElement>;
    private $inputLabelType!: JQuery<HTMLElement>;
    private $inputTargetNote!: JQuery<HTMLElement>;
    private $inputNumberPrecision!: JQuery<HTMLElement>;
    private $inputInheritable!: JQuery<HTMLElement>;
    private $rowValue!: JQuery<HTMLElement>;
    private $rowMultiplicity!: JQuery<HTMLElement>;
    private $rowLabelType!: JQuery<HTMLElement>;
    private $rowNumberPrecision!: JQuery<HTMLElement>;
    private $rowInverseRelation!: JQuery<HTMLElement>;
    private $rowTargetNote!: JQuery<HTMLElement>;
    private $rowPromotedAlias!: JQuery<HTMLElement>;
    private $attrIsOwnedBy!: JQuery<HTMLElement>;
    private $attrSaveDeleteButtonContainer!: JQuery<HTMLElement>;
    private $closeAttrDetailButton!: JQuery<HTMLElement>;
    private $saveAndCloseButton!: JQuery<HTMLElement>;
    private $deleteButton!: JQuery<HTMLElement>;
    private $relatedNotesContainer!: JQuery<HTMLElement>;
    private $relatedNotesTitle!: JQuery<HTMLElement>;
    private $relatedNotesList!: JQuery<HTMLElement>;
    private $relatedNotesMoreNotes!: JQuery<HTMLElement>;
    private $attrHelp!: JQuery<HTMLElement>;

    private relatedNotesSpacedUpdate!: SpacedUpdate;
    private attribute!: Attribute;
    private allAttributes?: Attribute[];
    private attrType!: ReturnType<AttributeDetailWidget["getAttrType"]>;

    async refresh() {
        // switching note/tab should close the widget

        this.hide();
    }

    doRender() {
        this.relatedNotesSpacedUpdate = new SpacedUpdate(async () => this.updateRelatedNotes(), 1000);

        this.$widget = $(TPL);

        shortcutService.bindElShortcut(this.$widget, "ctrl+return", () => this.saveAndClose());
        shortcutService.bindElShortcut(this.$widget, "esc", () => this.cancelAndClose());

        this.$title = this.$widget.find(".attr-detail-title");

        this.$inputName = this.$widget.find(".attr-input-name");
        this.$inputName.on("input", (ev) => {
            if (!(ev.originalEvent as KeyboardEvent)?.isComposing) {
                // https://github.com/zadam/trilium/pull/3812
                this.userEditedAttribute();
            }
        });
        this.$inputName.on("change", () => this.userEditedAttribute());
        this.$inputName.on("autocomplete:closed", () => this.userEditedAttribute());

        this.$inputName.on("focus", () => {
            attributeAutocompleteService.initAttributeNameAutocomplete({
                $el: this.$inputName,
                attributeType: () => (["relation", "relation-definition"].includes(this.attrType || "") ? "relation" : "label"),
                open: true
            });
        });

        this.$rowValue = this.$widget.find(".attr-row-value");
        this.$inputValue = this.$widget.find(".attr-input-value");
        this.$inputValue.on("input", (ev) => {
            if (!(ev.originalEvent as KeyboardEvent)?.isComposing) {
                // https://github.com/zadam/trilium/pull/3812
                this.userEditedAttribute();
            }
        });
        this.$inputValue.on("change", () => this.userEditedAttribute());
        this.$inputValue.on("autocomplete:closed", () => this.userEditedAttribute());
        this.$inputValue.on("focus", () => {
            attributeAutocompleteService.initLabelValueAutocomplete({
                $el: this.$inputValue,
                open: true,
                nameCallback: () => String(this.$inputName.val())
            });
        });

        this.$rowPromoted = this.$widget.find(".attr-row-promoted");
        this.$inputPromoted = this.$widget.find(".attr-input-promoted");
        this.$inputPromoted.on("change", () => this.userEditedAttribute());

        this.$rowPromotedAlias = this.$widget.find(".attr-row-promoted-alias");
        this.$inputPromotedAlias = this.$widget.find(".attr-input-promoted-alias");
        this.$inputPromotedAlias.on("change", () => this.userEditedAttribute());

        this.$rowMultiplicity = this.$widget.find(".attr-row-multiplicity");
        this.$inputMultiplicity = this.$widget.find(".attr-input-multiplicity");
        this.$inputMultiplicity.on("change", () => this.userEditedAttribute());

        this.$rowLabelType = this.$widget.find(".attr-row-label-type");
        this.$inputLabelType = this.$widget.find(".attr-input-label-type");
        this.$inputLabelType.on("change", () => this.userEditedAttribute());

        this.$rowNumberPrecision = this.$widget.find(".attr-row-number-precision");
        this.$inputNumberPrecision = this.$widget.find(".attr-input-number-precision");
        this.$inputNumberPrecision.on("change", () => this.userEditedAttribute());

        this.$rowInverseRelation = this.$widget.find(".attr-row-inverse-relation");
        this.$inputInverseRelation = this.$widget.find(".attr-input-inverse-relation");
        this.$inputInverseRelation.on("input", (ev) => {
            if (!(ev.originalEvent as KeyboardEvent)?.isComposing) {
                // https://github.com/zadam/trilium/pull/3812
                this.userEditedAttribute();
            }
        });

        this.$rowTargetNote = this.$widget.find(".attr-row-target-note");
        this.$inputTargetNote = this.$widget.find(".attr-input-target-note");

        noteAutocompleteService.initNoteAutocomplete(this.$inputTargetNote, { allowCreatingNotes: true }).on("autocomplete:noteselected", (event, suggestion, dataset) => {
            if (!suggestion.notePath) {
                return false;
            }

            const pathChunks = suggestion.notePath.split("/");

            this.attribute.value = pathChunks[pathChunks.length - 1]; // noteId

            this.triggerCommand("updateAttributeList", { attributes: this.allAttributes ?? [] });
            this.updateRelatedNotes();
        });

        this.$inputInheritable = this.$widget.find(".attr-input-inheritable");
        this.$inputInheritable.on("change", () => this.userEditedAttribute());

        this.$closeAttrDetailButton = this.$widget.find(".close-attr-detail-button");
        this.$closeAttrDetailButton.on("click", () => this.cancelAndClose());

        this.$attrIsOwnedBy = this.$widget.find(".attr-is-owned-by");

        this.$attrSaveDeleteButtonContainer = this.$widget.find(".attr-save-delete-button-container");

        this.$saveAndCloseButton = this.$widget.find(".attr-save-changes-and-close-button");
        this.$saveAndCloseButton.on("click", () => this.saveAndClose());

        this.$deleteButton = this.$widget.find(".attr-delete-button");
        this.$deleteButton.on("click", async () => {
            await this.triggerCommand("updateAttributeList", {
                attributes: (this.allAttributes || []).filter((attr) => attr !== this.attribute)
            });

            await this.triggerCommand("saveAttributes");

            this.hide();
        });

        this.$attrHelp = this.$widget.find(".attr-help");

        this.$relatedNotesContainer = this.$widget.find(".related-notes-container");
        this.$relatedNotesTitle = this.$relatedNotesContainer.find(".related-notes-tile");
        this.$relatedNotesList = this.$relatedNotesContainer.find(".related-notes-list");
        this.$relatedNotesMoreNotes = this.$relatedNotesContainer.find(".related-notes-more-notes");

        $(window).on("mousedown", (e) => {
            if (!$(e.target).closest(this.$widget[0]).length && !$(e.target).closest(".algolia-autocomplete").length && !$(e.target).closest("#context-menu-container").length) {
                this.hide();
            }
        });
    }

    async showAttributeDetail({ allAttributes, attribute, isOwned, x, y, focus, hideMultiplicity }: AttributeDetailOpts) {
        if (!attribute) {
            this.hide();

            return;
        }

        saveFocusedElement();

        this.attrType = this.getAttrType(attribute);

        const attrName = this.attrType === "label-definition" ? attribute.name.substr(6) : this.attrType === "relation-definition" ? attribute.name.substr(9) : attribute.name;

        const definition = this.attrType?.endsWith("-definition") ? promotedAttributeDefinitionParser.parse(attribute.value || "") : {};

        if (this.attrType) {
            this.$title.text(ATTR_TITLES[this.attrType]);
        }

        this.allAttributes = allAttributes;
        this.attribute = attribute;

        // can be slightly slower so just make it async
        this.updateRelatedNotes();

        this.$attrSaveDeleteButtonContainer.toggle(!!isOwned);

        if (isOwned) {
            this.$attrIsOwnedBy.hide();
        } else if (attribute.noteId) {
            this.$attrIsOwnedBy
                .show()
                .empty()
                .append(attribute.type === "label" ? "Label" : "Relation")
                .append(` ${t("attribute_detail.is_owned_by_note")} `)
                .append(await linkService.createLink(attribute.noteId));
        }

        const disabledFn = () => (!isOwned ? "true" : undefined);

        this.$inputName.val(attrName).attr("readonly", disabledFn);

        this.$rowValue.toggle(this.attrType === "label");
        this.$rowTargetNote.toggle(this.attrType === "relation");

        this.$rowPromoted.toggle(["label-definition", "relation-definition"].includes(this.attrType || ""));
        this.$inputPromoted.prop("checked", !!definition.isPromoted).attr("disabled", disabledFn);

        this.$rowPromotedAlias.toggle(!!definition.isPromoted);
        this.$inputPromotedAlias.val(definition.promotedAlias || "").attr("disabled", disabledFn);

        this.$rowMultiplicity.toggle(["label-definition", "relation-definition"].includes(this.attrType || "") && !hideMultiplicity);
        this.$inputMultiplicity.val(definition.multiplicity || "").attr("disabled", disabledFn);

        this.$rowLabelType.toggle(this.attrType === "label-definition");
        this.$inputLabelType.val(definition.labelType || "").attr("disabled", disabledFn);

        this.$rowNumberPrecision.toggle(this.attrType === "label-definition" && definition.labelType === "number");
        this.$inputNumberPrecision.val(definition.numberPrecision || "").attr("disabled", disabledFn);

        this.$rowInverseRelation.toggle(this.attrType === "relation-definition");
        this.$inputInverseRelation.val(definition.inverseRelation || "").attr("disabled", disabledFn);

        if (attribute.type === "label") {
            this.$inputValue.val(attribute.value || "").attr("readonly", disabledFn);
        } else if (attribute.type === "relation") {
            this.$inputTargetNote.attr("readonly", disabledFn).val("").setSelectedNotePath("");

            if (attribute.value) {
                const targetNote = await froca.getNote(attribute.value);

                if (targetNote) {
                    this.$inputTargetNote.val(targetNote ? targetNote.title : "").setSelectedNotePath(attribute.value);
                }
            }
        }

        this.$inputInheritable.prop("checked", !!attribute.isInheritable).attr("disabled", disabledFn);

        this.updateHelp();

        this.toggleInt(true);

        const offset = this.parent?.$widget?.offset() || { top: 0, left: 0 };
        const detPosition = this.getDetailPosition(x, offset);
        const outerHeight = this.$widget.outerHeight();
        const height = $(window).height();

        if (!detPosition || !outerHeight || !height) {
            console.warn("Can't position popup, is it attached?");
            return;
        }

        this.$widget
            .css("left", detPosition.left)
            .css("right", detPosition.right)
            .css("top", y - offset.top + 70)
            .css("max-height", outerHeight + y > height - 50 ? height - y - 50 : 10000);

        if (isNewLayout) {
            this.$widget
                .css("top", "unset")
                .css("bottom", 70)
                .css("max-height", "80vh");
        }

        if (focus === "name") {
            this.$inputName.trigger("focus").trigger("select");
        }
    }

    getDetailPosition(x: number, offset: { left: number }) {
        const outerWidth = this.$widget.outerWidth();
        if (!outerWidth) {
            return null;
        }

        let left: number | string = x - offset.left - outerWidth / 2;
        let right: number | string = "";

        if (left < 0) {
            left = 10;
        } else {
            const rightEdge = left + outerWidth;

            if (rightEdge > outerWidth - 10) {
                left = "";
                right = 10;
            }
        }

        return { left, right };
    }

    async saveAndClose() {
        await this.triggerCommand("saveAttributes");

        this.hide();

        focusSavedElement();
    }

    async cancelAndClose() {
        await this.triggerCommand("reloadAttributes");

        this.hide();

        focusSavedElement();
    }

    userEditedAttribute() {
        this.updateAttributeInEditor();
        this.updateHelp();
        this.relatedNotesSpacedUpdate.scheduleUpdate();
    }

    updateHelp() {
        const attrName = String(this.$inputName.val());

        if (this.attrType && this.attrType in ATTR_HELP && attrName && attrName in ATTR_HELP[this.attrType]) {
            this.$attrHelp
                .empty()
                .append($("<td colspan=2>").append($("<strong>").text(attrName)).append(" - ").append(ATTR_HELP[this.attrType][attrName]))
                .show();
        } else {
            this.$attrHelp.empty().hide();
        }
    }

    async updateRelatedNotes() {
        let { results, count } = await server.post<SearchRelatedResponse>("search-related", this.attribute);

        for (const res of results) {
            res.noteId = res.notePathArray[res.notePathArray.length - 1];
        }

        results = results.filter(({ noteId }) => noteId !== this.noteId);

        if (results.length === 0) {
            this.$relatedNotesContainer.hide();
        } else {
            this.$relatedNotesContainer.show();
            this.$relatedNotesTitle.text(t("attribute_detail.other_notes_with_name", { attributeType: this.attribute.type, attributeName: this.attribute.name }));

            this.$relatedNotesList.empty();

            const displayedResults = results.length <= DISPLAYED_NOTES ? results : results.slice(0, DISPLAYED_NOTES);
            const displayedNotes = await froca.getNotes(displayedResults.map((res) => res.noteId));
            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;

            for (const note of displayedNotes) {
                const notePath = note.getBestNotePathString(hoistedNoteId);
                const $noteLink = await linkService.createLink(notePath, { showNotePath: true });

                this.$relatedNotesList.append($("<li>").append($noteLink));
            }

            if (results.length > DISPLAYED_NOTES) {
                this.$relatedNotesMoreNotes.show().text(t("attribute_detail.and_more", { count: count - DISPLAYED_NOTES }));
            } else {
                this.$relatedNotesMoreNotes.hide();
            }
        }
    }

    getAttrType(attribute: Attribute) {
        if (attribute.type === "label") {
            if (attribute.name.startsWith("label:")) {
                return "label-definition";
            } else if (attribute.name.startsWith("relation:")) {
                return "relation-definition";
            } else {
                return "label";
            }
        } else if (attribute.type === "relation") {
            return "relation";
        } else {
            this.$title.text("");
        }
    }

    updateAttributeInEditor() {
        let attrName = String(this.$inputName.val());

        if (!utils.isValidAttributeName(attrName)) {
            // invalid characters are simply ignored (from user perspective they are not even entered)
            attrName = utils.filterAttributeName(attrName);

            this.$inputName.val(attrName);
        }

        if (this.attrType === "label-definition") {
            attrName = `label:${attrName}`;
        } else if (this.attrType === "relation-definition") {
            attrName = `relation:${attrName}`;
        }

        this.attribute.name = attrName;
        this.attribute.isInheritable = this.$inputInheritable.is(":checked");

        if (this.attrType?.endsWith("-definition")) {
            this.attribute.value = this.buildDefinitionValue();
        } else if (this.attrType === "relation") {
            this.attribute.value = this.$inputTargetNote.getSelectedNoteId() || "";
        } else {
            this.attribute.value = String(this.$inputValue.val());
        }

        this.triggerCommand("updateAttributeList", { attributes: this.allAttributes ?? [] });
    }

    buildDefinitionValue() {
        const props: string[] = [];

        if (this.$inputPromoted.is(":checked")) {
            props.push("promoted");

            if (this.$inputPromotedAlias.val() !== "") {
                props.push(`alias=${this.$inputPromotedAlias.val()}`);
            }
        }

        props.push(this.$inputMultiplicity.val() as string);

        if (this.attrType === "label-definition") {
            props.push(this.$inputLabelType.val() as string);

            if (this.$inputLabelType.val() === "number" && this.$inputNumberPrecision.val() !== "") {
                props.push(`precision=${this.$inputNumberPrecision.val()}`);
            }
        } else if (this.attrType === "relation-definition" && String(this.$inputInverseRelation.val())?.trim().length > 0) {
            const inverseRelationName = this.$inputInverseRelation.val();

            props.push(`inverse=${utils.filterAttributeName(String(inverseRelationName))}`);
        }

        this.$rowNumberPrecision.toggle(this.attrType === "label-definition" && this.$inputLabelType.val() === "number");

        this.$rowPromotedAlias.toggle(this.$inputPromoted.is(":checked"));

        return props.join(",");
    }

    hide() {
        this.toggleInt(false);
    }

    createLink(noteId: string) {
        return $("<a>", {
            href: `#root/${noteId}`,
            class: "reference-link"
        });
    }

    async noteSwitched() {
        this.hide();
    }
}
