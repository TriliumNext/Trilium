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
	IconFontBackground,
	IconFontColor,
	IconFontFamily,
	IconMarker,
	IconObjectCenter,
	IconObjectInline,
	IconPlus,
	IconSpecialCharacters,
	IconTable,
	IconTableCellProperties,
	IconTableColumn,
	IconTableRow,
	IconText,
	_InsertTableView,
	type ListDropdownButtonDefinition,
	ListItemButtonView,
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
import { renderMathMarkup } from './mathlive_loader.js';
import { MATH_SYMBOL_SECTIONS, type MathSymbolSectionId } from './symbols.js';

/** How a group arranges its entries: stacked when unset, or as a set of one of these. */
type MenuGroupLayout = 'row' | 'grid' | 'swatches';

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

/**
 * An entry of ours slotted into a group MathLive builds, described the way MathLive describes its
 * own: it draws what it would do, and it applies only where doing it makes sense. These exist
 * because MathLive's menu stops short of things the equivalent OneNote gallery has — there is no
 * `\hat` or `\tilde` among its accents, and no piecewise or binomial among its structures.
 */
interface LocalMenuEntry {
	/** Typed into the field; `#@` stands for the selection, `#?` for a placeholder to fill in. */
	insert: string;

	/**
	 * Rendered as the entry's label, with `#@` replaced by whatever is selected — so an accent
	 * previews itself around the very letter it would mark, as MathLive's own accents do.
	 */
	preview: string;

	/** What the entry is called: its tooltip, and its wording where the group names its entries. */
	label: string;

	/** How much of a selection it needs to apply: a single atom to sit on, or any selection. */
	selection?: 'one' | 'any';
}

/** A local entry once built, paired with the button standing in for it. */
interface LocalMenuGroupEntry {
	entry: LocalMenuEntry;
	button: ListItemButtonView;
}

/** A dropdown and the entries of its list, so both can follow the caret. */
interface MenuGroup {
	dropdown: DropdownView;
	items: Array<MenuGroupEntry>;

	/** The entries of ours in the same list, which follow the caret by their own rules. */
	locals: Array<LocalMenuGroupEntry>;

	/** Set on a group laid out from a MathLive submenu, which needs a field before it can be. */
	submenu?: {
		id: MathLiveMenuItemId;
		list: ListView;

		/** Ours to add to the group, each keyed by the MathLive entry it follows. */
		extras?: Partial<Record<MathLiveMenuItemId, readonly LocalMenuEntry[]>>;

		/** Whether its entries draw the current selection, and so are worth re-reading. */
		liveLabels?: boolean;

		/** What a checkable entry of this group is: one of several, or one of a set of one. */
		checkableRole?: 'menuitemcheckbox' | 'menuitemradio';

		/** Whether the dropdown reads back the entry in force rather than naming itself. */
		showsCurrent?: boolean;

		/** How its entries are laid out, which decides how one in force is marked. */
		layout?: MenuGroupLayout;
	};
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

/** The live field, seen as the few things the balloon asks of it. */
type LiveMathField = HTMLElement & MathLiveMenuField & {
	executeCommand?: ( command: MatrixCommand ) => boolean;

	/** What is selected, and how to read it back — MathLive's own `Selection` and `getValue()`. */
	selection?: unknown;
	getValue?: ( selection?: unknown, format?: string ) => string;
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
			let current: string | undefined;

			// A group read from a submenu has nothing in it until a field turns up to read.
			this._buildSubmenuGroup( group );

			for ( const item of group.items ) {
				const state = this._mathfield ?
					getMenuItemState( this._mathfield, item.id ) :
					MENU_ITEM_UNAVAILABLE;

				// `'mixed'`, where only part of the selection carries the style, reads as on:
				// pressing the entry then sets it for the rest, which is what MathLive does.
				item.target.set( {
					isVisible: state.visible,
					isEnabled: state.enabled,
					isOn: state.checked !== false
				} );
				anyVisible ||= state.visible;
				if ( state.checked !== false ) {
					current = item.target.label;
				}

				// An entry with no wording of ours takes MathLive's, which is only there to be
				// read once a field is mounted. Read once and kept, unless the group draws its
				// entries around the current selection — resolving a label runs
				// `convertLatexToMarkup()`, too much to repeat for a whole group on every
				// keystroke when the result would be the same markup every time.
				const stale = group.submenu?.liveLabels || !item.target.label;
				if ( !item.ownLabel && stale && this._mathfield ) {
					const label = getMenuItemLabel( this._mathfield, item.id );
					if ( label !== null ) {
						item.target.set( 'label', label );
					}
				}
			}

			// Our own entries in the same list. MathLive has no opinion on these, so they answer
			// the one question it would have asked — is there something here to act on — for
			// themselves, and redraw around the selection the way the group's other entries do.
			if ( group.locals.length ) {
				const selection = this._mathfield ? readSelection( this._mathfield ) : null;

				for ( const local of group.locals ) {
					const visible = selection !== null && appliesToSelection( local.entry, selection );

					local.button.set( { isVisible: visible, isEnabled: visible } );
					anyVisible ||= visible;

					// Redrawn only where the drawing can have changed — an entry built around the
					// selection — for the reason the MathLive entries above are: rendering a
					// preview is a `convertLatexToMarkup()`, too much to repeat on every keystroke
					// for markup that would come out identical.
					const stale = local.entry.preview.includes( '#@' ) || !local.button.label;
					if ( visible && stale ) {
						local.button.set(
							'label',
							renderLocalLabel( local.entry, selection, group.submenu?.layout )
						);
					}
				}
			}

			// A group that reads back its current entry says so on the button, the way the
			// heading dropdown names the block the caret sits in.
			if ( group.submenu?.showsCurrent && current !== undefined ) {
				group.dropdown.buttonView.label = current;
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
		// Every glyph OneNote's symbol gallery has and MathLive's menu does not: this one is ours
		// end to end, so unlike the groups below it needs no field to describe itself.
		toolbar.items.add( this._createSymbolsDropdown( t( 'Symbols' ), IconSpecialCharacters ) );
		// The structures MathLive inserts, plus the ones it stops short of. Each of ours is slotted
		// in behind the MathLive entry it belongs with, so the sections stay the sections upstream
		// captioned rather than gaining a bin of leftovers at the end.
		toolbar.items.add( this._createSubmenuGroup( 'insert', t( 'Insert' ), IconPlus, {
			extras: {
				'insert-log-base': [
					{
						insert: '\\begin{cases}#? & #?\\\\#? & #?\\end{cases}',
						preview: '\\begin{cases}\\blacksquare\\\\\\blacksquare\\end{cases}',
						label: t( 'Piecewise' )
					},
					{
						insert: '\\binom{#?}{#?}',
						preview: '\\binom{n}{k}',
						label: t( 'Binomial coefficient' )
					}
				],
				'insert-integral': [
					{
						insert: '\\iint_#?^#?#?\\,\\mathrm{d}#?',
						preview: '\\iint',
						label: t( 'Double integral' )
					},
					{
						insert: '\\iiint_#?^#?#?\\,\\mathrm{d}#?',
						preview: '\\iiint',
						label: t( 'Triple integral' )
					},
					{
						insert: '\\oint_#?^#?#?\\,\\mathrm{d}#?',
						preview: '\\oint',
						label: t( 'Contour integral' )
					}
				],
				'insert-product': [
					{ insert: '\\bigcup_#?^#?#?', preview: '\\bigcup', label: t( 'Union' ) },
					{ insert: '\\bigcap_#?^#?#?', preview: '\\bigcap', label: t( 'Intersection' ) },
					{ insert: '\\lim_{#?\\to#?}#?', preview: '\\lim', label: t( 'Limit' ) }
				]
			}
		} ) );
		// The accents draw themselves around whatever is selected, so their previews are re-read
		// as the selection moves; with nothing selected there is nothing to accent, and MathLive
		// hides every one of them — taking the group with them. Ours follow the same rules: the
		// narrow marks want a single letter under them, the stretchy ones take any selection.
		toolbar.items.add( this._createSubmenuGroup(
			'accent', t( 'Accent' ), IconText, {
				liveLabels: true,
				layout: 'grid',
				extras: {
					'accent-vec': [
						{ insert: '\\hat{#@}', preview: '\\hat{#@}', label: t( 'Hat' ), selection: 'one' },
						{ insert: '\\tilde{#@}', preview: '\\tilde{#@}', label: t( 'Tilde' ), selection: 'one' }
					],
					'accent-ddot': [
						{ insert: '\\dddot{#@}', preview: '\\dddot{#@}', label: t( 'Triple dot' ), selection: 'one' },
						{ insert: '\\check{#@}', preview: '\\check{#@}', label: t( 'Check' ), selection: 'one' },
						{ insert: '\\breve{#@}', preview: '\\breve{#@}', label: t( 'Breve' ), selection: 'one' }
					],
					'accent-overline': [
						{
							insert: '\\widehat{#@}',
							preview: '\\widehat{#@}',
							label: t( 'Wide hat' ),
							selection: 'any'
						},
						{
							insert: '\\widetilde{#@}',
							preview: '\\widetilde{#@}',
							label: t( 'Wide tilde' ),
							selection: 'any'
						}
					]
				}
			}
		) );
		// Boxes around the selection, drawn around it in the preview the same way. Its entries
		// declare no condition of their own — the group carries it, and wants any selection.
		toolbar.items.add( this._createSubmenuGroup(
			'decoration', t( 'Decoration' ), IconMarker, { liveLabels: true, layout: 'row' }
		) );
		// What the next thing typed becomes: maths, prose inside the equation, or LaTeX source.
		// One of the three always holds, so they are a set of radios rather than checkboxes, and
		// they are about the caret rather than a selection — MathLive offers them only while
		// nothing is selected.
		toolbar.items.add( this._createSubmenuGroup(
			'mode', t( 'Mode' ), null, { checkableRole: 'menuitemradio', showsCurrent: true }
		) );
		// Sixteen colours each, drawn as MathLive draws them and named where only a swatch shows.
		// `queryStyle` answers `'mixed'` for a selection that is partly one colour, which reads
		// as set — pressing the swatch then finishes the job.
		toolbar.items.add( this._createSubmenuGroup(
			'color', t( 'Font Color' ), IconFontColor, { layout: 'swatches' }
		) );
		toolbar.items.add( this._createSubmenuGroup(
			'background-color', t( 'Font Background Color' ), IconFontBackground, { layout: 'swatches' }
		) );
		// Six ways to set the selection's letters. These are toggles rather than one-shot
		// insertions — the only entries in the balloon that report a state of their own — and
		// they stack: side by side, six letters in six alphabets are hard to tell apart, and the
		// one already set is easier to spot down a column.
		toolbar.items.add( this._createSubmenuGroup(
			'variant', t( 'Font style' ), IconFontFamily, { liveLabels: true }
		) );
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
		// bracket it stands for, wrapped around a `⋱`, which says it better than words would —
		// and a set of five drawings is read across, like the decorations, rather than down.
		toolbar.items.add( this._createMenuGroup( t( 'Borders' ), IconTableCellProperties, [
			{ id: 'environment-no-border', command: [ 'setEnvironment', 'matrix' ] },
			{ id: 'environment-parentheses', command: [ 'setEnvironment', 'pmatrix' ] },
			{ id: 'environment-brackets', command: [ 'setEnvironment', 'bmatrix' ] },
			{ id: 'environment-bar', command: [ 'setEnvironment', 'vmatrix' ] },
			{ id: 'environment-braces', command: [ 'setEnvironment', 'Bmatrix' ] }
		], { layout: 'row' } ) );

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
	private _createSubmenuGroup(
		id: MathLiveMenuItemId,
		label: string,
		icon: string | null,
		options: {
			liveLabels?: boolean;
			layout?: MenuGroupLayout;

			/** What a checkable entry of this group is: one of several, or one of a set of one. */
			checkableRole?: 'menuitemcheckbox' | 'menuitemradio';

			/**
			 * Whether the dropdown reads back the entry currently in force instead of naming
			 * itself — the shape of the editor's own heading dropdown, for a group where one of
			 * the entries always holds and knowing which matters more than the group's name.
			 */
			showsCurrent?: boolean;

			/** Entries of ours to add, each keyed by the MathLive entry it should follow. */
			extras?: Partial<Record<MathLiveMenuItemId, readonly LocalMenuEntry[]>>;
		} = {}
	): DropdownView {
		const locale = this.editor.locale;
		const dropdown = createDropdown( locale );
		const list = new ListView( locale );

		if ( options.showsCurrent ) {
			// The name moves to the tooltip, as the heading dropdown does it; the label is then
			// free to say which entry is in force, and the refresh keeps it saying so.
			dropdown.buttonView.set( {
				withText: true,
				tooltip: label,
				ariaLabel: label,
				ariaLabelledBy: undefined
			} );
			dropdown.extendTemplate( { attributes: { class: 'ck-math-live-current' } } );
		} else {
			dropdown.buttonView.set( { label, icon: icon ?? undefined, tooltip: true } );
		}

		// A group of previews and nothing else reads better side by side than stacked, and
		// `ListView` has no `class` of its own to say so with.
		if ( options.layout ) {
			list.extendTemplate( { attributes: { class: `ck-math-live-${ options.layout }` } } );
		}

		dropdown.panelView.children.add( list );

		// Filled in from the field's own menu, once there is a field to read it from.
		this._menuGroups.push( {
			dropdown,
			items: [],
			locals: [],
			submenu: {
				id,
				list,
				extras: options.extras,
				liveLabels: options.liveLabels,
				checkableRole: options.checkableRole,
				showsCurrent: options.showsCurrent,
				layout: options.layout
			}
		} );
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
			const button = new ListItemButtonView( locale, new MathLiveLabelView( locale ) );

			button.set( {
				withText: true,
				label: entry.label ?? '',
				// A drawing of a blackboard `a` does not say "blackboard"; MathLive's own
				// wording does, and only these entries carry any.
				tooltip: entry.tooltip ?? false,
				// The style entries report whether the selection already carries what they set.
				// A checkable row says so with a tick of its own rather than by lighting up,
				// which is what `ListItemButtonView` is for — and how the AI assistant's picker
				// marks its current choice.
				// A swatch is a colour and nothing else: it marks itself by lighting up, where a
				// tick would need a column of its own in every cell of the grid.
				isToggleable: entry.isToggleable && submenu.layout !== 'swatches',
				role: entry.isToggleable && submenu.layout !== 'swatches' ?
					( submenu.checkableRole ?? 'menuitemcheckbox' ) :
					undefined,
				// The colours name themselves there instead.
				ariaLabel: entry.ariaLabel ?? undefined,
				isVisible: false,
				isEnabled: false
			} );
			button.on( 'execute', () => this._runMenuItem( id ) );
			// Closing the dropdown is the default behaviour of an `execute` it can hear, and a
			// button nested in a group would not reach it on its own.
			button.delegate( 'execute' ).to( group.dropdown );

			const listItem = new ListItemView( locale );
			listItem.children.add( button );
			listItem.bind( 'isVisible' ).to( button, 'isVisible' );
			section.items.add( listItem );

			// The label came with the entry: the refresh has only its state left to follow,
			// unless the group redraws itself around the selection.
			group.items.push( { target: button, id, ownLabel: false } );

			// Whatever of ours belongs behind this entry goes in now, so the additions land inside
			// the section they belong to rather than in a bin of leftovers at the end.
			for ( const extra of submenu.extras?.[ id ] ?? [] ) {
				section.items.add( this._createLocalEntry( group, extra ) );
			}
		}

		// One checkable entry and the whole group indents, so the labels stay in a line rather
		// than the ticked ones sitting a column to the right. CKEditor does this for the lists
		// it builds from definitions; this one is built by hand, for the sake of the labels.
		const buttons = group.items.map( item => item.target ).filter( isListItemButton );
		if ( buttons.some( button => button.isToggleable ) ) {
			for ( const button of buttons ) {
				button.hasCheckSpace = true;
			}
		}
	}

	/**
	 * One entry of ours, built to look and behave like the MathLive entries around it: the same
	 * kind of button, the same drawn label, and the same silence when it does not apply. Its LaTeX
	 * goes to the field rather than through the menu, which knows nothing about it.
	 */
	private _createLocalEntry( group: MenuGroup, entry: LocalMenuEntry ): ListItemView {
		const locale = this.editor.locale;
		const button = new ListItemButtonView( locale, new MathLiveLabelView( locale ) );

		button.set( {
			withText: true,
			label: '',
			tooltip: entry.label,
			isVisible: false,
			isEnabled: false
		} );
		button.on( 'execute', () => {
			// `#@` is the selection, and MathLive's `'item'` leaves what it produced selected —
			// so a second accent stacks on the first rather than replacing it.
			const selectionMode = entry.insert.includes( '#@' ) ? 'item' : 'placeholder';
			this.editor.plugins.get( MathLiveEdit ).insertIntoField( entry.insert, selectionMode );
			this._refreshMenuGroups();
		} );
		button.delegate( 'execute' ).to( group.dropdown );

		const listItem = new ListItemView( locale );
		listItem.children.add( button );
		listItem.bind( 'isVisible' ).to( button, 'isVisible' );

		group.locals.push( { entry, button } );
		return listItem;
	}

	/**
	 * The symbol gallery: the glyphs of {@link MATH_SYMBOL_SECTIONS}, drawn as themselves and
	 * grouped the way a person browsing for one expects to find them. Unlike every other group in
	 * this balloon it is ours rather than MathLive's, so it describes itself without a field —
	 * but it is still built on first open, since two hundred previews is two hundred renders and
	 * most sessions never ask for one.
	 */
	private _createSymbolsDropdown( label: string, icon: string ): DropdownView {
		const editor = this.editor;
		const locale = editor.locale;
		const t = editor.t;
		const dropdown = createDropdown( locale );
		const list = new ListView( locale );

		dropdown.buttonView.set( { label, icon, tooltip: true } );
		list.extendTemplate( { attributes: { class: 'ck-math-live-symbols' } } );
		dropdown.panelView.children.add( list );

		dropdown.on( 'change:isOpen', () => {
			if ( !dropdown.isOpen || list.items.length ) {
				return;
			}

			for ( const { id, symbols } of MATH_SYMBOL_SECTIONS ) {
				const section = new ListItemGroupView( locale );
				section.label = getSymbolSectionTitle( t, id );
				list.items.add( section );

				for ( const latex of symbols ) {
					const button = new ListItemButtonView( locale, new MathLiveLabelView( locale ) );

					// The LaTeX is the tooltip: `\nabla` is what this symbol is called wherever
					// maths is written, and it is what to type to get it here next time.
					button.set( { withText: true, label: renderMathMarkup( latex ), tooltip: latex } );
					button.on( 'execute', () => {
						editor.plugins.get( MathLiveEdit ).insertIntoField( latex );
					} );
					button.delegate( 'execute' ).to( dropdown );

					const listItem = new ListItemView( locale );
					listItem.children.add( button );
					section.items.add( listItem );
				}
			}
		} );

		return dropdown;
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
	private _createMenuGroup(
		label: string,
		icon: string,
		actions: Array<MenuAction>,
		options: { layout?: MenuGroupLayout } = {}
	): DropdownView {
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

		// `addListToDropdown` builds its list on the first open — and, the panel being rendered by
		// then, renders it there and then, too late to extend its template. So the layout goes on
		// the element it produced, on that same opening and harmlessly again on every later one.
		if ( options.layout ) {
			dropdown.on( 'change:isOpen', () => {
				dropdown.listView?.element?.classList.add( `ck-math-live-${ options.layout }` );
			} );
		}

		dropdown.on( 'execute', evt => {
			const command = ( evt.source as { _matrixCommand?: MatrixCommand } )._matrixCommand;
			/* v8 ignore next 3 -- every entry of this list carries a command */
			if ( !command ) {
				return;
			}
			this._runFieldCommand( command );
		} );

		this._menuGroups.push( { dropdown, items, locals: [] } );
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

function isListItemButton( target: MenuBoundTarget ): target is ListItemButtonView {
	return target instanceof ListItemButtonView;
}

/**
 * What a section of the symbol gallery is called. A switch rather than a caption in the table
 * itself: the translation scan reads literal strings out of `t()` calls, and a `t( section.title )`
 * is invisible to it — the same reason the admonition and link features spell their labels out.
 */
function getSymbolSectionTitle( t: ( message: string ) => string, id: MathSymbolSectionId ): string {
	switch ( id ) {
		case 'basic': return t( 'Basic math' );
		case 'greek': return t( 'Greek letters' );
		case 'letterlike': return t( 'Letter-like symbols' );
		case 'operators': return t( 'Operators' );
		case 'relations': return t( 'Relations' );
		case 'negated': return t( 'Negated relations' );
		case 'arrows': return t( 'Arrows' );
		case 'logic': return t( 'Sets and logic' );
		case 'geometry': return t( 'Geometry' );
	}
}

/**
 * What is selected in the field, as plain text — the form MathLive's own accent entries measure,
 * so that a selected `\alpha` counts as the single letter it draws rather than the six characters
 * it is written with.
 */
function readSelection( field: LiveMathField ): string {
	try {
		return field.getValue?.( field.selection, 'plain-text' ) ?? '';
	} catch {
		/* v8 ignore next 2 -- a field mid-teardown; treated as nothing selected */
		return '';
	}
}

/** Whether an entry has something to act on, by the same rule MathLive applies to its own. */
function appliesToSelection( entry: LocalMenuEntry, selection: string ): boolean {
	switch ( entry.selection ) {
		// A structure needs nothing under it: it brings its own placeholders.
		case undefined: return true;
		case 'any': return selection.length > 0;
		case 'one': return selection.length === 1;
	}
}

/**
 * An entry drawn the way its neighbours are drawn: on its own in a group of previews, and beside
 * its name in a group that names what it inserts — the two-span shape MathLive gives the entries
 * of its insert menu, so ours line up in the same two columns.
 */
function renderLocalLabel( entry: LocalMenuEntry, selection: string, layout?: MenuGroupLayout ): string {
	const preview = renderMathMarkup( entry.preview.replace( '#@', () => selection ) );

	if ( layout ) {
		return preview;
	}

	return `<span class="ML__insert-template">${ preview }</span>` +
		`<span class="ML__insert-label">${ escapeHtml( entry.label ) }</span>`;
}

function escapeHtml( text: string ): string {
	return text.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
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
