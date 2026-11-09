import {
    ButtonView,
    type Command,
    createDropdown,
    type Editor,
    IconLink,
    IconNextArrow,
    IconPlus,
    IconPreviousArrow,
    IconRemove,
    IconThreeVerticalDots,
    type LocaleTranslate,
    Plugin,
    WidgetToolbarRepository
} from "ckeditor5";

import tabsBottomIcon from "../../icons/tabs-bottom.svg?raw";
import tabsIcon from "../../icons/tabs.svg?raw";
import ToolbarGroupMenu, {
    openListAsMenu, type ToolbarGroupMenuEntry, type ToolbarGroupMenuItem
} from "../toolbar_group_menu.js";
import { findSelectedWidget } from "../widget_utils.js";
import {
    DEFAULT_TAB_ALIGNMENT, TAB_ALIGNMENTS, type TabAlignment, TABS_WIDGET_PROPERTY
} from "./constants.js";
import type { TabAlignmentCommand } from "./tabs_commands.js";

/** Wraps the action of an entry, as `ToolbarGroupMenu` runs it. */
type RunEntry = (action: () => void) => () => void;

/**
 * The insert button for tabs blocks and the contextual toolbar that adds, removes and reorders
 * tabs while the selection is inside a block. The "More actions" menu at the end of the toolbar
 * repeats those actions, and also copies a reference to the tab, aligns the tabs and deletes the
 * whole block.
 */
export default class TabsUI extends Plugin {

    public static get pluginName() {
        return "TabsUI" as const;
    }

    public static get requires() {
        return [WidgetToolbarRepository, ToolbarGroupMenu] as const;
    }

    public init(): void {
        const t = this.editor.t;
        this.addButton("tabs", t("Tabs"), tabsIcon);
        this.addButton("insertTab", t("Add tab"), IconPlus);
        this.addButton("removeTab", t("Remove tab"), IconRemove);
        this.addButton("moveTabLeft", t("Move tab left"), IconPreviousArrow);
        this.addButton("moveTabRight", t("Move tab right"), IconNextArrow);
        this.addMenu();
    }

    public afterInit(): void {
        const t = this.editor.t;
        this.editor.plugins.get(WidgetToolbarRepository).register("tabs", {
            ariaLabel: t("Tabs toolbar"),
            items: ["insertTab", "removeTab", "|", "moveTabLeft", "moveTabRight", "tabsMenu"],
            getRelatedElement: selection =>
                findSelectedWidget(selection, TABS_WIDGET_PROPERTY)
        });
    }

    /**
     * Adds the "More actions" menu, which `ToolbarGroupMenu` has the host draw with the entries of
     * {@link describeMenu}.
     */
    private addMenu() {
        const editor = this.editor;
        editor.ui.componentFactory.add("tabsMenu", locale => {
            // A plain button, without the arrow of `DropdownButtonView`, opens the dropdown.
            const button = new ButtonView(locale);
            button.set({
                label: editor.t("More actions"),
                icon: IconThreeVerticalDots,
                tooltip: true
            });
            button.delegate("execute").to(button, "open");

            const dropdown = createDropdown(locale, button);
            openListAsMenu(dropdown, { describe: run => describeMenu(editor, run) });
            return dropdown;
        });
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

/**
 * The entries of the "More actions" menu: adding a tab, copying a reference to the tab holding the
 * selection, moving that tab, a submenu of alignments, and deleting the tab or the whole block.
 */
function describeMenu(editor: Editor, run: RunEntry): ToolbarGroupMenuItem[] {
    const t = editor.t;
    const alignmentCommand = editor.commands.get("tabAlignment") as TabAlignmentCommand;
    const alignment = alignmentCommand.value ?? DEFAULT_TAB_ALIGNMENT;

    return [
        describeCommand(editor, run, "insertTab", t("Add new tab"), IconPlus),
        {
            kind: "entry", label: t("Copy reference to this tab"), icon: IconLink,
            isEnabled: (editor.commands.get("assignTabReference") as Command).isEnabled,
            run: run(() => editor.config.get("tabs")?.copyReference?.())
        },
        { kind: "separator" },
        describeCommand(editor, run, "moveTabRight", t("Move tab right"), IconNextArrow),
        describeCommand(editor, run, "moveTabLeft", t("Move tab left"), IconPreviousArrow),
        { kind: "separator" },
        {
            kind: "entry", label: t("Tab alignment"), icon: getAlignmentIcon(alignment),
            isEnabled: alignmentCommand.isEnabled,
            children: TAB_ALIGNMENTS.map((value): ToolbarGroupMenuEntry => ({
                kind: "entry", label: getAlignmentLabel(t, value), icon: getAlignmentIcon(value),
                isEnabled: true, isOn: value === alignment,
                run: run(() => editor.execute("tabAlignment", { value }))
            }))
        },
        { kind: "separator" },
        describeCommand(editor, run, "removeTab", t("Delete tab"), IconRemove),
        {
            ...describeCommand(editor, run, "deleteTabs", t("Delete all tabs"), IconRemove),
            isDestructive: true
        }
    ];
}

/** The entry that runs `commandName`, enabled while the command is. */
function describeCommand(
    editor: Editor, run: RunEntry, commandName: string, label: string, icon: string
): ToolbarGroupMenuEntry {
    return {
        kind: "entry", label, icon,
        isEnabled: (editor.commands.get(commandName) as Command).isEnabled,
        run: run(() => editor.execute(commandName))
    };
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
