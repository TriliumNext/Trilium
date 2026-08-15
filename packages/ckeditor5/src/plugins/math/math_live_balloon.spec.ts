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
import { MATH_STRUCTURE_SECTIONS } from './structures.js';
import matrixIcon from '../../icons/matrix.svg?raw';
import { MATH_SYMBOL_SECTIONS } from './symbols.js';
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

	/** Last of all: the Matrix gallery closes the structures row. */
	function matrixDropdown(): DropdownView {
		return items()[ items().length - 1 ] as DropdownView;
	}

	/** Opens the picker and returns its grid, which the dropdown builds on first open. */
	function openMatrixGrid(): { dropdown: DropdownView; grid: GridLike } {
		const dropdown = matrixDropdown();
		dropdown.isOpen = true;
		return { dropdown, grid: dropdown.panelView.children.get( 0 ) as unknown as GridLike };
	}

	function decorationGroup(): DropdownView {
		return items()[ 2 ] as DropdownView;
	}

	function modeGroup(): DropdownView {
		return items()[ 3 ] as DropdownView;
	}

	function colorGroup(): DropdownView {
		return items()[ 4 ] as DropdownView;
	}

	function backgroundColorGroup(): DropdownView {
		return items()[ 5 ] as DropdownView;
	}

	function fontStyleGroup(): DropdownView {
		return items()[ 6 ] as DropdownView;
	}

	/** The column, row and borders groups, in toolbar order. */
	function matrixGroups(): [ DropdownView, DropdownView, DropdownView ] {
		return items().slice( 7, 10 ) as [ DropdownView, DropdownView, DropdownView ];
	}

	/** The second row: one per symbol category, in the order the table declares them. */
	function symbolGroups(): Array<DropdownView> {
		return items().slice( 11, 11 + MATH_SYMBOL_SECTIONS.length ) as Array<DropdownView>;
	}

	/** The third row: OneNote's eleven structure galleries, Accent and Matrix among them. */
	function structureRow(): Array<DropdownView> {
		return items().slice( 11 + MATH_SYMBOL_SECTIONS.length + 1 ) as Array<DropdownView>;
	}

	/** Accent sits eighth of the eleven, as it does in OneNote's own ribbon. */
	function accentGroup(): DropdownView {
		return structureRow()[ 7 ];
	}

	/** The nine of that row built from the table, in its order — Accent and Matrix left out. */
	function structureGalleries(): Array<DropdownView> {
		return structureRow().filter( ( _, index ) => index !== 7 && index !== 10 );
	}

	/**
	 * What a toolbar group is called. The galleries wear a glyph and put the name in the tooltip;
	 * the groups MathLive builds do the opposite, and tooltip themselves from their label.
	 */
	function groupName( dropdown: DropdownView ): string | undefined {
		const button = dropdown.buttonView;
		return typeof button.tooltip === 'string' ? button.tooltip : button.label;
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

		// Row one: two toggles, the decoration, mode, colour, background and font-style
		// groups, and the column, row and borders groups. Row two: a button per symbol category.
		// Row three: OneNote's eleven structure galleries. Two line breaks between them.
		expect( items() ).toHaveLength( 10 + 1 + MATH_SYMBOL_SECTIONS.length + 1 + 11 );
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

	it( 'offers a symbol gallery of ours, a button to a category', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const groups = symbolGroups();
		expect( groups ).toHaveLength( 9 );

		// Each wears one of its own symbols, since there is no icon for "the Greek letters", and
		// says what it is in the tooltip beside it.
		expect( groups.map( group => group.buttonView.label ) )
			.toEqual( [ '±', 'α', 'ℝ', '∑', '≤', '≠', '→', '∪', '∠' ] );
		expect( groups.map( group => group.buttonView.tooltip ) ).toEqual( [
			'Basic math', 'Greek letters', 'Letter-like symbols', 'Operators', 'Relations',
			'Negated relations', 'Arrows', 'Sets and logic', 'Geometry'
		] );
		// A glyph is not a name; the tooltip has to be the accessible one too.
		expect( groups[ 1 ].buttonView.ariaLabel ).toBe( 'Greek letters' );

		// These groups are ours rather than MathLive's, so unlike the ones around them there is
		// nothing in the field they have to wait for before they apply.
		expect( groups.map( group => group.class ) ).toEqual( Array( 9 ).fill( undefined ) );

		// A flat grid behind each: the button already said which category this is.
		expect( groupSections( groups[ 0 ] ) ).toEqual( [] );
		for ( const [ index, group ] of groups.entries() ) {
			expect( groupEntries( group ), MATH_SYMBOL_SECTIONS[ index ].id )
				.toHaveLength( MATH_SYMBOL_SECTIONS[ index ].symbols.length );
		}

		// Each entry draws its symbol, and is named by the LaTeX behind it — which is what the
		// symbol is called wherever maths is written, and what to type for it next time.
		const [ plusMinus ] = groupEntries( groups[ 0 ] );
		expect( plusMinus.tooltip ).toBe( '\\pm' );
		expect( plusMinus.label ).toContain( 'ML__latex' );
		expect( plusMinus.element?.textContent ).not.toContain( '<span' );

		plusMinus.fire( 'execute' );
		expect( liveField().value ).toContain( '\\pm' );
		await waitFor( () => getData( editor.model ).includes( 'pm' ) || null );
	} );

	it( 'breaks the toolbar so the categories always start a row of their own', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();

		// A `flex-basis: 100%` item that fills whatever is left of the line it lands on, which is
		// what CKEditor's own `'-'` toolbar separator inserts. It sits between the last matrix
		// group and the first category, so the categories open a row rather than trailing the
		// one before. (The rule behind the class is CKEditor's, and its stylesheet is not loaded
		// here — only the presence and the placement are ours to check.)
		const breaks = ( items() as Array<{ element?: HTMLElement }> )
			.map( ( item, index ) => ( { index, element: item.element } ) )
			.filter( item => item.element?.classList.contains( 'ck-toolbar__line-break' ) );
		expect( breaks.map( item => item.index ) )
			.toEqual( [ 10, 11 + MATH_SYMBOL_SECTIONS.length ] );

		// Wrapping is `.ck-toolbar__items`' default, but only ever within a width: without a cap
		// the balloon is shrink-to-fit and grows to hold all of it on one line.
		const toolbar = visibleToolbar()?.element as HTMLElement;
		expect( getComputedStyle( toolbar ).maxWidth ).not.toBe( 'none' );
	} );

	it( 'offers OneNote\'s eleven structure galleries, in its order', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const row = structureRow();

		expect( row.map( groupName ) ).toEqual( [
			'Fraction', 'Script', 'Radical', 'Integral', 'Large operator', 'Bracket', 'Function',
			// Not galleries of ours: the accents MathLive redraws around the selection, and the
			// matrix grid, both moved down here rather than copied badly.
			'Accent', 'Limit and log', 'Operator', 'Insert matrix'
		] );

		// Each gallery wears one of its own, as the symbol categories do.
		expect( structureGalleries().map( group => group.buttonView.label ) )
			.toEqual( MATH_STRUCTURE_SECTIONS.map( section => section.glyph ) );

		// A bracketed array of placeholders, not the table feature's grid of cells — that reads
		// as a spreadsheet.
		expect( matrixDropdown().buttonView.icon ).toBe( matrixIcon );

		// On a row where every button opens a picker, a caret beside each says nothing — and its
		// width is what pushed this row's last button onto a fourth row.
		for ( const group of row ) {
			const arrow = group.buttonView.element?.querySelector( '.ck-dropdown__arrow' );
			expect( arrow, groupName( group ) ).not.toBeNull();
			expect( getComputedStyle( arrow as Element ).display, groupName( group ) ).toBe( 'none' );
		}

		// A structure draws itself with letters in its slots, the way MathLive draws the entries
		// of its own insert menu — and is named by that same LaTeX.
		const [ fractions ] = row;
		const entries = groupEntries( fractions );
		expect( entries ).toHaveLength( MATH_STRUCTURE_SECTIONS[ 0 ].structures.length );
		expect( entries[ 0 ].tooltip ).toBe( '\\frac{a}{b}' );

		entries[ 0 ].fire( 'execute' );
		expect( liveField().value ).toContain( '\\frac' );
		await waitFor( () => getData( editor.model ).includes( 'frac' ) || null );
	} );

	it( 'draws every structure it offers, rather than showing its source', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();

		// A preview MathLive cannot parse falls back to the LaTeX itself, which would put raw
		// source in the gallery where a drawing belongs — the one way a bad entry in the table
		// shows up at all.
		const unrendered: Array<string> = [];
		for ( const [ index, section ] of MATH_STRUCTURE_SECTIONS.entries() ) {
			for ( const entry of groupEntries( structureGalleries()[ index ] ) ) {
				if ( !entry.element?.querySelector( '.ML__latex' ) ) {
					unrendered.push( `${ section.id }: ${ entry.tooltip as string }` );
				}
			}
		}

		expect( unrendered ).toEqual( [] );
	} );

	it( 'lays a symbol category out as a grid of cells sized by their glyphs', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const greek = groupLayout( symbolGroups()[ 1 ] );

		expect( greek.display ).toBe( 'grid' );
		expect( greek.columns ).toHaveLength( 8 );

		// Sized by what they hold rather than by the panel, as the accent grid is: tie a cell to
		// a fraction of the balloon and the glyphs collide as soon as it is narrow.
		expect( greek.width ).toBeLessThan( greek.panelWidth );
	} );

	it( 'adds the accents MathLive leaves out, and applies them to the selection', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		// Beside the MathLive accent each belongs with, not appended after all of them.
		const entries = groupEntries( accentGroup() );
		const hat = entries[ 1 ];
		expect( hat.tooltip ).toBe( 'Hat' );
		expect( entries[ 2 ].tooltip ).toBe( 'Tilde' );
		expect( entries[ 7 ].tooltip ).toBe( 'Triple dot' );

		// Each is drawn around the very letter it would mark, as MathLive's own accents are — and
		// a mark MathLive could not parse would show its source here instead of a drawing.
		for ( const entry of entries ) {
			expect( entry.element?.querySelector( '.ML__latex' ), entry.tooltip as string ).not.toBeNull();
		}

		hat.fire( 'execute' );
		expect( liveField().value ).toBe( '\\hat{a}' );
		await waitFor( () => getData( editor.model ).includes( 'hat' ) || null );
	} );

	it( 'holds a narrow accent to one atom where a stretchy one takes any selection', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a+b';
		selectWholeField();
		await waitFor( () => accentGroup().class === undefined || null );

		const accent = ( name: string ) =>
			groupEntries( accentGroup() ).find( entry => entry.tooltip === name );

		// A hat drawn over three atoms is a hat over the first of them, so MathLive hides its own
		// single-atom accents here and ours go with them; the wide pair is what stretches.
		expect( accent( 'Hat' )?.isVisible ).toBe( false );
		expect( accent( 'Wide hat' )?.isVisible ).toBe( true );

		accent( 'Wide tilde' )?.fire( 'execute' );
		expect( liveField().value ).toBe( '\\widetilde{a+b}' );
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

		// MathLive's twelve and our seven all apply to a single selected atom.
		expect( groupEntries( accents ).filter( entry => entry.isVisible ) ).toHaveLength( 19 );
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

		// Stacked, the previews line up where a list's labels go rather than each centring in
		// its own row; a preview alone in a grid cell still centres.
		const stacked = groupEntries( fontStyleGroup() )[ 0 ].element?.querySelector( '.ck-math-live-label' );
		const celled = groupEntries( accentGroup() )[ 0 ].element?.querySelector( '.ck-math-live-label' );
		expect( getComputedStyle( stacked as HTMLElement ).justifyContent ).toBe( 'start' );
		expect( getComputedStyle( celled as HTMLElement ).justifyContent ).toBe( 'center' );

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

	it( 'offers both colours as swatches, and paints the selection with the one picked', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => groupEntries( colorGroup() ).length || null );

		for ( const group of [ colorGroup(), backgroundColorGroup() ] ) {
			const swatches = groupEntries( group );
			expect( swatches ).toHaveLength( 16 );

			// A swatch is a colour and nothing else, so its name lives in the accessible label.
			expect( swatches[ 0 ].ariaLabel ).toBeTruthy();
			// And it marks itself by lighting up: a tick would want a column in every cell.
			expect( swatches[ 0 ].isToggleable ).toBe( false );

			const layout = groupLayout( group );
			expect( layout.display ).toBe( 'grid' );
			expect( layout.columns ).toHaveLength( 4 );
		}

		groupEntries( colorGroup() )[ 0 ].fire( 'execute' );
		expect( liveField().value ).toContain( '\\textcolor' );

		groupEntries( backgroundColorGroup() )[ 0 ].fire( 'execute' );
		await waitFor( () => getData( editor.model ).includes( 'colorbox' ) ||
			getData( editor.model ).includes( 'textcolor' ) || null );
	} );

	it( 'draws the swatches at a size of our own, since MathLive sizes its own markup', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => groupEntries( colorGroup() ).length || null );

		// The label is a bare `<span style="background: …">`; MathLive gives it a size through
		// its own menu markup, which never matches here, so it would come out at nothing.
		const entry = groupEntries( colorGroup() )[ 0 ].element as HTMLElement;
		const label = entry.querySelector( '.ck-math-live-label' ) as HTMLElement;
		const swatch = label.querySelector( 'span' ) as HTMLElement;
		const box = swatch.getBoundingClientRect();

		expect( box.width ).toBeGreaterThan( 8 );
		expect( box.height ).toBeGreaterThan( 8 );
		expect( getComputedStyle( swatch ).backgroundColor ).not.toBe( 'rgba(0, 0, 0, 0)' );

		// Centred in its cell, both ways. The rule that starts a stacked preview at the left is
		// a class more specific than a bare layout selector, so a swatch has to say so here.
		expect( getComputedStyle( label ).justifyContent ).toBe( 'center' );
		const cell = entry.getBoundingClientRect();
		expect( box.left - cell.left ).toBeCloseTo( cell.right - box.right, 0 );
		expect( box.top - cell.top ).toBeCloseTo( cell.bottom - box.bottom, 0 );
	} );

	it( 'switches what the next thing typed becomes, one mode of three at a time', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		const modes = groupEntries( modeGroup() );
		expect( modes.map( entry => entry.label ) ).toEqual( [ 'Math', 'Text', 'LaTeX' ] );

		// The button reads back the mode in force rather than naming itself, as the editor's own
		// heading dropdown does; the name moves to the tooltip.
		expect( modeGroup().buttonView.label ).toBe( 'Math' );
		expect( modeGroup().buttonView.tooltip ).toBe( 'Mode' );
		expect( modeGroup().buttonView.withText ).toBe( true );

		// Exactly one holds at a time, which is a radio rather than a checkbox.
		expect( modes[ 0 ].element?.getAttribute( 'role' ) ).toBe( 'menuitemradio' );
		expect( modes.map( entry => entry.isOn ) ).toEqual( [ true, false, false ] );

		modes[ 1 ].fire( 'execute' );
		await waitFor( () => modes[ 1 ].isOn || null );
		expect( modes.map( entry => entry.isOn ) ).toEqual( [ false, true, false ] );
		expect( modeGroup().buttonView.label ).toBe( 'Text' );
	} );

	it( 'offers the modes for a caret, not for a selection', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		expect( modeGroup().class ).toBeUndefined();

		// It is about what comes next, so MathLive withdraws it once something is selected —
		// the opposite of the accents, which have nothing to draw around without one.
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => modeGroup().class === 'ck-hidden' || null );
		expect( accentGroup().class ).toBeUndefined();
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

		// And having set it, the entry says so — with a tick of its own rather than by lighting
		// up, which is what a checkable row does.
		await waitFor( () => bold?.isOn || null );
		expect( bold?.element?.getAttribute( 'role' ) ).toBe( 'menuitemcheckbox' );
		expect( bold?.element?.querySelector( '.ck-list-item-button__check-icon' ) ).not.toBeNull();
	} );

	it( 'keeps the font-style labels in a line, ticked or not', async () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		await startEditingSelected();
		liveField().value = 'a';
		selectWholeField();
		await waitFor( () => fontStyleGroup().class === undefined || null );

		// One checkable entry indents the whole group, or the ticked ones would sit a column to
		// the right of the rest. The groups with nothing to tick keep their space.
		const styles = groupEntries( fontStyleGroup() ) as Array<ButtonView & { hasCheckSpace: boolean }>;
		expect( styles.every( entry => entry.hasCheckSpace ) ).toBe( true );

		const accents = groupEntries( accentGroup() ) as Array<ButtonView & { hasCheckSpace: boolean }>;
		expect( accents.some( entry => entry.hasCheckSpace ) ).toBe( false );
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

		// Drawings rather than sentences, so all five are read across a row — which this group is
		// given the way CKEditor's own list building leaves it: on the element.
		const layout = groupLayout( borders );
		expect( layout.display ).toBe( 'grid' );
		expect( layout.flow ).toBe( 'column' );

		// One line, however many the panel would have room for: a row that wraps is a grid.
		const tops = entries.map( entry => entry.element?.getBoundingClientRect().top );
		expect( new Set( tops ).size ).toBe( 1 );

		// Each centred in a cell of its own, none of them held to the 15em of a list of sentences.
		const cell = entries[ 0 ].element as HTMLElement;
		expect( getComputedStyle( cell ).justifyContent ).toBe( 'center' );
		expect( getComputedStyle( cell.closest( '.ck-list__item' ) as HTMLElement ).minWidth ).toBe( '0px' );

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
