import {
    addListToDropdown,
    Collection,
    createDropdown,
    SplitButtonView,
    SwitchButtonView,
    UIModel
} from "ckeditor5";
import type {
    ButtonExecuteEvent,
    Command,
    DropdownView,
    ListDropdownItemDefinition,
    Locale,
    Plugin
} from "ckeditor5";

export type CommandListItem =
    | { type: "button" | "switchbutton"; commandName: string; label: string }
    | { type: "separator" };

export interface CommandListDropdownOptions {
    label: string;
    icon: string;
    items: CommandListItem[];
    /** Makes the button a split button whose main part runs this command. */
    splitButtonCommandName?: string;
}

/**
 * Creates a dropdown listing `items`, each running its command and enabled while it is. The
 * dropdown is enabled while one of the commands is. `plugin` owns the listeners.
 */
export function createCommandListDropdown(
    plugin: Plugin,
    locale: Locale,
    options: CommandListDropdownOptions
): DropdownView {
    const editor = plugin.editor;
    const { label, icon, items, splitButtonCommandName } = options;

    const dropdownView = splitButtonCommandName
        ? createDropdown(locale, SplitButtonView)
        : createDropdown(locale);
    dropdownView.buttonView.set({ label, icon, tooltip: true });

    const commands: Command[] = [];
    const definitions = new Collection<ListDropdownItemDefinition>();
    for (const item of items) {
        if (item.type === "separator") {
            // A new object each time: `Collection#add()` gives it an `id`.
            definitions.add({ type: "separator" });
            continue;
        }

        // Skips an item whose command is not registered, e.g. after an upstream rename.
        const command = editor.commands.get(item.commandName);
        if (!command) {
            continue;
        }
        commands.push(command);

        const model = new UIModel({
            commandName: item.commandName,
            label: item.label,
            withText: true
        });
        model.bind("isEnabled").to(command);
        if (item.type === "switchbutton") {
            model.bind("isOn").to(command, "value");
        }
        definitions.add({ type: item.type, model });
    }
    addListToDropdown(dropdownView, definitions);

    dropdownView.bind("isEnabled").toMany(commands, "isEnabled",
        (...areEnabled) => areEnabled.some((isEnabled) => isEnabled));

    if (splitButtonCommandName) {
        plugin.listenTo(dropdownView.buttonView, "execute", () => {
            editor.execute(splitButtonCommandName);
            editor.editing.view.focus();
        });
    }
    plugin.listenTo<ButtonExecuteEvent>(dropdownView, "execute", (evt) => {
        const source = evt.source as { commandName: string };
        editor.execute(source.commandName);
        // A switch keeps the dropdown open, so the focus stays in the list.
        if (!(source instanceof SwitchButtonView)) {
            editor.editing.view.focus();
        }
    });

    return dropdownView;
}

export const SEPARATOR_ITEM: CommandListItem = { type: "separator" };

export function buttonItem(commandName: string, label: string): CommandListItem {
    return { type: "button", commandName, label };
}

export function switchItem(commandName: string, label: string): CommandListItem {
    return { type: "switchbutton", commandName, label };
}
