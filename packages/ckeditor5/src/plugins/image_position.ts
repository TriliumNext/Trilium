import { ImageStyleEditing, Plugin } from "ckeditor5";
import type { ImageStyleOptionDefinition, Locale } from "ckeditor5";

import { createPositionDropdown, type PositionGroup } from "./position_dropdown.js";

/**
 * Registers `imagePosition`, one dropdown for the styles of an image, in place of CKEditor's
 * separate style buttons and their "Wrap text" and "Block align" dropdowns, whose rows read the
 * same. The rows are grouped by how text runs around the image: in line with it, broken above and
 * below it ("Break text"), or wrapped around it ("Wrap text"). The button shows the icon of the
 * current style.
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

        return createPositionDropdown(editor, locale, {
            // Always registered: `ImageStyleEditing` adds it.
            commandName: "imageStyle",
            label: t("Image position"),
            groups: groups.map(({ label, rows }): PositionGroup => ({
                label,
                rows: rows.flatMap(([name, rowLabel]) => {
                    const style = styles.get(name);
                    return style ? [{ value: name, label: rowLabel, icon: style.icon }] : [];
                })
            }))
        });
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ImagePosition.pluginName]: ImagePosition;
    }
}
