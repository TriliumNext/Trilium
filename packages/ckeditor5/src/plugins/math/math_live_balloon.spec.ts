// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import {
	type ButtonView,
	type ClassicEditor,
	ContextualBalloon,
	type DropdownView,
	ListItemGroupView,
	ListItemView,
	type ListView,
	Paragraph,
	type ToolbarView,
	Typing,
	_getModelData as getData,
	_setModelData as setData
} from 'ckeditor5';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Math from './math.js';
import MathLiveBalloon, { buildMatrixLatex } from './math_live_balloon.js';
import MathLiveEdit from './math_live_edit.js';
import { createTestEditor } from '../../../test/editor-kit.js';

const INLINE_WIDGET = '<mathtex-inline display="false" equation="x^2" type="span"></mathtex-inline>';

describe( 'MathLiveBalloon', () => {
	let editor: ClassicEditor;
	let balloon: ContextualBalloon;

	beforeEach( async () => {
		editor = await createTestEditor( [ Math, Paragraph, Typing ] );
		balloon = editor.plugins.get( ContextualBalloon );
	} );

	function domRoot(): HTMLElement {
		const root = editor.editing.view.getDomRoot();
		if ( !( root instanceof HTMLElement ) ) {
			throw new Error( 'missing editable DOM root' );
		}
		return root;
	}

	/** The balloon's toolbar, or `null` when nothing of ours is in it. */
	function visibleToolbar(): ToolbarView | null {
		const view = balloon.visibleView;
		if ( !view || !( view.element instanceof HTMLElement ) ) {
			return null;
		}
		return view.element.classList.contains( 'ck-math-live-balloon' ) ? view as ToolbarView : null;
	}

	function items(): Array<unknown> {
		const toolbar = visibleToolbar();
		if ( !toolbar ) {
			throw new Error( 'the balloon is not showing' );
		}
		return Array.from( toolbar.items );
	}

	/** The two leading type toggles; the matrix picker is a dropdown and comes after them. */
	function buttons(): Array<ButtonView> {
		return items().slice( 0, 2 ) as Array<ButtonView>;
	}

	function matrixDropdown(): DropdownView {
		return items()[ 6 ] as DropdownView;
	}

	/** Opens the picker and returns its grid, which the dropdown builds on first open. */
	function openMatrixGrid(): { dropdown: DropdownView; grid: GridLike } {
		const dropdown = matrixDropdown();
		dropdown.isOpen = true;
		return { dropdown, grid: dropdown.panelView.children.get( 0 ) as unknown as GridLike };
	}

	function insertGroup(): DropdownView {
		return items()[ 2 ] as DropdownView;
	}

	function accentGroup(): DropdownView {
		return items()[ 3 ] as DropdownView;
	}

	function decorationGroup(): DropdownView {
		return items()[ 4 ] as DropdownView;
	}

	function fontStyleGroup(): DropdownView {
		return items()[ 5 ] as DropdownView;
	}

	/** The column, row and borders groups, in toolbar order. */
	function matrixGroups(): [ DropdownView, DropdownView, DropdownView ] {
		return items().slice( 7 ) as [ DropdownView, DropdownView, DropdownView ];
	}

	/** A group's entries, from its sections too. `addListToDropdown` builds on first open. */
	function groupEntries( dropdown: DropdownView ): Array<ButtonView> {
		dropdown.isOpen = true;
		const list = dropdown.panelView.children.get( 0 ) as ListView;
		return collectButtons( list.items );
	}

	/** How a group's list lays its entries out, as the browser resolves it. */
	function groupLayout( dropdown: DropdownView ): {
		display: string;
		flow: string;
		columns: Array<string>;
		width: number;
		panelWidth: number;
	} {
		dropdown.isOpen = true;
		const list = ( dropdown.panelView.children.get( 0 ) as ListView ).element as HTMLElement;
		const style = getComputedStyle( list );

		return {
			display: style.display,
			flow: style.gridAutoFlow,
			columns: style.gridTemplateColumns.split( ' ' ).filter( Boolean ),
			width: list.getBoundingClientRect().width,
			panelWidth: ( dropdown.panelView.element as HTMLElement ).getBoundingClientRect().width
		};
	}

	/** The captions of a group's sections, in order. */
	function groupSections( dropdown: DropdownView ): Array<string> {
		dropdown.isOpen = true;
		const list = dropdown.panelView.children.get( 0 ) as ListView;
		return Array.from( list.items )
			.filter( item => item instanceof ListItemGroupView )
			.map( item => ( item as ListItemGroupView ).label );
	}

	function liveField(): HTMLElement & { value: string } {
		const field = domRoot().querySelector( 'math-field' );
		if ( !( field instanceof HTMLElement ) ) {
			throw new Error( 'no math field is mounted' );
		}
		return field as HTMLElement & { value: string };
	}

	/** Selects the field's whole content — a single atom, when it holds a single character. */
	function selectWholeField(): void {
		( liveField() as unknown as { executeCommand( command: string ): void } )
			.executeCommand( 'selectAll' );
	}

	/** Puts a matrix in the field, leaving the caret inside its first cell as MathLive does. */
	async function insertMatrix( rows: number, columns: number ): Promise<void> {
		editor.plugins.get( MathLiveEdit ).insertIntoField( buildMatrixLatex( rows, columns ) );
		await waitFor( () => matrixGroups()[ 0 ].class === undefined || null );
	}

	async function startEditingSelected(): Promise<void> {
		editor.plugins.get( MathLiveEdit ).startEditing();
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
	}

	it( 'is loaded by the Math glue plugin', () => {
		expect( editor.plugins.has( MathLiveBalloon ) ).toBe( true );
		expect( visibleToolbar() ).toBeNull();
	} );

	it( 'shows while a field is live and hides once it is torn down', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		expect( visibleToolbar() ).not.toBeNull();

		// Escape commits the equation, which ends the session.
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( visibleToolbar() ).toBeNull();
	} );

	it( 'offers the two type toggles, with the equation\'s current form lit', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const [ inline, display ] = buttons();

		// Two toggles; the insert, accent, decoration and font-style groups; the matrix picker;
		// and the column, row and borders groups.
		expect( items() ).toHaveLength( 10 );
		expect( inline.label ).toBe( 'Inline equation' );
		expect( display.label ).toBe( 'Display equation' );
		expect( inline.icon ).toBeTruthy();
		expect( display.icon ).toBeTruthy();
		expect( inline.isOn ).toBe( true );
		expect( display.isOn ).toBe( false );
		expect( inline.isEnabled ).toBe( true );
		expect( display.isEnabled ).toBe( true );
	} );

	it( 'switches the equation to display and carries the edit over to it', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		buttons()[ 1 ].fire( 'execute' );

		expect( getData( editor.model ) ).toContain( '<mathtex-display' );

		// The field was pulled out with the old element; editing resumes on the new one.
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		const [ inline, display ] = buttons();
		expect( inline.isOn ).toBe( false );
		expect( display.isOn ).toBe( true );
	} );

	it( 'switches back to inline', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		buttons()[ 1 ].fire( 'execute' );
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		buttons()[ 0 ].fire( 'execute' );

		expect( getData( editor.model ) ).toContain( '<mathtex-inline' );
		await waitFor( () => domRoot().querySelector( 'math-field' ) );
		expect( buttons()[ 0 ].isOn ).toBe( true );
	} );

	it( 'a toggle for the form the equation already has changes nothing', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const before = getData( editor.model );
		buttons()[ 0 ].fire( 'execute' );

		expect( getData( editor.model ) ).toBe( before );
		// No conversion means no re-entry: the original field is still the live one.
		expect( domRoot().querySelector( 'math-field' ) ).not.toBeNull();
	} );

	it( 'offers a matrix picker built on CKEditor\'s insert-table grid', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const dropdown = matrixDropdown();
		expect( dropdown.buttonView.label ).toBe( 'Insert matrix' );
		// The grid is 100 buttons, so it is only built once the picker is first opened.
		expect( dropdown.panelView.children.length ).toBe( 0 );

		// Opening focuses the first box, which is what puts the grid at 1 × 1.
		const { grid } = openMatrixGrid();
		expect( grid.rows ).toBe( 1 );
		expect( grid.columns ).toBe( 1 );
	} );

	it( 'types the matrix of the picked size into the field, and the model follows', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const insertIntoField = vi.spyOn( editor.plugins.get( MathLiveEdit ), 'insertIntoField' );

		const { grid } = openMatrixGrid();
		grid.rows = 2;
		grid.columns = 3;
		grid.fire( 'execute' );

		// The size picked, not the size the grid happens to hold once the picker has closed.
		expect( insertIntoField ).toHaveBeenCalledWith( buildMatrixLatex( 2, 3 ) );

		const mathfield = domRoot().querySelector( 'math-field' ) as ( HTMLElement & { value: string } ) | null;
		expect( mathfield?.value ).toContain( '\\begin{pmatrix}' );
		// Two rows of three: two column separators per row, one row break between them.
		expect( mathfield?.value.match( /&/g ) ).toHaveLength( 4 );

		// MathLive reports the programmatic insert as an `input` event, which the session's
		// debounced sync then writes to the model.
		await waitFor( () => getData( editor.model ).includes( 'begin{pmatrix}' ) || null );
	} );

	it( 'starts from a clean 1 × 1 every time the picker opens', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const { dropdown, grid } = openMatrixGrid();
		grid.rows = 4;
		grid.columns = 4;
		dropdown.isOpen = false;

		// Closing leaves the pick alone — reading it is what `execute` does next — so the clean
		// slate has to come from re-opening.
		dropdown.isOpen = true;
		expect( grid.rows ).toBe( 1 );
		expect( grid.columns ).toBe( 1 );
	} );

	it( 'keeps the matrix groups out of the way until the caret is in a matrix', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const [ columnGroup, rowGroup ] = matrixGroups();
		expect( columnGroup.buttonView.label ).toBe( 'Column' );
		expect( rowGroup.buttonView.label ).toBe( 'Row' );
		expect( columnGroup.class ).toBe( 'ck-hidden' );
		expect( rowGroup.class ).toBe( 'ck-hidden' );

		// Inserting one leaves the caret in its first cell, which is what brings the groups out.
		await insertMatrix( 2, 2 );
		expect( rowGroup.class ).toBeUndefined();
	} );

	it( 'splits the six actions between the column group and the row group', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await insertMatrix( 2, 2 );
		const [ columnGroup, rowGroup ] = matrixGroups();

		expect( groupEntries( columnGroup ).map( entry => entry.label ) )
			.toEqual( [ 'Insert column left', 'Insert column right', 'Delete column' ] );
		expect( groupEntries( rowGroup ).map( entry => entry.label ) )
			.toEqual( [ 'Insert row above', 'Insert row below', 'Delete row' ] );
	} );

	it( 'adds a row through MathLive, and the model follows', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await insertMatrix( 2, 2 );
		// One row break for the two rows it started with.
		expect( liveField().value.match( /\\\\/g ) ).toHaveLength( 1 );

		const rowGroup = matrixGroups()[ 1 ];
		const insertBelow = groupEntries( rowGroup ).find( entry => entry.label === 'Insert row below' );
		insertBelow?.fire( 'execute' );

		expect( liveField().value.match( /\\\\/g ) ).toHaveLength( 2 );
		await waitFor( () => getData( editor.model ).includes( 'begin{pmatrix}' ) || null );
	} );

	it( 'lets MathLive rule on what applies: the last row cannot be deleted', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await insertMatrix( 1, 2 );

		const [ columnGroup, rowGroup ] = matrixGroups();
		const deleteRow = groupEntries( rowGroup ).find( entry => entry.label === 'Delete row' );
		const deleteColumn = groupEntries( columnGroup ).find( entry => entry.label === 'Delete column' );

		expect( deleteRow?.isEnabled ).toBe( false );
		expect( deleteColumn?.isEnabled ).toBe( true );
	} );

	it( 'draws each insert entry as the structure it would insert', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const insert = insertGroup();
		expect( insert.buttonView.label ).toBe( 'Insert' );

		const entries = groupEntries( insert );
		expect( entries ).toHaveLength( 13 );

		// The sections and their captions are MathLive's own, read off the submenu rather than
		// restated here — which is what keeps them localized.
		expect( groupSections( insert ) ).toEqual( [ 'Calculus', 'Complex Numbers' ] );

		// MathLive's label is markup: a rendering of the structure, then its name. Both have to
		// survive into the DOM as elements rather than as the text of the markup itself.
		const [ abs ] = entries;
		expect( abs.label ).toContain( 'ML__insert-template' );
		expect( abs.element?.querySelector( '.ML__insert-template' ) ).not.toBeNull();
		expect( abs.element?.querySelector( '.ML__insert-label' )?.textContent ).toBeTruthy();
		expect( abs.element?.textContent ).not.toContain( '<span' );
	} );

	it( 'gives every insert entry room for what it draws', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const entries = groupEntries( insertGroup() );

		// A display fraction or an integral's limits paint outside the line box MathLive's struts
		// reserve, so the row has to be roomy enough to hold them; otherwise they land on the
		// entry above. Struts themselves are excluded — they position things and draw nothing.
		const spilling = entries
			.map( entry => {
				const element = entry.element as HTMLElement;
				const ink = inkExtent( element );
				const box = element.getBoundingClientRect();
				return {
					label: element.textContent?.trim(),
					above: ink.top - box.top,
					below: box.bottom - ink.bottom
				};
			} )
			.filter( entry => entry.above < 0 || entry.below < 0 );

		expect( spilling ).toEqual( [] );
	} );

	it( 'inserts the picked structure at the caret, and the model follows', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const entries = groupEntries( insertGroup() );
		const integral = entries[ 5 ];

		integral.fire( 'execute' );

		expect( liveField().value ).toContain( '\\int' );
		await waitFor( () => getData( editor.model ).includes( 'int' ) || null );
	} );

	it( 'keeps the accents away until there is something to accent', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const accents = accentGroup();
		expect( accents.buttonView.label ).toBe( 'Accent' );
		// Nothing is selected yet, and MathLive hides every accent — so the group goes too.
		expect( accents.class ).toBe( 'ck-hidden' );

		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accents.class === undefined || null );

		// All twelve apply to a single selected atom; five of them want exactly one.
		expect( groupEntries( accents ).filter( entry => entry.isVisible ) ).toHaveLength( 12 );
	} );

	it( 'draws each accent around the selection, and redraws it when that changes', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		const vec = groupEntries( accentGroup() )[ 0 ];
		expect( vec.label ).toContain( 'ML__latex' );
		const drawnAroundA = vec.element?.textContent;

		// The previews are not fixed pictures: they redraw around whatever is selected now.
		liveField().value = 'b';
		selectWholeField();
		await waitFor( () => ( vec.element?.textContent !== drawnAroundA ? true : null ) );

		expect( vec.element?.textContent ).toContain( 'b' );
	} );

	it( 'sets the picked accent on the selection', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		groupEntries( accentGroup() )[ 0 ].fire( 'execute' );

		expect( liveField().value ).toContain( '\\vec' );
		await waitFor( () => getData( editor.model ).includes( 'vec' ) || null );
	} );

	it( 'boxes the selection, and waits for one before offering to', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const decorations = decorationGroup();
		expect( decorations.buttonView.label ).toBe( 'Decoration' );
		expect( decorations.class ).toBe( 'ck-hidden' );

		// Unlike the accents, these take any selection — the condition sits on the group, whose
		// entries declare none of their own.
		liveField().value = 'a+b';
		selectWholeField();
		await waitFor( () => decorations.class === undefined || null );

		const entries = groupEntries( decorations );
		expect( entries ).toHaveLength( 3 );
		expect( entries[ 0 ].label ).toContain( 'ML__latex' );

		entries[ 0 ].fire( 'execute' );
		expect( liveField().value ).toContain( '\\boxed' );
		await waitFor( () => getData( editor.model ).includes( 'boxed' ) || null );
	} );

	it( 'lays the previews out as a set: the accents in a grid, the decorations in a row', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		const accents = groupLayout( accentGroup() );
		expect( accents.display ).toBe( 'grid' );
		expect( accents.columns ).toHaveLength( 4 );

		// Four columns of one width, and that width comes from the previews rather than from the
		// panel — tie it to the panel and a narrow balloon squeezes them into each other.
		expect( new Set( accents.columns ).size ).toBe( 1 );
		expect( accents.width ).toBeLessThan( accents.panelWidth );

		const decorations = groupLayout( decorationGroup() );
		expect( decorations.display ).toBe( 'grid' );
		expect( decorations.flow ).toBe( 'column' );

		// The font styles stack instead: six letters in six alphabets side by side are hard to
		// tell apart, and the one already set is easier to spot down a column.
		expect( groupLayout( fontStyleGroup() ).display ).toBe( 'block' );

		// The entries themselves have to give up the 15em CKEditor holds a list item to, or the
		// four columns would be as wide as four sentences.
		const item = groupEntries( accentGroup() )[ 0 ].element?.closest( '.ck-list__item' );
		expect( getComputedStyle( item as HTMLElement ).minWidth ).toBe( '0px' );

		// A list still, for anyone reading it out.
		expect( ( accentGroup().panelView.children.get( 0 ) as ListView ).element?.tagName ).toBe( 'UL' );
	} );

	it( 'gives every accent a cell of its own to draw in', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		// Side by side, an entry that paints outside its cell paints into its neighbour's.
		const spilling = groupEntries( accentGroup() )
			.map( entry => {
				const element = entry.element as HTMLElement;
				const ink = inkExtent( element );
				const box = element.getBoundingClientRect();
				return {
					above: ink.top - box.top,
					below: box.bottom - ink.bottom,
					before: ink.left - box.left,
					after: box.right - ink.right
				};
			} )
			.filter( entry => entry.above < 0 || entry.below < 0 || entry.before < 0 || entry.after < 0 );

		expect( spilling ).toEqual( [] );
	} );

	it( 'sets the selection\'s font style, and reports which one it already carries', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => fontStyleGroup().class === undefined || null );

		const entries = groupEntries( fontStyleGroup() );
		expect( entries ).toHaveLength( 6 );

		// These toggle rather than insert — the only entries in the balloon that carry a state.
		const bold = entries.find( entry => entry.tooltip === 'Bold' );
		expect( bold?.isToggleable ).toBe( true );
		expect( bold?.isOn ).toBe( false );

		bold?.fire( 'execute' );
		// `\bm` is what the preview is drawn with; applying the style writes `\mathbf`.
		expect( liveField().value ).toContain( '\\mathbf' );

		// And having set it, the entry says so.
		await waitFor( () => bold?.isOn || null );
	} );

	it( 'names each font style, since the drawing alone does not', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => fontStyleGroup().class === undefined || null );

		// MathLive's own wording, which is all the naming these have.
		const tooltips = groupEntries( fontStyleGroup() ).map( entry => entry.tooltip );
		expect( tooltips ).toContain( 'Bold' );
		expect( tooltips ).toContain( 'Italic' );
		expect( tooltips.every( tooltip => typeof tooltip === 'string' && tooltip.length > 0 ) ).toBe( true );

		// The insert entries name themselves in the label, so they carry no tooltip.
		expect( groupEntries( insertGroup() )[ 0 ].tooltip ).toBe( false );
	} );

	it( 'offers the brackets as MathLive draws them, and switches the array to the one picked', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await insertMatrix( 2, 2 );
		const borders = matrixGroups()[ 2 ];

		expect( borders.buttonView.label ).toBe( 'Borders' );
		expect( borders.class ).toBeUndefined();

		// No wording of ours: every entry shows the bracket MathLive draws around a `⋱`.
		const entries = groupEntries( borders );
		expect( entries.map( entry => entry.label ) ).toEqual( [ ' ⋱ ', '(⋱)', '[⋱]', '|⋱|', '{⋱}' ] );

		expect( liveField().value ).toContain( '\\begin{pmatrix}' );
		entries[ 2 ].fire( 'execute' );
		expect( liveField().value ).toContain( '\\begin{bmatrix}' );
	} );

	it( 'puts the groups away again when the session ends', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await insertMatrix( 2, 2 );
		// Held on to across the teardown: once the balloon is gone, so is the way to reach them.
		const [ columnGroup, rowGroup ] = matrixGroups();

		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );

		expect( columnGroup.class ).toBe( 'ck-hidden' );
		expect( rowGroup.class ).toBe( 'ck-hidden' );
	} );

	it( 'comes back for a second edit, reusing the same view', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const first = balloon.visibleView;
		domRoot().querySelector( 'math-field' )?.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } ) );
		expect( visibleToolbar() ).toBeNull();

		await startEditingSelected();
		expect( visibleToolbar() ).not.toBeNull();
		expect( balloon.visibleView ).toBe( first );
	} );

	it( 'swallows mousedown, so clicking it does not blur the field and end the session', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const element = balloon.visibleView?.element;
		if ( !( element instanceof HTMLElement ) ) {
			throw new Error( 'the balloon view is not rendered' );
		}

		const event = new MouseEvent( 'mousedown', { bubbles: true, cancelable: true } );
		element.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( visibleToolbar() ).not.toBeNull();
	} );

	it( 'hides when the session is aborted because the widget disappeared', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		editor.model.change( writer => {
			const paragraph = editor.model.document.getRoot()?.getChild( 0 );
			if ( paragraph?.is( 'element' ) ) {
				const widget = Array.from( paragraph.getChildren() ).find( child => child.is( 'element', 'mathtex-inline' ) );
				if ( widget ) {
					writer.remove( widget );
				}
			}
		} );

		expect( visibleToolbar() ).toBeNull();
	} );

	it( 'is pinned to the field, so it survives destroying the editor mid-session', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await editor.destroy();
	} );

	it( 'repositions when the field grows', async () => {
		// A growing field fires none of the balloon's own repositioning triggers (window
		// resize, scroll, editor UI update) — MathLive renders inside its shadow root,
		// invisible to the editor. The session observes the field's size instead.
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		await waitFor( () => visibleToolbar() );

		const updatePosition = vi.spyOn( balloon, 'updatePosition' );
		liveField().style.height = '200px';
		await waitFor( () => ( updatePosition.mock.calls.length > 0 ? true : null ) );
	} );
} );

describe( 'buildMatrixLatex', () => {
	it( 'builds a pmatrix of placeholders, rows separated by \\\\', () => {
		expect( buildMatrixLatex( 2, 3 ) ).toBe( '\\begin{pmatrix}#? & #? & #?\\\\#? & #? & #?\\end{pmatrix}' );
		expect( buildMatrixLatex( 1, 1 ) ).toBe( '\\begin{pmatrix}#?\\end{pmatrix}' );
	} );
} );

/**
 * How far the rendered equation inside an entry actually paints. Only leaves carrying glyphs
 * count, plus the rules a fraction and a radical draw: MathLive's struts (`ML__pstrut` and
 * friends) are invisible boxes that position the rest, and they reach far outside on purpose.
 */
function inkExtent( element: HTMLElement ): { top: number; bottom: number; left: number; right: number } {
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;

	for ( const node of element.querySelectorAll( '*' ) ) {
		const paints = ( node.children.length === 0 && ( node.textContent ?? '' ).trim() !== '' ) ||
			node.classList.contains( 'ML__frac-line' ) ||
			node.classList.contains( 'ML__sqrt-line' );

		if ( !paints ) {
			continue;
		}

		const box = node.getBoundingClientRect();
		top = globalThis.Math.min( top, box.top );
		bottom = globalThis.Math.max( bottom, box.bottom );
		left = globalThis.Math.min( left, box.left );
		right = globalThis.Math.max( right, box.right );
	}

	return { top, bottom, left, right };
}

/** Every button of a list, descending into the sections a grouped list nests them in. */
function collectButtons( items: Iterable<unknown> ): Array<ButtonView> {
	const buttons: Array<ButtonView> = [];

	for ( const item of items ) {
		if ( item instanceof ListItemGroupView ) {
			buttons.push( ...collectButtons( item.items ) );
		} else if ( item instanceof ListItemView ) {
			buttons.push( item.children.get( 0 ) as ButtonView );
		}
	}

	return buttons;
}

/** The bits of CKEditor's insert-table grid the picker drives. */
interface GridLike {
	rows: number;
	columns: number;
	fire( event: string ): void;
}

async function waitFor<T>( check: () => T | null | undefined, timeout = 4000 ): Promise<T> {
	const start = performance.now();
	for ( ;; ) {
		const result = check();
		if ( result ) {
			return result;
		}
		if ( performance.now() - start > timeout ) {
			throw new Error( 'waitFor timed out' );
		}
		await new Promise( resolve => setTimeout( resolve, 25 ) );
	}
}
