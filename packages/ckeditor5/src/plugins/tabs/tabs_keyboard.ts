import { Plugin } from "ckeditor5";

import ContainerKeyboard from "../containers/container_keyboard.js";
import { ELEMENTS } from "./constants.js";
import TabsEditing from "./tabs_editing.js";

/**
 * Keyboard shortcuts of tabs blocks, run by `ContainerKeyboard`. Ctrl+Left/Right and
 * Ctrl+Shift+Home/End move the selected content to another tab and show it,
 * Ctrl+Alt+Left/Right/Home/End move the current tab, and Ctrl+Enter and Ctrl+Shift+Enter add a tab
 * after or before it.
 */
export default class TabsKeyboard extends Plugin {

    public static get pluginName() {
        return "TabsKeyboard" as const;
    }

    public static get requires() {
        return [TabsEditing, ContainerKeyboard] as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;

        editor.plugins.get(ContainerKeyboard).register(ELEMENTS.tab, {
            moveContent: "moveToTab",
            moveContainer: "moveTab",
            insert: "insertTab"
        });

        editor.accessibility.addKeystrokeInfoGroup({
            id: "tabs",
            label: t("Keystrokes that can be used in a tabs block"),
            keystrokes: [
                {
                    label: t("Move the selected content to the tab on the left"),
                    keystroke: "Ctrl+ArrowLeft"
                },
                {
                    label: t("Move the selected content to the tab on the right"),
                    keystroke: "Ctrl+ArrowRight"
                },
                {
                    label: t("Move the selected content to the first tab"),
                    keystroke: "Ctrl+Shift+Home"
                },
                {
                    label: t("Move the selected content to the last tab"),
                    keystroke: "Ctrl+Shift+End"
                },
                { label: t("Move the tab to the left"), keystroke: "Ctrl+Alt+ArrowLeft" },
                { label: t("Move the tab to the right"), keystroke: "Ctrl+Alt+ArrowRight" },
                { label: t("Make the tab the first one"), keystroke: "Ctrl+Alt+Home" },
                { label: t("Make the tab the last one"), keystroke: "Ctrl+Alt+End" },
                { label: t("Add a tab after the current one"), keystroke: "Ctrl+Enter" },
                { label: t("Add a tab before the current one"), keystroke: "Ctrl+Shift+Enter" }
            ]
        });
    }

}
