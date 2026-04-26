import { ButtonView, Notification, Plugin } from "ckeditor5";
import formatIcon from "../../icons/format-codeblock.svg?raw";
import { FormatCodeblockCommand } from "./format_codeblock_command";

export default class FormatCodeblockButton extends Plugin {
    static get requires() {
        return [Notification];
    }

    public init() {
        const editor = this.editor;

        editor.commands.add(
            "formatCodeblock",
            new FormatCodeblockCommand(this.editor),
        );

        const componentFactory = editor.ui.componentFactory;
        componentFactory.add("formatCodeblock", (locale) => {
            const button = new ButtonView(locale);
            const command = editor.commands.get("formatCodeblock")!;

            button.set({
                tooltip: "Format code block",
                icon: formatIcon,
            });

            button.bind("isEnabled").to(command, "isEnabled");

            this.listenTo(button, "execute", () => {
                editor.execute("formatCodeblock");
            });

            return button;
        });
    }
}
