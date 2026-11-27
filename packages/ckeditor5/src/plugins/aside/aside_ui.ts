import colorFillIcon from "boxicons/svg/regular/bx-color-fill.svg?raw";
import {
    ButtonView,
    type Command,
    type Editor,
    FontColorUIBase,
    IconRemove,
    Plugin,
    WidgetToolbarRepository
} from "ckeditor5";

import asideIcon from "../../icons/aside.svg?raw";
import { hasContextToolbar } from "../context_toolbar.js";
import PositionedWidgets, {
    createWidgetPositionDropdown, getAnchoredToolbarPositions
} from "../positioned_widgets.js";
import { findSelectedWidget } from "../widget_utils.js";
import { getSelectedAside } from "./aside_commands.js";
import { ASIDE_WIDGET_PROPERTY, COMMANDS, DEFAULT_COLOR } from "./constants.js";

/**
 * The insert button of the aside, and the toolbar of the aside that is selected or holds the caret,
 * with the background color and position dropdowns and the remove button.
 */
export default class AsideUI extends Plugin {

    static get pluginName() {
        return "AsideUI" as const;
    }

    static get requires() {
        return [ WidgetToolbarRepository, AsideColorUI ] as const;
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

        // On a phone, the context bar shows each dropdown as a menu of rows; a color grid has none.
        const items = [ COMMANDS.position, COMMANDS.remove ];
        editor.plugins.get(WidgetToolbarRepository).register("aside", {
            ariaLabel: editor.t("Aside toolbar"),
            items: hasContextToolbar(editor) ? items : [ COMMANDS.color, ...items ],
            balloonClassName: "ck-toolbar-container aside-toolbar",
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

/**
 * The background color dropdown of an aside: the font background color dropdown, with the swatches
 * of `asideColor` in the editor configuration. Its document colors are off, since they list the
 * colors of text only.
 */
export class AsideColorUI extends FontColorUIBase {

    static get pluginName() {
        return "AsideColorUI" as const;
    }

    constructor(editor: Editor) {
        const t = editor.t;
        editor.config.define(COMMANDS.color, {
            colors: [ { color: DEFAULT_COLOR, label: "Dim grey" } ],
            columns: 5,
            documentColors: 0
        });
        // The type of `FontColorUIBase` allows only the font color names; the class takes any.
        const name = COMMANDS.color as ColorUIName;
        super(editor, {
            commandName: name,
            componentName: name,
            icon: colorFillIcon,
            dropdownLabel: t("Background color")
        });
    }

}

type ColorUIName = ConstructorParameters<typeof FontColorUIBase>[1]["componentName"];
