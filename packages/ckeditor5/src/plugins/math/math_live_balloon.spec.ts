// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import {
	type ButtonView,
	type ClassicEditor,
	ContextualBalloon,
	type DropdownView,
	type ListItemView,
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
		return items()[ 2 ] as DropdownView;
	}

	/** Opens the picker and returns its grid, which the dropdown builds on first open. */
	function openMatrixGrid(): { dropdown: DropdownView; grid: GridLike } {
		const dropdown = matrixDropdown();
		dropdown.isOpen = true;
		return { dropdown, grid: dropdown.panelView.children.get( 0 ) as unknown as GridLike };
	}

	/** The column group and the row group, in toolbar order. */
	function matrixGroups(): [ DropdownView, DropdownView ] {
		return items().slice( 3 ) as [ DropdownView, DropdownView ];
	}

	/** A group's entries. `addListToDropdown` builds the list on first open, so open it. */
	function groupEntries( dropdown: DropdownView ): Array<ButtonView> {
		dropdown.isOpen = true;
		const list = dropdown.panelView.children.get( 0 ) as ListView;
		return Array.from( list.items ).map( item => ( item as ListItemView ).children.get( 0 ) as ButtonView );
	}

	function liveField(): HTMLElement & { value: string } {
		const field = domRoot().querySelector( 'math-field' );
		if ( !( field instanceof HTMLElement ) ) {
			throw new Error( 'no math field is mounted' );
		}
		return field as HTMLElement & { value: string };
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

		// Two toggles, the matrix picker, and the column and row groups.
		expect( items() ).toHaveLength( 5 );
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
} );

describe( 'buildMatrixLatex', () => {
	it( 'builds a pmatrix of placeholders, rows separated by \\\\', () => {
		expect( buildMatrixLatex( 2, 3 ) ).toBe( '\\begin{pmatrix}#? & #? & #?\\\\#? & #? & #?\\end{pmatrix}' );
		expect( buildMatrixLatex( 1, 1 ) ).toBe( '\\begin{pmatrix}#?\\end{pmatrix}' );
	} );
} );

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
