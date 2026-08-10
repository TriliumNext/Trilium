import { ButtonView, Plugin } from "ckeditor5";
import collapsibleIcon from "../../icons/collapsible.svg?raw";

export default class CollapsibleUI extends Plugin {

    public static get pluginName() {
        return "CollapsibleUI" as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;

        editor.ui.componentFactory.add("collapsible", locale => {
            const command = editor.commands.get("collapsible");
            const button = new ButtonView(locale);

            button.set({
                label: t("Collapsible block"),
                icon: collapsibleIcon,
                tooltip: true
            });

            if (command) {
                button.bind("isEnabled").to(command, "isEnabled");
            }

            this.listenTo(button, "execute", () => {
                editor.execute("collapsible");
                editor.editing.view.focus();
            });

            return button;
        });
    }
}
