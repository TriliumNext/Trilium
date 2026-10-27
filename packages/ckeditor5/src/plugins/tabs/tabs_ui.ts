import {
    addListToDropdown,
    ButtonView,
    Collection,
    type Command,
    createDropdown,
    IconLink,
    IconNextArrow,
    IconPlus,
    IconPreviousArrow,
    IconRemove,
    type ListDropdownButtonDefinition,
    type Locale,
    type LocaleTranslate,
    Plugin,
    ViewModel,
    WidgetToolbarRepository
} from "ckeditor5";

import tabsBottomIcon from "../../icons/tabs-bottom.svg?raw";
import tabsIcon from "../../icons/tabs.svg?raw";
import { findSelectedWidget } from "../widget_utils.js";
import {
    DEFAULT_TAB_ALIGNMENT, TAB_ALIGNMENTS, type TabAlignment, TABS_WIDGET_PROPERTY
} from "./constants.js";
import type { TabAlignmentCommand } from "./tabs_commands.js";

/**
 * The insert button for tabs blocks and the contextual toolbar that adds, removes, reorders and
 * aligns tabs while the selection is inside a block.
 */
export default class TabsUI extends Plugin {

    public static get pluginName() {
        return "TabsUI" as const;
    }

    public static get requires() {
        return [WidgetToolbarRepository] as const;
    }

    public init(): void {
        const t = this.editor.t;
        this.addButton("tabs", t("Tabs"), tabsIcon);
        this.addButton("insertTab", t("Add tab"), IconPlus);
        this.addButton("removeTab", t("Remove tab"), IconRemove);
        this.addButton("moveTabLeft", t("Move tab left"), IconPreviousArrow);
        this.addButton("moveTabRight", t("Move tab right"), IconNextArrow);
        this.addCopyLinkButton();
        this.editor.ui.componentFactory.add("tabAlignment",
            locale => this.createAlignmentDropdown(locale));
    }

    public afterInit(): void {
        const t = this.editor.t;
        this.editor.plugins.get(WidgetToolbarRepository).register("tabs", {
            ariaLabel: t("Tabs toolbar"),
            items: [
                "insertTab", "removeTab", "|", "moveTabLeft", "moveTabRight", "|", "copyTabLink",
                "|", "tabAlignment"
            ],
            getRelatedElement: selection =>
                findSelectedWidget(selection, TABS_WIDGET_PROPERTY)
        });
    }

    /** Adds the button that copies a link to the tab holding the selection, through the host. */
    private addCopyLinkButton() {
        const editor = this.editor;
        editor.ui.componentFactory.add("copyTabLink", locale => {
            const button = new ButtonView(locale);
            button.set({ label: editor.t("Copy link to tab"), icon: IconLink, tooltip: true });

            const command = editor.commands.get("assignTabReference") as Command;
            button.bind("isEnabled").to(command, "isEnabled");
            this.listenTo(button, "execute", () => editor.config.get("tabs")?.copyReference?.());
            return button;
        });
    }

    /**
     * A dropdown that puts the titles above or below the panels. Its button shows the icon of the
     * current alignment.
     */
    private createAlignmentDropdown(locale: Locale) {
        const editor = this.editor;
        const command = editor.commands.get("tabAlignment") as TabAlignmentCommand;
        const dropdown = createDropdown(locale);
        dropdown.buttonView.set({ label: editor.t("Tab alignment"), tooltip: true });
        dropdown.buttonView.bind("icon").to(command, "value",
            value => getAlignmentIcon(value ?? DEFAULT_TAB_ALIGNMENT));
        dropdown.bind("isEnabled").to(command, "isEnabled");

        const items = new Collection<ListDropdownButtonDefinition>();
        for (const alignment of TAB_ALIGNMENTS) {
            const model = new ViewModel({
                commandParam: alignment,
                label: getAlignmentLabel(editor.t, alignment),
                icon: getAlignmentIcon(alignment),
                role: "menuitemradio",
                withText: true
            });
            model.bind("isOn").to(command, "value", value => value === alignment);
            items.add({ type: "button", model });
        }
        addListToDropdown(dropdown, items);

        this.listenTo(dropdown, "execute", evt => {
            const value = (evt.source as { commandParam: TabAlignment }).commandParam;
            editor.execute("tabAlignment", { value });
            editor.editing.view.focus();
        });
        return dropdown;
    }

    private addButton(name: string, label: string, icon: string) {
        const editor = this.editor;
        editor.ui.componentFactory.add(name, locale => {
            const button = new ButtonView(locale);
            button.set({ label, icon, tooltip: true });

            // TabsEditing, which TabsUI requires, registers every command before this runs.
            const command = editor.commands.get(name) as Command;
            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute(name);
                editor.editing.view.focus();
            });
            return button;
        });
    }
}

function getAlignmentLabel(t: LocaleTranslate, alignment: TabAlignment): string {
    return alignment === "bottom" ? t("Align tabs at bottom") : t("Align tabs at top");
}

function getAlignmentIcon(alignment: TabAlignment): string {
    return alignment === "bottom" ? tabsBottomIcon : tabsIcon;
}

declare module "ckeditor5" {
    interface EditorConfig {
        /** What the host of the editor does with tabs blocks. */
        tabs?: {
            /** Copies a link to the tab that holds the selection. */
            copyReference?(): void;
        };
    }
}
