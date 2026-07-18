import { ButtonView, Plugin } from "ckeditor5";
import collapsibleIcon from "../theme/icons/collapsible.svg?raw";

export default class CollapsibleUI extends Plugin {

    public static get pluginName() {
        return "CollapsibleUI" as const;
    }

    public init(): void {
        const editor = this.editor;
        const translate = (editor.config.get("translate") as ((key: string, params?: Record<string, unknown>) => string) | undefined)
            ?? ((key: string) => key);

        editor.ui.componentFactory.add("collapsible", locale => {
            const command = editor.commands.get("collapsible")!;
            const button = new ButtonView(locale);

            button.set({
                label: translate("text-editor.collapsible-button-label"),
                icon: collapsibleIcon,
                tooltip: true
            });

            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute("collapsible");
                editor.editing.view.focus();
            });

            return button;
        });
    }
}
