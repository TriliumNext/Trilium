import { ButtonView, Plugin } from "ckeditor5";
import formatIcon from "../../icons/format-codeblock.svg?raw";
import { FormatterRegistry } from "./code_formatter";
import { FormatCodeblockCommand } from "./format_codeblock_command";
import { PrettierFormatter } from "./prettier_formatter";

export default class FormatCodeblockButton extends Plugin {
    public init() {
        const editor = this.editor;

        const registry = FormatterRegistry.getInstance();
        registry.register(new PrettierFormatter());

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
