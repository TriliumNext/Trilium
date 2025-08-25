import NoteContextAwareWidget from "../note_context_aware_widget.js";
import keyboardActionsService from "../../services/keyboard_actions.js";
import attributeService from "../../services/attributes.js";
import type CommandButtonWidget from "../buttons/command_button.js";
import type FNote from "../../entities/fnote.js";
import type { NoteType } from "../../entities/fnote.js";
import type { EventData, EventNames } from "../../components/app_context.js";
import type NoteActionsWidget from "../buttons/note_actions.js";

type ButtonWidget = (CommandButtonWidget | NoteActionsWidget);

export default class RibbonContainer extends NoteContextAwareWidget {

    private lastActiveComponentId?: string | null;
    private lastNoteType?: NoteType;

    private ribbonWidgets: NoteContextAwareWidget[];
    private buttonWidgets: ButtonWidget[];
    private $tabContainer!: JQuery<HTMLElement>;
    private $buttonContainer!: JQuery<HTMLElement>;
    private $bodyContainer!: JQuery<HTMLElement>;

    constructor() {
        super();

        this.contentSized();
        this.ribbonWidgets = [];
        this.buttonWidgets = [];
    }

    isEnabled() {
        return super.isEnabled() && this.noteContext?.viewScope?.viewMode === "default";
    }

    button(widget: ButtonWidget) {
        super.child(widget);

        this.buttonWidgets.push(widget);

        return this;
    }

    doRender() {
        this.$tabContainer = this.$widget.find(".ribbon-tab-container");
        this.$buttonContainer = this.$widget.find(".ribbon-button-container");
        this.$bodyContainer = this.$widget.find(".ribbon-body-container");

        for (const buttonWidget of this.buttonWidgets) {
            this.$buttonContainer.append(buttonWidget.render());
        }
    }

    async noteSwitched() {
        this.lastActiveComponentId = null;

        await super.noteSwitched();
    }

    async refreshWithNote(note: FNote, noExplicitActivation = false) {
        this.lastNoteType = note.type;

        let $ribbonTabToActivate, $lastActiveRibbon;

        this.$tabContainer.empty();

        for (const ribbonWidget of this.ribbonWidgets) {
            // TODO: Base class for ribbon widget
            const ret = await (ribbonWidget as any).getTitle(note);

            if (!ret.show) {
                continue;
            }

            const $ribbonTitle = $('<div class="ribbon-tab-title">')
                .attr("data-ribbon-component-id", ribbonWidget.componentId)
                .attr("data-ribbon-component-name", (ribbonWidget as any).name as string) // TODO: base class for ribbon widgets
                .append(
                    $('<span class="">')
                        .attr("data-toggle-command", (ribbonWidget as any).toggleCommand)
                )

            this.$tabContainer.append('');

            if (ret.activate && !this.lastActiveComponentId && !$ribbonTabToActivate && !noExplicitActivation) {
                $ribbonTabToActivate = $ribbonTitle;
            }

            if (this.lastActiveComponentId === ribbonWidget.componentId) {
                $lastActiveRibbon = $ribbonTitle;
            }
        }

        keyboardActionsService.getActions().then((actions) => {
            this.$tabContainer.find(".ribbon-tab-title-icon").tooltip({
                title: () => {
                    const toggleCommandName = $(this).attr("data-toggle-command");
                    const action = actions.find((act) => act.actionName === toggleCommandName);
                    const title = $(this).attr("data-title");

                    if (action?.effectiveShortcuts && action.effectiveShortcuts.length > 0) {
                        return `${title} (${action.effectiveShortcuts.join(", ")})`;
                    } else {
                        return title ?? "";
                    }
                }
            });
        });

        if (!$ribbonTabToActivate) {
            $ribbonTabToActivate = $lastActiveRibbon;
        }

        if ($ribbonTabToActivate) {
            this.toggleRibbonTab($ribbonTabToActivate, false);
        } else {
            this.$bodyContainer.find(".ribbon-body").removeClass("active");
        }
    }

    isRibbonTabActive(name: string) {
        const $ribbonComponent = this.$widget.find(`.ribbon-tab-title[data-ribbon-component-name='${name}']`);

        return $ribbonComponent.hasClass("active");
    }

    ensureOwnedAttributesAreOpen(ntxId: string | null | undefined) {
        if (ntxId && this.isNoteContext(ntxId) && !this.isRibbonTabActive("ownedAttributes")) {
            this.toggleRibbonTabWithName("ownedAttributes", ntxId);
        }
    }

    addNewLabelEvent({ ntxId }: EventData<"addNewLabel">) {
        this.ensureOwnedAttributesAreOpen(ntxId);
    }

    addNewRelationEvent({ ntxId }: EventData<"addNewRelation">) {
        this.ensureOwnedAttributesAreOpen(ntxId);
    }

    toggleRibbonTabWithName(name: string, ntxId?: string) {
        if (!this.isNoteContext(ntxId)) {
            return false;
        }

        const $ribbonComponent = this.$widget.find(`.ribbon-tab-title[data-ribbon-component-name='${name}']`);

        if ($ribbonComponent) {
            this.toggleRibbonTab($ribbonComponent);
        }
    }

    handleEvent<T extends EventNames>(name: T, data: EventData<T>) {
        const PREFIX = "toggleRibbonTab";

        if (name.startsWith(PREFIX)) {
            let componentName = name.substr(PREFIX.length);
            componentName = componentName[0].toLowerCase() + componentName.substr(1);

            this.toggleRibbonTabWithName(componentName, (data as any).ntxId);
        } else {
            return super.handleEvent(name, data);
        }
    }

    async handleEventInChildren<T extends EventNames>(name: T, data: EventData<T>) {
        if (["activeContextChanged", "setNoteContext"].includes(name)) {
            // won't trigger .refresh();
            await super.handleEventInChildren("setNoteContext", data as EventData<"activeContextChanged" | "setNoteContext">);
        } else if (this.isEnabled() || name === "initialRenderComplete") {
            const activeRibbonWidget = this.getActiveRibbonWidget();

            // forward events only to active ribbon tab, inactive ones don't need to be updated
            if (activeRibbonWidget) {
                await activeRibbonWidget.handleEvent(name, data);
            }

            for (const buttonWidget of this.buttonWidgets) {
                await buttonWidget.handleEvent(name, data);
            }
        }
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (!this.note) {
            return;
        }

        if (this.noteId && loadResults.isNoteReloaded(this.noteId) && this.lastNoteType !== this.note.type) {
            // note type influences the list of available ribbon tabs the most
            // check for the type is so that we don't update on each title rename
            this.lastNoteType = this.note.type;

            this.refresh();
        } else if (loadResults.getAttributeRows(this.componentId).find((attr) => attributeService.isAffecting(attr, this.note))) {
            this.refreshWithNote(this.note, true);
        }
    }

    async noteTypeMimeChangedEvent() {
        // We are ignoring the event which triggers a refresh since it is usually already done by a different
        // event and causing a race condition in which the items appear twice.
    }

    /**
     * Executed as soon as the user presses the "Edit" floating button in a read-only text note.
     *
     * <p>
     * We need to refresh the ribbon for cases such as the classic editor which relies on the read-only state.
     */
    readOnlyTemporarilyDisabledEvent() {
        this.refresh();
    }

    getActiveRibbonWidget() {
        return this.ribbonWidgets.find((ch) => ch.componentId === this.lastActiveComponentId);
    }
}
