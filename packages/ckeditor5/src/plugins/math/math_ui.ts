import MathEditing from './math_editing.js';
import MainFormView from './main_form_view.js';
import mathIcon from '../../icons/math.svg?raw';
import { Plugin, ClickObserver, ButtonView, ContextualBalloon, clickOutsideHandler, CKEditorError, uid } from 'ckeditor5';
import { getBalloonPositionData } from './utils.js';
import MathCommand from './math_command.js';

const mathKeystroke = 'Ctrl+M';

export default class MathUI extends Plugin {
	public static get requires() {
		return [ ContextualBalloon, MathEditing ] as const;
	}

	public static get pluginName() {
		return 'MathUI' as const;
	}

	private _previewUid = `math-preview-${ uid() }`;
	private _balloon: ContextualBalloon = this.editor.plugins.get( ContextualBalloon );
	public formView: MainFormView | null = null;

	public init(): void {
		const editor = this.editor;
		editor.editing.view.addObserver( ClickObserver );

		this._createToolbarMathButton();

		this.formView = this._createFormView();

		this._enableUserBalloonInteractions();
	}

	public override destroy(): void {
		super.destroy();

		this.formView?.destroy();

		// Destroy preview element.
		/* v8 ignore start -- the preview lives inside the form view destroyed just above, so by
		   here it is already detached and getElementById finds nothing */
		const previewEl = document.getElementById( this._previewUid );
		if ( previewEl ) {
			previewEl.parentNode?.removeChild( previewEl );
		}
		/* v8 ignore stop */
	}

	public _showUI(): void {
		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );

		if ( !mathCommand?.isEnabled ) {
			return;
		}

		this._addFormView();

		this._balloon.showStack( 'main' );

		requestAnimationFrame( () => {
			this.formView?.mathInputView.focus();
		} );
	}

	private _createFormView() {
		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );
		/* v8 ignore next 7 -- defensive: MathEditing, which MathUI requires, always registers this command */
		if ( !( mathCommand instanceof MathCommand ) ) {
			/**
			 * Missing Math command
			 * @error math-command
			 */
			throw new CKEditorError( 'math-command' );
		}

		const mathConfig = editor.config.get( 'math' )!;

		const formView = new MainFormView(
			editor.locale,
			{
				engine: mathConfig.engine!,
				lazyLoad: mathConfig.lazyLoad,
				previewUid: this._previewUid,
				previewClassName: mathConfig.previewClassName!,
				katexRenderOptions: mathConfig.katexRenderOptions!
			},
			mathConfig.enablePreview,
			mathConfig.popupClassName!
		);

		formView.mathInputView.bind( 'value' ).to( mathCommand, 'value' );
		formView.displayButtonView.bind( 'isOn' ).to( mathCommand, 'display' );

		// Form elements should be read-only when corresponding commands are disabled.
		formView.mathInputView.bind( 'isReadOnly' ).to( mathCommand, 'isEnabled', ( value: boolean ) => !value );
		formView.saveButtonView.bind( 'isEnabled' ).to(
			mathCommand,
			'isEnabled',
			formView.mathInputView,
			'value',
			( commandEnabled, equation ) => {
				const normalizedEquation = ( equation ?? '' ).trim();
				return commandEnabled && normalizedEquation.length > 0;
			}
		);
		formView.displayButtonView.bind( 'isEnabled' ).to( mathCommand, 'isEnabled' );

		// Listen to submit button click
		this.listenTo( formView, 'submit', () => {
			editor.execute( 'math', formView.equation, formView.displayButtonView.isOn, mathConfig.outputType, mathConfig.forceOutputType );
			this._closeFormView();
		} );

		// Listen to cancel button click
		this.listenTo( formView, 'cancel', () => {
			this._closeFormView();
		} );

		// Close plugin ui, if esc is pressed (while ui is focused)
		formView.keystrokes.set( 'esc', ( _data, cancel ) => {
			this._closeFormView();
			cancel();
		} );

		// Allow pressing Enter to submit changes, and use Shift+Enter to insert a new line
		formView.keystrokes.set( 'enter', ( data, cancel ) => {
			/* v8 ignore next -- Shift+Enter is a distinct keystroke that never routes to the
			   'enter' handler, so shiftKey is always false by the time this runs */
			if ( !data.shiftKey ) {
				formView.fire( 'submit' );
				cancel();
			}
		} );

		return formView;
	}

	private _addFormView() {
		if ( this._isFormInPanel ) {
			return;
		}

		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );
		/* v8 ignore next 7 -- defensive: MathEditing always registers this command */
		if ( !( mathCommand instanceof MathCommand ) ) {
			/**
			* Math command not found
			* @error plugin-load
					*/
			throw new CKEditorError( 'plugin-load', { pluginName: 'math' } );
		}

		/* v8 ignore next 3 -- defensive: the form view is built in init() before any show */
		if ( this.formView == null ) {
			return;
		}

		this._balloon.add( {
			view: this.formView,
			position: getBalloonPositionData( editor )
		} );

		if ( this._balloon.visibleView === this.formView ) {
			this.formView.mathInputView.focus();
		}

		const previewEl = document.getElementById( this._previewUid );
		if ( previewEl && this.formView.mathView ) {
			this.formView.mathView.updateMath();
		}

		// Push the current command state into the form. This looks redundant with the bindings set
		// up in _createFormView(), but is not: MathInputView writes its own `value` whenever the
		// MathLive field or the LaTeX textarea changes, and writing a bound property directly
		// severs the binding. From the first edit onward this assignment is what repopulates the
		// form when the dialog is reopened.
		this.formView.equation = mathCommand.value ?? '';
		this.formView.displayButtonView.isOn = mathCommand.display || false;
	}

	/**
	 * @private
	 */
	public _hideUI(): void {
		if ( !this._isFormInPanel ) {
			return;
		}

		const editor = this.editor;

		this.stopListening( editor.ui, 'update' );
		this.stopListening( this._balloon, 'change:visibleView' );

		editor.editing.view.focus();

		// Remove form first because it's on top of the stack.
		this._removeFormView();
	}

	private _closeFormView() {
		const mathCommand = this.editor.commands.get( 'math' );
		if ( mathCommand?.value != null ) {
			this._removeFormView();
		} else {
			this._hideUI();
		}
	}

	private _removeFormView() {
		if ( this._isFormInPanel && this.formView ) {
			// Hide virtual keyboard before removing the form
			this.formView.hideKeyboard();

			this.formView.saveButtonView.focus();
			this._balloon.remove( this.formView );

			// Hide preview element.
			/* v8 ignore start -- dead in this order: the preview lives inside the form view, so
			   the balloon.remove() above already detached it and getElementById finds nothing */
			const previewEl = document.getElementById( this._previewUid );
			if ( previewEl ) {
				previewEl.style.visibility = 'hidden';
			}
			/* v8 ignore stop */

			this.editor.editing.view.focus();
		}
	}

	private _createToolbarMathButton() {
		const editor = this.editor;
		const mathCommand = editor.commands.get( 'math' );
		/* v8 ignore next 7 -- defensive: MathEditing always registers this command */
		if ( !mathCommand ) {
			/**
			* Math command not found
			* @error plugin-load
					*/
			throw new CKEditorError( 'plugin-load', { pluginName: 'math' } );
		}
		const t = editor.t;

		// Handle the `Ctrl+M` keystroke and show the panel.
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

	private _enableUserBalloonInteractions() {
		const editor = this.editor;
		const viewDocument = this.editor.editing.view.document;
		this.listenTo( viewDocument, 'click', () => {
			const mathCommand = editor.commands.get( 'math' );
			if ( mathCommand?.isEnabled && mathCommand.value ) {
				this._showUI();
			}
		} );

		// Close the panel on the Esc key press when the editable has focus and the balloon is visible.
		editor.keystrokes.set( 'Esc', ( _data, cancel ) => {
			if ( this._isUIVisible ) {
				this._hideUI();
				cancel();
			}
		} );

		// Close on click outside of balloon panel element.
		/* v8 ignore start -- defensive: init() builds the form view before wiring interactions */
		if ( this.formView ) {
			clickOutsideHandler( {
				emitter: this.formView,
				activator: () => !!this._isFormInPanel,
				/* v8 ignore next -- defensive: the balloon view is rendered by the time init() runs */
				contextElements: this._balloon.view.element ? [ this._balloon.view.element ] : [],
				callback: () => { this._hideUI(); }
			} );
		} else {
			throw new Error( 'missing form view' );
		}
		/* v8 ignore stop */
	}

	private get _isUIVisible() {
		const visibleView = this._balloon.visibleView;

		return visibleView == this.formView;
	}

	private get _isFormInPanel() {
		return this.formView && this._balloon.hasView( this.formView );
	}
}
