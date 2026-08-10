import { ButtonView, Command, Plugin } from 'ckeditor5';
import dateTimeIcon from '../icons/date-time.svg?raw';

export const COMMAND_NAME = 'insertDateTimeToText';

export default class InsertDateTimePlugin extends Plugin {
    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.commands.add(COMMAND_NAME, new InsertDateTimeCommand(editor));

        editor.ui.componentFactory.add('dateTime', locale => {
            const view = new ButtonView( locale );

            view.set( {
                label: t('Insert date/time'),
                icon: dateTimeIcon,
                tooltip: true
            } );

            // enable only if the editor is not read only
            const command = editor.commands.get(COMMAND_NAME)!;
            view.bind('isEnabled').to(command, 'isEnabled');
            view.on('execute', () => {
                editor.execute(COMMAND_NAME);
                editor.editing.view.focus();
            });
            return view;
        });
    }
}

class InsertDateTimeCommand extends Command {

    refresh() {
        this.isEnabled = !this.editor.isReadOnly;
    }

    execute() {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl(editorEl);

        component.triggerCommand('insertDateTimeToText');
        editor.editing.view.focus();
    }

}
