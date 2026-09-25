import {
    addListToDropdown, Collection, Command, createDropdown, type Editor, type ListDropdownItemDefinition, Plugin,
    SplitButtonView, ViewModel
} from 'ckeditor5';
import dateTimeIcon from '../icons/date-time.svg?raw';

export const COMMAND_NAME = 'insertDateTimeToText';

/**
 * The Day.js formats offered besides the user's own `customDateTimeFormat`. `kind` is `time` for a
 * format that shows only the time, so the `/` palette can title it "Insert time".
 */
export const DATE_TIME_PRESETS: readonly DateTimePreset[] = [
    { format: 'YYYY-MM-DD', kind: 'dateTime' },
    { format: 'HH:mm', kind: 'time' },
    { format: 'D MMMM YYYY', kind: 'dateTime' },
    { format: 'dddd, D MMMM YYYY', kind: 'dateTime' },
    { format: 'YYYY-MM-DDTHH:mm:ssZ', kind: 'dateTime' }
];

/**
 * Introduces the `dateTime` split button: the button inserts the current date and time in the
 * user's `customDateTimeFormat`, and the list offers the same date in each of `DATE_TIME_PRESETS`.
 */
export default class InsertDateTimePlugin extends Plugin {
    init() {
        const editor = this.editor;
        const t = editor.t;

        const command = new InsertDateTimeCommand(editor);
        editor.commands.add(COMMAND_NAME, command);

        editor.ui.componentFactory.add('dateTime', locale => {
            const dropdownView = createDropdown(locale, SplitButtonView);
            const items = new Collection<ListDropdownItemDefinition>();

            addListToDropdown(dropdownView, items);

            dropdownView.buttonView.set({
                label: t('Insert date/time'),
                icon: dateTimeIcon,
                tooltip: true
            });
            dropdownView.bind('isEnabled').to(command, 'isEnabled');

            // The labels show the current time, so they are rendered each time the list opens.
            dropdownView.on('change:isOpen', (_evt, _name, isOpen) => {
                if (isOpen) {
                    items.clear();
                    items.addMany(createFormatItems(editor));
                }
            });

            dropdownView.buttonView.on('execute', () => {
                editor.execute(COMMAND_NAME);
                editor.editing.view.focus();
            });
            dropdownView.on('execute', evt => {
                const { format } = evt.source as { format?: string };
                editor.execute(COMMAND_NAME, { format });
                editor.editing.view.focus();
            });

            return dropdownView;
        });
    }
}

/**
 * Inserts the current date and time, formatted by the host through `formatDateTime()`, in place of
 * the selection. The text takes the selection's attributes, so it stays bold inside bold text.
 */
class InsertDateTimeCommand extends Command {

    /**
     * @param options.format a Day.js format string; without one, the host applies the user's
     * `customDateTimeFormat`.
     */
    execute({ format }: { format?: string } = {}) {
        const model = this.editor.model;
        const selection = model.document.selection;
        const text = formatNow(this.editor, format);

        model.change(writer => {
            const attributes = selection.getAttributes();
            model.insertContent(writer.createText(text, attributes));
        });
    }

}

export interface DateTimePreset {
    format: string;
    kind: 'dateTime' | 'time';
}

/** A format the user can insert the date in, with the current date and time rendered in it. */
export interface DateTimeFormatOption {
    /** A Day.js format string, or `undefined` for the user's `customDateTimeFormat`. */
    format?: string;
    kind: DateTimePreset['kind'];
    preview: string;
}

/**
 * The user's default format followed by each of `DATE_TIME_PRESETS`, as the split button and the
 * `/` palette offer them. A preset whose preview matches an earlier one is left out.
 */
export function getDateTimeFormatOptions(editor: Editor): DateTimeFormatOption[] {
    const seenPreviews = new Set<string>();
    const options: DateTimeFormatOption[] = [];

    const formats: Omit<DateTimeFormatOption, 'preview'>[] = [ { kind: 'dateTime' }, ...DATE_TIME_PRESETS ];

    for (const { format, kind } of formats) {
        const preview = formatNow(editor, format);
        if (!seenPreviews.has(preview)) {
            seenPreviews.add(preview);
            options.push({ format, kind, preview });
        }
    }

    return options;
}

function createFormatItems(editor: Editor): ListDropdownItemDefinition[] {
    return getDateTimeFormatOptions(editor).map(({ format, preview }) => ({
        type: 'button',
        model: new ViewModel({ format, label: preview, withText: true })
    }));
}

function formatNow(editor: Editor, format?: string) {
    const editorEl = editor.editing.view.getDomRoot();
    return glob.getComponentByEl<EditorComponent>(editorEl).formatDateTime(new Date(), format);
}
