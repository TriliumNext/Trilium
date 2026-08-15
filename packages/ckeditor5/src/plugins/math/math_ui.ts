import MathEditing from './math_editing.js';
import MathLiveEdit from './math_live_edit.js';
import mathIcon from '../../icons/math.svg?raw';
import { Plugin, ButtonView } from 'ckeditor5';

const mathKeystroke = 'Ctrl+M';

export default class MathUI extends Plugin {
	public static get requires() {
		return [ MathEditing, MathLiveEdit ] as const;
	}

	public static get pluginName() {
		return 'MathUI' as const;
	}

	public init(): void {
		this._createToolbarMathButton();
	}

	/**
	 * Starts in-place MathLive editing: on the selected equation, or on a freshly inserted one.
	 * Kept under the historical name — {@link AutoformatMath} calls it after `$$`.
	 */
	public _showUI(): void {
		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );

		if ( !mathCommand?.isEnabled ) {
			return;
		}

		editor.plugins.get( MathLiveEdit ).startEditing( { display: mathCommand.display } );
	}

	private _createToolbarMathButton() {
		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );
		/* v8 ignore next 3 -- defensive: MathEditing always registers this command */
		if ( !mathCommand ) {
			return;
		}
		const t = editor.t;

		// Handle the `Ctrl+M` keystroke and start editing.
		editor.keystrokes.set( mathKeystroke, ( _keyEvtData, cancel ) => {
			// Prevent focusing the search bar in FF and opening new tab in Edge. #153, #154.
			cancel();

			if ( mathCommand.isEnabled ) {
				this._showUI();
			}
		} );

		this.editor.ui.componentFactory.add( 'math', locale => {
			const button = new ButtonView( locale );

			button.isEnabled = true;
			button.label = t( 'Insert math' );
			button.icon = mathIcon;
			button.keystroke = mathKeystroke;
			button.tooltip = true;
			button.isToggleable = true;

			button.bind( 'isEnabled' ).to( mathCommand, 'isEnabled' );

			this.listenTo( button, 'execute', () => {
				this._showUI();
			} );

			return button;
		} );
	}
}
