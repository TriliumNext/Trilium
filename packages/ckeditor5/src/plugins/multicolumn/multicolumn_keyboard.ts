import { Plugin } from "ckeditor5";

import ContainerKeyboard from "../containers/container_keyboard.js";
import { ELEMENTS } from "./constants.js";
import MulticolumnEditing from "./multicolumn_editing.js";

/**
 * Keyboard shortcuts of multicolumn layouts, run by `ContainerKeyboard`. Ctrl+Left/Right and
 * Ctrl+Shift+Home/End move the selected content to another column, Ctrl+Alt+Left/Right/Home/End
 * move the current column, and Ctrl+Enter and Ctrl+Shift+Enter add a column after or before it.
 */
export default class MulticolumnKeyboard extends Plugin {

    public static get pluginName() {
        return "MulticolumnKeyboard" as const;
    }

    public static get requires() {
        return [MulticolumnEditing, ContainerKeyboard] as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;

        editor.plugins.get(ContainerKeyboard).register(ELEMENTS.column, {
            moveContent: "moveToLayoutColumn",
            moveContainer: "moveLayoutColumn",
            insert: "insertLayoutColumn"
        });

        editor.accessibility.addKeystrokeInfoGroup({
            id: "multicolumnLayout",
            label: t("Keystrokes that can be used in a multicolumn layout"),
            keystrokes: [
                {
                    label: t("Move the selected content to the column on the left"),
                    keystroke: "Ctrl+ArrowLeft"
                },
                {
                    label: t("Move the selected content to the column on the right"),
                    keystroke: "Ctrl+ArrowRight"
                },
                {
                    label: t("Move the selected content to the first column"),
                    keystroke: "Ctrl+Shift+Home"
                },
                {
                    label: t("Move the selected content to the last column"),
                    keystroke: "Ctrl+Shift+End"
                },
                { label: t("Move the column to the left"), keystroke: "Ctrl+Alt+ArrowLeft" },
                { label: t("Move the column to the right"), keystroke: "Ctrl+Alt+ArrowRight" },
                { label: t("Make the column the first one"), keystroke: "Ctrl+Alt+Home" },
                { label: t("Make the column the last one"), keystroke: "Ctrl+Alt+End" },
                { label: t("Add a column after the current one"), keystroke: "Ctrl+Enter" },
                { label: t("Add a column before the current one"), keystroke: "Ctrl+Shift+Enter" }
            ]
        });
    }

}
