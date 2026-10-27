import {
    addListToDropdown, Collection, createDropdown, ImageStyleEditing, Plugin, UIModel
} from "ckeditor5";
import type {
    ButtonView, Command, ImageStyleOptionDefinition, ListDropdownButtonDefinition, ListDropdownItemDefinition,
    Locale
} from "ckeditor5";

import { openListAsMenu } from "./toolbar_group_menu.js";

/**
 * Registers `imagePosition`, one dropdown for the styles of an image, in place of CKEditor's
 * separate style buttons and their "Wrap text" and "Block align" dropdowns, whose rows read the
 * same. The rows are grouped by how text runs around the image, as Word and Google Docs name it:
 * in line with it, broken above and below it ("Break text"), or wrapped around it ("Wrap text").
 * The button shows the icon of the current style. As a menu of `ToolbarGroupMenu`, as on a phone,
 * the rows are tiles under their headings.
 */
export default class ImagePosition extends Plugin {

    static get requires() {
        return [ImageStyleEditing] as const;
    }

    static get pluginName() {
        return "ImagePosition" as const;
    }

    init() {
        this.editor.ui.componentFactory.add("imagePosition", (locale) => this.createDropdown(locale));
    }

    private createDropdown(locale: Locale) {
        const editor = this.editor;
        const t = editor.t;
        // Always registered: `ImageStyleEditing` adds it.
        const command = editor.commands.get("imageStyle") as Command;
        // Set by `ImageStyleEditing.init()`, which runs first as a plugin this one requires.
        const normalizedStyles = editor.plugins.get(ImageStyleEditing).normalizedStyles as ImageStyleOptionDefinition[];
        const styles = new Map(normalizedStyles.map((style) => [style.name, style]));

        const groups: { label?: string; rows: [string, string][] }[] = [
            { rows: [["inline", t("In line")]] },
            {
                label: t("Break text"),
                rows: [["alignBlockLeft", t("Align left")], ["alignCenter", t("Align center")], ["alignBlockRight", t("Align right")]]
            },
            { label: t("Wrap text"), rows: [["alignLeft", t("Align left")], ["alignRight", t("Align right")]] }
        ];

        const items = new Collection<ListDropdownItemDefinition>();
        for (const { label, rows } of groups) {
            const buttons = new Collection<ListDropdownButtonDefinition>();
            for (const [name, rowLabel] of rows) {
                const style = styles.get(name);
                if (style) {
                    buttons.add(createRow(style, rowLabel, command));
                }
            }
            if (!buttons.length) {
                continue;
            }
            if (label) {
                items.add({ type: "group", label, items: buttons });
            } else {
                items.addMany(buttons);
            }
        }

        const dropdown = createDropdown(locale);
        addListToDropdown(dropdown, items, { role: "menu" });
        dropdown.buttonView.set({ label: t("Image position"), tooltip: true });
        dropdown.buttonView.bind("icon").to(command, "value", (value) => {
            const current = typeof value === "string" ? styles.get(value) : undefined;
            return (current ?? styles.get("inline") ?? styles.values().next().value)?.icon;
        });
        dropdown.bind("isEnabled").to(command);
        dropdown.on("execute", (evt) => {
            const { styleName } = evt.source as ButtonView & { styleName: string };
            editor.execute("imageStyle", { value: styleName });
            editor.editing.view.focus();
        });
        openListAsMenu(dropdown, { layout: "tiles" });
        return dropdown;
    }
}

function createRow(style: ImageStyleOptionDefinition, label: string, command: Command): ListDropdownButtonDefinition {
    const model = new UIModel({
        label, icon: style.icon, withText: true, role: "menuitemradio", styleName: style.name
    });
    model.bind("isOn").to(command, "value", (value) => value === style.name);
    return { type: "button", model };
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ImagePosition.pluginName]: ImagePosition;
    }
}
