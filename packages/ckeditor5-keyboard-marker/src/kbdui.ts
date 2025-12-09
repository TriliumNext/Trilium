import { AttributeCommand, ButtonView, Plugin } from 'ckeditor5';
import kbdIcon from '../theme/icons/kbd.svg?raw';

const KBD = 'kbd';

/**
 * The keyboard shortcut UI feature. It brings a proper button.
 */
export default class KbdUI extends Plugin {

	public static get pluginName() {
		return 'KbdUI' as const;
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const t = editor.t;

		editor.ui.componentFactory.add( KBD, locale => {
			const command = editor.commands.get( KBD ) as AttributeCommand;
			const view = new ButtonView( locale );

			view.set( {
				label: t( 'Keyboard shortcut' ),
				icon: kbdIcon,
				keystroke: 'CTRL+ALT+K',
				tooltip: true,
				isToggleable: true
			} );

			view.bind( 'isOn', 'isEnabled' ).to( command, 'value', 'isEnabled' );

			// Execute command.
			this.listenTo( view, 'execute', () => {
				editor.execute( KBD );
				editor.editing.view.focus();
			} );

			return view;
		} );
	}
}
