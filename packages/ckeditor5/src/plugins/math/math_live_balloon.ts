// A balloon anchored to the equation currently being edited. It exists only while a MathLive
// field is mounted: {@link MathLiveEdit} announces the session, and the balloon follows the
// field it is pinned to. It hosts the actions that belong to the equation itself, which would
// otherwise be reachable only through MathLive's built-in corner menu — hidden by our theme.
import {
	addListToDropdown,
	ButtonView,
	Collection,
	ContextualBalloon,
	createDropdown,
	type DropdownView,
	IconObjectCenter,
	IconObjectInline,
	IconPlus,
	IconTable,
	IconTableCellProperties,
	IconTableColumn,
	IconTableRow,
	_InsertTableView,
	type ListDropdownButtonDefinition,
	ListItemView,
	ListItemGroupView,
	ListView,
	Plugin,
	ToolbarView,
	ViewModel
} from 'ckeditor5';
import MathLiveLabelView from './mathlive_label_view.js';
import MathLiveEdit, {
	type MathLiveSessionEndEvent,
	type MathLiveSessionStartEvent
} from './math_live_edit.js';
import {
	getMenuItemLabel,
	getMenuItemState,
	MENU_ITEM_UNAVAILABLE,
	type MathLiveMenuItemId,
	type MathLiveMenuField,
	getSubmenuEntries,
	runMenuItem
} from './mathlive_menu.js';

/** The commands the balloon's type toggles run; both are registered by `MathEditing`. */
type MathTypeCommandName = 'mathTypeInline' | 'mathTypeDisplay';

/** The tabular environments the borders group switches an array between. */
type MatrixEnvironment = 'matrix' | 'pmatrix' | 'bmatrix' | 'vmatrix' | 'Bmatrix';

/** A MathLive command, run on the live field; the array form carries the command's arguments. */
type MatrixCommand =
	| 'addRowBefore'
	| 'addRowAfter'
	| 'addColumnBefore'
	| 'addColumnAfter'
	| 'removeRow'
	| 'removeColumn'
	| [ 'setEnvironment', MatrixEnvironment ];

/** One entry of a matrix dropdown, and the MathLive menu item whose state it follows. */
interface MenuAction {
	id: MathLiveMenuItemId;
	command: MatrixCommand;

	/**
	 * Left out where CKEditor has no wording of its own to reuse: the entry then shows MathLive's
	 * own label, which for the borders is the bracket it draws around a `⋱`.
	 */
	label?: string;
}

/** A dropdown and the entries of its list, so both can follow the caret. */
interface MenuGroup {
	dropdown: DropdownView;
	items: Array<MenuGroupEntry>;

	/** Set on a group laid out from a MathLive submenu, which needs a field before it can be. */
	submenu?: { id: MathLiveMenuItemId; list: ListView };
}

interface MenuGroupEntry {
	/** The list's own model where CKEditor builds it, the button itself where we do. */
	target: MenuBoundTarget;
	id: MathLiveMenuItemId;

	/** Whether the entry was given wording of ours, rather than taking MathLive's. */
	ownLabel: boolean;
}

/** The little of `ViewModel`/`ButtonView` a group entry is driven through. */
interface MenuBoundTarget {
	label?: string | undefined;
	set( values: object ): void;
	set( name: string, value: unknown ): void;
}

/** The live field, seen as the two things the balloon asks of it. */
type LiveMathField = HTMLElement & MathLiveMenuField & {
	executeCommand?: ( command: MatrixCommand ) => boolean;
};

export default class MathLiveBalloon extends Plugin {
	public static get requires() {
		return [ ContextualBalloon, MathLiveEdit ] as const;
	}

	public static get pluginName() {
		return 'MathLiveBalloon' as const;
	}

	private _view: ToolbarView | null = null;

	/** The field of the running session, and the listeners tying the matrix groups to it. */
	private _mathfield: LiveMathField | null = null;
	private _fieldListeners: AbortController | null = null;
	private _resizeObserver: ResizeObserver | null = null;

	private readonly _menuGroups: Array<MenuGroup> = [];

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
		this._releaseField();
		this._view?.destroy();
	}

	private _show( mathfield: HTMLElement ): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		const view = this._getView();

		this._trackField( mathfield as LiveMathField );

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

		this._releaseField();

		/* v8 ignore next 3 -- `sessionEnd` only follows a `sessionStart`, which always adds the
		   view to the balloon */
		if ( !view || !balloon.hasView( view ) ) {
			return;
		}

		balloon.remove( view );
	}

	/**
	 * Follows the field for as long as the session lasts. Which matrix actions apply depends on
	 * where the caret is, so the groups are refreshed on every move and every edit.
	 */
	private _trackField( mathfield: LiveMathField ): void {
		this._releaseField();

		this._mathfield = mathfield;
		this._fieldListeners = new AbortController();

		const refresh = () => this._refreshMenuGroups();
		const options = { signal: this._fieldListeners.signal };
		mathfield.addEventListener( 'selection-change', refresh, options );
		mathfield.addEventListener( 'input', refresh, options );

		// The balloon repositions itself only on window resize, scroll and editor UI updates.
		// A field growing while the user types fires none of them — MathLive renders inside its
		// own shadow root, invisible to the editor — so follow the field's size directly.
		// Deferred a frame: repositioning straight from the observer callback makes the browser
		// report the benign "ResizeObserver loop completed with undelivered notifications".
		this._resizeObserver = new ResizeObserver( () => {
			requestAnimationFrame( () => this._updateBalloonPosition() );
		} );
		this._resizeObserver.observe( mathfield );

		this._refreshMenuGroups();
	}

	private _releaseField(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;
		this._fieldListeners?.abort();
		this._fieldListeners = null;
		this._mathfield = null;
		this._refreshMenuGroups();
	}

	private _updateBalloonPosition(): void {
		const balloon = this.editor.plugins.get( ContextualBalloon );
		// Only while ours is the visible view — updatePosition() pins using the top of the
		// stack, so calling it under someone else's view would move their balloon around.
		if ( this._view && balloon.visibleView === this._view ) {
			balloon.updatePosition();
		}
	}

	/** Hides each entry MathLive would hide, and each group whose entries all went. */
	private _refreshMenuGroups(): void {
		for ( const group of this._menuGroups ) {
			let anyVisible = false;

			// A group read from a submenu has nothing in it until a field turns up to read.
			this._buildSubmenuGroup( group );

			for ( const item of group.items ) {
				const state = this._mathfield ?
					getMenuItemState( this._mathfield, item.id ) :
					MENU_ITEM_UNAVAILABLE;

				item.target.set( { isVisible: state.visible, isEnabled: state.enabled } );
				anyVisible ||= state.visible;

				// An entry with no wording of ours takes MathLive's, which is only there to be
				// read once a field is mounted. Read once and kept: resolving an insert label
				// runs `convertLatexToMarkup()`, too much to repeat for thirteen entries on
				// every keystroke. The labels that redraw themselves around the current
				// selection — the accents — will need this to become conditional.
				if ( !item.ownLabel && !item.target.label && this._mathfield ) {
					const label = getMenuItemLabel( this._mathfield, item.id );
					if ( label !== null ) {
						item.target.set( 'label', label );
					}
				}
			}

			// `DropdownView` has no `isVisible` of its own, so the group goes out the way the
			// other dropdowns in this package hide themselves.
			group.dropdown.class = anyVisible ? undefined : 'ck-hidden';
		}
	}

	private _runFieldCommand( command: MatrixCommand ): void {
		const mathfield = this._mathfield;
		/* v8 ignore next 3 -- the entry is only reachable while a field is being tracked */
		if ( !mathfield?.executeCommand ) {
			return;
		}

		mathfield.executeCommand( command );
		// The command moved the caret into the new row or column; keep typing going there.
		mathfield.focus();
		this._refreshMenuGroups();
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
		toolbar.items.add( this._createInsertGroup( t( 'Insert' ) ) );
		toolbar.items.add( this._createInsertMatrixDropdown( t( 'Insert matrix' ) ) );

		// Column before row, and the same wording, as the table feature's own pair of dropdowns.
		// Both stay out of the way until the caret is inside a matrix.
		const isContentLtr = editor.locale.contentLanguageDirection === 'ltr';
		toolbar.items.add( this._createMenuGroup( t( 'Column' ), IconTableColumn, [
			{
				id: 'add-column-before',
				command: 'addColumnBefore',
				label: isContentLtr ? t( 'Insert column left' ) : t( 'Insert column right' )
			},
			{
				id: 'add-column-after',
				command: 'addColumnAfter',
				label: isContentLtr ? t( 'Insert column right' ) : t( 'Insert column left' )
			},
			{ id: 'delete-column', command: 'removeColumn', label: t( 'Delete column' ) }
		] ) );
		toolbar.items.add( this._createMenuGroup( t( 'Row' ), IconTableRow, [
			{ id: 'add-row-above', command: 'addRowBefore', label: t( 'Insert row above' ) },
			{ id: 'add-row-below', command: 'addRowAfter', label: t( 'Insert row below' ) },
			{ id: 'delete-row', command: 'removeRow', label: t( 'Delete row' ) }
		] ) );

		// The brackets around the array. No labels of ours: MathLive draws each option as the
		// bracket it stands for, wrapped around a `⋱`, which says it better than words would.
		toolbar.items.add( this._createMenuGroup( t( 'Borders' ), IconTableCellProperties, [
			{ id: 'environment-no-border', command: [ 'setEnvironment', 'matrix' ] },
			{ id: 'environment-parentheses', command: [ 'setEnvironment', 'pmatrix' ] },
			{ id: 'environment-brackets', command: [ 'setEnvironment', 'bmatrix' ] },
			{ id: 'environment-bar', command: [ 'setEnvironment', 'vmatrix' ] },
			{ id: 'environment-braces', command: [ 'setEnvironment', 'Bmatrix' ] }
		] ) );

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
	 * The structures MathLive knows how to insert — an absolute value, an integral, a conjugate —
	 * each drawn as itself. The entries are built by hand rather than through
	 * `addListToDropdown()`: their labels are MathLive's rendered markup, and the list views
	 * CKEditor builds from definitions show a label as text.
	 *
	 * The LaTeX behind each lives only inside the declaration's own handler, so unlike the other
	 * groups these run through it rather than through a documented command.
	 */
	private _createInsertGroup( label: string ): DropdownView {
		const locale = this.editor.locale;
		const dropdown = createDropdown( locale );
		const list = new ListView( locale );

		dropdown.buttonView.set( { label, icon: IconPlus, tooltip: true } );
		dropdown.panelView.children.add( list );

		// Filled in from the field's own menu, once there is a field to read it from.
		this._menuGroups.push( { dropdown, items: [], submenu: { id: 'insert', list } } );
		return dropdown;
	}

	/**
	 * Lays the entries of a MathLive submenu out as a list: its sections become labelled groups,
	 * its captions their labels, and each entry a button drawing MathLive's own markup. Read once
	 * — the shape and the previews are the same for as long as the locale is.
	 */
	private _buildSubmenuGroup( group: MenuGroup ): void {
		const mathfield = this._mathfield;
		const submenu = group.submenu;

		if ( !mathfield || !submenu || group.items.length ) {
			return;
		}

		const locale = this.editor.locale;
		let section: ListView | ListItemGroupView = submenu.list;

		for ( const entry of getSubmenuEntries( mathfield, submenu.id ) ) {
			if ( entry.isHeading ) {
				section = new ListItemGroupView( locale );
				section.label = entry.label ?? '';
				submenu.list.items.add( section );
				continue;
			}

			/* v8 ignore next 3 -- every non-heading entry of these submenus carries an id */
			if ( !entry.id ) {
				continue;
			}

			const id = entry.id as MathLiveMenuItemId;
			const button = new ButtonView( locale, new MathLiveLabelView( locale ) );

			button.set( { withText: true, label: entry.label ?? '', isVisible: false, isEnabled: false } );
			button.on( 'execute', () => this._runMenuItem( id ) );
			// Closing the dropdown is the default behaviour of an `execute` it can hear, and a
			// button nested in a group would not reach it on its own.
			button.delegate( 'execute' ).to( group.dropdown );

			const listItem = new ListItemView( locale );
			listItem.children.add( button );
			listItem.bind( 'isVisible' ).to( button, 'isVisible' );
			section.items.add( listItem );

			// The label came with the entry, so the refresh has only its state left to follow.
			group.items.push( { target: button, id, ownLabel: true } );
		}
	}

	private _runMenuItem( id: MathLiveMenuItemId ): void {
		const mathfield = this._mathfield;
		/* v8 ignore next 3 -- the entry is only reachable while a field is being tracked */
		if ( !mathfield ) {
			return;
		}

		runMenuItem( mathfield, id );
		// The insert leaves the caret in the structure's first placeholder; keep typing there.
		mathfield.focus();
		this._refreshMenuGroups();
	}

	/**
	 * One of the matrix groups — a dropdown listing what can be done to a column, to a row, or to
	 * the brackets around the whole thing, in the shape the table feature gives its own
	 * `tableColumn`/`tableRow` dropdowns. Every entry follows the MathLive menu item of the same
	 * name, so an action that does not apply where the caret is disappears rather than sitting
	 * there dead.
	 */
	private _createMenuGroup( label: string, icon: string, actions: Array<MenuAction> ): DropdownView {
		const dropdown = createDropdown( this.editor.locale );
		const definitions = new Collection<ListDropdownButtonDefinition>();
		const items: MenuGroup['items'] = [];

		dropdown.buttonView.set( { label, icon, tooltip: true } );

		for ( const action of actions ) {
			const model = new ViewModel( {
				label: action.label ?? '',
				withText: true,
				isVisible: false,
				isEnabled: false,
				_matrixCommand: action.command
			} );

			definitions.add( { type: 'button', model } );
			items.push( { target: model, id: action.id, ownLabel: action.label !== undefined } );
		}

		addListToDropdown( dropdown, definitions );

		dropdown.on( 'execute', evt => {
			const command = ( evt.source as { _matrixCommand?: MatrixCommand } )._matrixCommand;
			/* v8 ignore next 3 -- every entry of this list carries a command */
			if ( !command ) {
				return;
			}
			this._runFieldCommand( command );
		} );

		this._menuGroups.push( { dropdown, items } );
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
