import { ButtonView, Command, Plugin } from "ckeditor5";

import clozeIcon from "../icons/cloze.svg?raw";

export const COMMAND_NAME = "insertClozeDeletion";

const CLOZE_PREFIX_PATTERN = /\{\{c([1-9]\d*)::/g;
const PLACEHOLDER = "text";

export default class ClozePlugin extends Plugin {
    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.commands.add(COMMAND_NAME, new InsertClozeDeletionCommand(editor));

        editor.ui.componentFactory.add("clozeDeletion", (locale) => {
            const view = new ButtonView(locale);
            const command = editor.commands.get(COMMAND_NAME);
            if (!command) {
                throw new Error(`Missing '${COMMAND_NAME}' command.`);
            }

            view.set({
                label: t("Make cloze deletion"),
                icon: clozeIcon,
                tooltip: true
            });
            view.bind("isEnabled").to(command, "isEnabled");
            view.on("execute", () => {
                editor.execute(COMMAND_NAME);
                editor.editing.view.focus();
            });

            return view;
        });
    }
}

class InsertClozeDeletionCommand extends Command {
    refresh() {
        const editor = this.editor;
        const position = editor.model.document.selection.getFirstPosition();

        this.isEnabled = !editor.isReadOnly
            && !!position
            && editor.model.schema.checkChild(position, "$text");
    }

    execute() {
        const editor = this.editor;
        const model = editor.model;
        const selection = model.document.selection;
        const range = selection.getFirstRange();
        if (!range) {
            return;
        }

        const prefix = `{{c${findNextClozeIndex(editor.getData())}::`;

        model.change((writer) => {
            if (range.isCollapsed) {
                const position = range.start;
                const attributes = Object.fromEntries(selection.getAttributes());
                writer.insertText(`${prefix}${PLACEHOLDER}}}`, attributes, position);

                const placeholderStart = writer.createPositionAt(position.parent, position.offset + prefix.length);
                const placeholderEnd = writer.createPositionAt(
                    position.parent,
                    position.offset + prefix.length + PLACEHOLDER.length
                );
                writer.setSelection(writer.createRange(placeholderStart, placeholderEnd));
                return;
            }

            writer.insertText("}}", range.end);
            writer.insertText(prefix, range.start);
        });
    }
}

function findNextClozeIndex(data: string) {
    let nextIndex = 1;

    for (const match of data.matchAll(CLOZE_PREFIX_PATTERN)) {
        const index = Number(match[1]);
        if (Number.isSafeInteger(index) && index >= nextIndex && index < Number.MAX_SAFE_INTEGER) {
            nextIndex = index + 1;
        }
    }

    return nextIndex;
}
