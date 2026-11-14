import {
    ButtonView,
    type Command,
    IconRemove,
    Plugin,
    WidgetToolbarRepository
} from "ckeditor5";

import asideIcon from "../../icons/aside.svg?raw";
import PositionedWidgets, {
    createWidgetPositionDropdown, getAnchoredToolbarPositions
} from "../positioned_widgets.js";
import { findSelectedWidget } from "../widget_utils.js";
import { getSelectedAside } from "./aside_commands.js";
import { ASIDE_WIDGET_PROPERTY, COMMANDS } from "./constants.js";

/**
 * The insert button of the aside, and the toolbar of the aside that is selected or holds the caret,
 * with the position dropdown and the remove button.
 */
export default class AsideUI extends Plugin {

    static get pluginName() {
        return "AsideUI" as const;
    }

    static get requires() {
        return [ WidgetToolbarRepository ] as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;
        this.addCommandButton("aside", COMMANDS.insert, t("Aside"), asideIcon);
        this.addCommandButton(COMMANDS.remove, COMMANDS.remove, t("Remove aside"), IconRemove);
        editor.ui.componentFactory.add(COMMANDS.position, (locale) =>
            createWidgetPositionDropdown(editor, locale, {
                commandName: COMMANDS.position, label: t("Box position")
            }));
    }

    afterInit() {
        const editor = this.editor;
        const positionedWidgets = editor.plugins.get(PositionedWidgets);
        const getAnchor = () => {
            const aside = getSelectedAside(editor);
            return aside ? positionedWidgets.getAnchor(aside) : "center";
        };

        editor.plugins.get(WidgetToolbarRepository).register("aside", {
            ariaLabel: editor.t("Aside toolbar"),
            items: [ COMMANDS.position, COMMANDS.remove ],
            positions: getAnchoredToolbarPositions(getAnchor),
            getRelatedElement: (selection) => findSelectedWidget(selection, ASIDE_WIDGET_PROPERTY)
        });
    }

    /** Adds a button named `name` that runs `commandName` and returns the focus to the text. */
    private addCommandButton(name: string, commandName: string, label: string, icon: string) {
        const editor = this.editor;
        editor.ui.componentFactory.add(name, (locale) => {
            // AsideEditing, which the glue plugin loads first, registers every command.
            const command = editor.commands.get(commandName) as Command;
            const button = new ButtonView(locale);
            button.set({ label, icon, tooltip: true });
            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute(commandName);
                editor.editing.view.focus();
            });
            return button;
        });
    }
}
