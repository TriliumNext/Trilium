import { ButtonView, Command, Plugin } from 'ckeditor5';
import markdownIcon from '../icons/markdown-mark.svg?raw';

export const COMMAND_NAME = 'importMarkdownInline';

export default class MarkdownImportPlugin extends Plugin {
	init() {
		const editor = this.editor;

        editor.commands.add(COMMAND_NAME, new ImportMarkdownCommand(editor));

		editor.ui.componentFactory.add( 'markdownImport', locale => {
			const view = new ButtonView( locale );

			view.set( {
				label: 'Markdown import from clipboard',
				icon: markdownIcon,
				tooltip: true
			} );

			// Callback executed once the image is clicked.
            const command = editor.commands.get(COMMAND_NAME)!;
			view.bind('isEnabled').to(command, 'isEnabled');
            view.on('execute', () => editor.execute(COMMAND_NAME));

			return view;
		} );
	}
}

class ImportMarkdownCommand extends Command {

    execute() {
		const editorEl = this.editor.editing.view.getDomRoot();
		const component = glob.getComponentByEl(editorEl);

		component.triggerCommand('pasteMarkdownIntoText');
    }

}
