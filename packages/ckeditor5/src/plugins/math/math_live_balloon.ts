// A balloon anchored to the equation currently being edited. It exists only while a MathLive
// field is mounted: {@link MathLiveEdit} announces the session, and the balloon follows the
// field it is pinned to. It hosts the actions that belong to the equation itself, which would
// otherwise be reachable only through MathLive's built-in corner menu — hidden by our theme.
import {
	ButtonView,
	ContextualBalloon,
	createDropdown,
	type DropdownView,
	IconObjectCenter,
	IconObjectInline,
	IconTable,
	_InsertTableView,
	Plugin,
	ToolbarView
} from 'ckeditor5';
import MathLiveEdit, {
	type MathLiveSessionEndEvent,
	type MathLiveSessionStartEvent
} from './math_live_edit.js';

/** The commands the balloon's type toggles run; both are registered by `MathEditing`. */
type MathTypeCommandName = 'mathTypeInline' | 'mathTypeDisplay';

export default class MathLiveBalloon extends Plugin {
	public static get requires() {
		return [ ContextualBalloon, MathLiveEdit ] as const;
	}

	public static get pluginName() {
		return 'MathLiveBalloon' as const;
	}

	private _view: ToolbarView | null = null;

	public init(): void {
		const mathLiveEdit = this.editor.plugins.get( MathLiveEdit );

		this.listenTo<MathLiveSessionStartEvent>( mathLiveEdit, 'sessionStart', ( _evt, { mathfield } ) => {
			this._show( mathfield );
		} );

		this.listenTo<MathLiveSessionEndEvent>( mathLiveEdit, 'sessionEnd', () => {
			this._hide();
		} );
	}

	public override destroy(): void {
		super.destroy();
		this._view?.destroy();
	}

	private _show( mathfield: HTMLElement ): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		const view = this._getView();

		/* v8 ignore next 3 -- a second `sessionStart` without an intervening `sessionEnd` cannot
		   happen: MathLiveEdit commits the previous session before mounting a new field */
		if ( balloon.hasView( view ) ) {
			return;
		}

		// Pinned to the field rather than to the widget, so the balloon tracks the equation as
		// it grows while typing. `ck-toolbar-container` drops the panel's own padding, the way
		// every widget toolbar does.
		balloon.add( {
			view,
			position: { target: mathfield },
			balloonClassName: 'ck-toolbar-container'
		} );
	}

	private _hide(): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		const view = this._view;

		/* v8 ignore next 3 -- `sessionEnd` only follows a `sessionStart`, which always adds the
		   view to the balloon */
		if ( !view || !balloon.hasView( view ) ) {
			return;
		}

		balloon.remove( view );
	}

	private _getView(): ToolbarView {
		if ( this._view ) {
			return this._view;
		}

		const editor = this.editor;
		const t = editor.t;
		const toolbar = new ToolbarView( editor.locale );

		toolbar.class = 'ck-math-live-balloon';
		toolbar.ariaLabel = t( 'Equation toolbar' );
		toolbar.items.add( this._createTypeButton( 'mathTypeInline', IconObjectInline, t( 'Inline equation' ) ) );
		toolbar.items.add( this._createTypeButton( 'mathTypeDisplay', IconObjectCenter, t( 'Display equation' ) ) );
		toolbar.items.add( this._createInsertMatrixDropdown( t( 'Insert matrix' ) ) );

		// A click landing on the toolbar's own padding rather than on a button would otherwise
		// blur the field, committing the equation and taking the balloon down with it. The
		// buttons cover themselves — `ButtonView` swallows `mousedown` already.
		toolbar.extendTemplate( {
			on: {
				mousedown: toolbar.bindTemplate.to( ( evt: Event ) => evt.preventDefault() )
			}
		} );

		this._view = toolbar;
		return toolbar;
	}

	/**
	 * The matrix picker: CKEditor's own insert-table grid, hosted in a dropdown exactly as the
	 * table feature hosts it. Picking a size types a `pmatrix` of MathLive placeholders into the
	 * field, which is what MathLive's built-in matrix menu does too.
	 */
	private _createInsertMatrixDropdown( label: string ): DropdownView {
		const editor = this.editor;
		const dropdown = createDropdown( editor.locale );

		dropdown.buttonView.set( { label, icon: IconTable, tooltip: true } );

		// Built on first open, like the table feature's — the grid is 100 buttons.
		let gridView: _InsertTableView | null = null;

		dropdown.on( 'change:isOpen', () => {
			if ( !gridView ) {
				gridView = new _InsertTableView( editor.locale );
				dropdown.panelView.children.add( gridView );
				gridView.delegate( 'execute' ).to( dropdown );

				dropdown.on( 'execute', () => {
					/* v8 ignore next 3 -- the handler is only registered once the grid exists */
					if ( !gridView ) {
						return;
					}
					editor.plugins.get( MathLiveEdit )
						.insertIntoField( buildMatrixLatex( gridView.rows, gridView.columns ) );
				} );
			}

			// Cleared on the way in, never on the way out: picking a size fires `execute`, which
			// `createDropdown`'s own `closeDropdownOnExecute` turns into `isOpen = false` before
			// our `execute` handler gets to read the grid. Resetting here would hand it 1 × 1
			// every time.
			if ( dropdown.isOpen ) {
				gridView.reset();
			}
		} );

		return dropdown;
	}

	/**
	 * A toggle for one of the two equation forms, lit when the equation is already in it. The
	 * pair mirrors the image feature's inline/centered style buttons, icons included.
	 */
	private _createTypeButton( commandName: MathTypeCommandName, icon: string, label: string ): ButtonView {
		const editor = this.editor;
		const command = editor.commands.get( commandName );
		const button = new ButtonView( editor.locale );

		button.set( { label, icon, tooltip: true, isToggleable: true } );

		/* v8 ignore next 4 -- MathEditing registers both commands, and MathLiveEdit requires it */
		if ( command ) {
			button.bind( 'isEnabled' ).to( command, 'isEnabled' );
			button.bind( 'isOn' ).to( command, 'value' );
		}

		this.listenTo( button, 'execute', () => {
			// Converting replaces the model element, so the mounted field is pulled out from
			// under the session. The command leaves the selection on the new equation; re-enter
			// it, and the edit carries on where it left off.
			const newElement = editor.execute( commandName );
			if ( newElement ) {
				editor.plugins.get( MathLiveEdit ).startEditing();
			}
		} );

		return button;
	}
}

/**
 * A parenthesised matrix of that size, every cell a MathLive placeholder so the caret lands in
 * the first one and `Tab` walks the rest. The same LaTeX MathLive's own "Insert matrix" menu
 * produces.
 */
export function buildMatrixLatex( rows: number, columns: number ): string {
	const row = Array( columns ).fill( '#?' ).join( ' & ' );
	return `\\begin{pmatrix}${ Array( rows ).fill( row ).join( '\\\\' ) }\\end{pmatrix}`;
}
