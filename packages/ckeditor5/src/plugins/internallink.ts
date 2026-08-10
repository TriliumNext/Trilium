import { ButtonView, Command, Plugin } from 'ckeditor5';
import internalLinkIcon from '../icons/trilium.svg?raw';
import ReferenceLink from './referencelink';

export const COMMAND_NAME = 'insertInternalLink';

export default class InternalLinkPlugin extends Plugin {

    static get requires() {
        return [ ReferenceLink ];
    }

	init() {
		const editor = this.editor;
		const t = editor.t;

        editor.commands.add(COMMAND_NAME, new InsertInternalLinkCommand(editor));

		editor.ui.componentFactory.add('internalLink', locale => {
			const view = new ButtonView( locale );

			// The shortcut is a `keystroke` rather than part of the label, so CKEditor appends it to
			// the tooltip itself — rendered as ⌘L on macOS, where the binding really is
			// `CommandOrControl+L`, and left out of the string translators see.
			view.set( {
				label: t('Internal link'),
				icon: internalLinkIcon,
				keystroke: 'CTRL+L',
				tooltip: true
			} );

            // enable internal link only if the editor is not read only
			const command = editor.commands.get(COMMAND_NAME)!;
            view.bind('isEnabled').to(command, 'isEnabled');
			view.on('execute', () => {
                editor.execute(COMMAND_NAME);
			} );

			return view;
		});
	}
}

class InsertInternalLinkCommand extends Command {

    refresh() {
        const selection = this.editor.model.document.selection;
        const position = selection.getFirstPosition();
        const isInCodeBlock = position?.findAncestor("codeBlock");

        this.isEnabled = !this.editor.isReadOnly && !isInCodeBlock;
    }

    execute() {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl(editorEl);

        component.triggerCommand('addLinkToText');
    }
}
