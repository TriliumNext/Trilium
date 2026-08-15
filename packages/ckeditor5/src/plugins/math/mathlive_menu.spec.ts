import { describe, expect, it, vi } from 'vitest';

import {
	getMenuItemLabel,
	getMenuItemState,
	MENU_ITEM_UNAVAILABLE,
	type MathLiveMenuField,
	runMenuItem
} from './mathlive_menu.js';

/** A stand-in for a `<math-field>`, carrying only the menu declarations we read. */
function fieldWith( ...menuItems: Array<Record<string, unknown>> ): MathLiveMenuField {
	return { menuItems } as MathLiveMenuField;
}

describe( 'getMenuItemState', () => {
	it( 'reads visibility and enablement off the item of that id', () => {
		const field = fieldWith(
			{ id: 'delete-row', visible: () => true, enabled: () => false },
			{ id: 'delete-column', visible: () => true, enabled: () => true }
		);

		expect( getMenuItemState( field, 'delete-row' ) ).toEqual( { visible: true, enabled: false, checked: false } );
		expect( getMenuItemState( field, 'delete-column' ) ).toEqual( { visible: true, enabled: true, checked: false } );
	} );

	it( 'takes a plain value as readily as a predicate', () => {
		const field = fieldWith( { id: 'add-row-above', visible: true, enabled: false } );

		expect( getMenuItemState( field, 'add-row-above' ) ).toEqual( { visible: true, enabled: false, checked: false } );
	} );

	it( 'defaults either to true when the declaration omits it, as MathLive does', () => {
		const field = fieldWith( { id: 'add-column-after' } );

		expect( getMenuItemState( field, 'add-column-after' ) ).toEqual( { visible: true, enabled: true, checked: false } );
	} );

	it( 'never reports an invisible action as enabled', () => {
		const field = fieldWith( { id: 'add-row-below', visible: () => false, enabled: () => true } );

		expect( getMenuItemState( field, 'add-row-below' ) ).toEqual( { visible: false, enabled: false, checked: false } );
	} );

	it( 'asks the predicates with no modifier held', () => {
		const visible = vi.fn().mockReturnValue( true );
		const field = fieldWith( { id: 'delete-row', visible } );

		getMenuItemState( field, 'delete-row' );

		expect( visible ).toHaveBeenCalledWith( { alt: false, control: false, shift: false, meta: false } );
	} );

	it( 'reports nothing for an id the menu does not carry', () => {
		expect( getMenuItemState( fieldWith( { id: 'copy' } ), 'delete-row' ) )
			.toEqual( MENU_ITEM_UNAVAILABLE );
		expect( getMenuItemState( fieldWith(), 'delete-row' ) ).toEqual( MENU_ITEM_UNAVAILABLE );
	} );

	it( 'finds an entry nested in a submenu, and gates it on its parent', () => {
		const borders = ( visible: boolean ) => ( {
			label: () => 'Borders',
			visible: () => visible,
			submenu: [ { id: 'environment-brackets', label: '[⋱]' } ]
		} );

		// The borders entries declare no condition of their own — their parent carries it.
		expect( getMenuItemState( fieldWith( borders( true ) ), 'environment-brackets' ) )
			.toEqual( { visible: true, enabled: true, checked: false } );
		expect( getMenuItemState( fieldWith( borders( false ) ), 'environment-brackets' ) )
			.toEqual( { visible: false, enabled: false, checked: false } );
	} );

	it( 'reports what the selection already carries, mixed included', () => {
		const style = ( checked: boolean | 'mixed' ) => fieldWith( { id: 'variant-style-bold', checked } );

		expect( getMenuItemState( style( true ), 'variant-style-bold' ).checked ).toBe( true );
		expect( getMenuItemState( style( 'mixed' ), 'variant-style-bold' ).checked ).toBe( 'mixed' );
		expect( getMenuItemState( style( false ), 'variant-style-bold' ).checked ).toBe( false );

		// Only the entry is ever on: a group it sits in is not a state of its own.
		const nested = fieldWith( { checked: true, submenu: [ { id: 'variant-style-italic' } ] } );
		expect( getMenuItemState( nested, 'variant-style-italic' ).checked ).toBe( false );
	} );

	it( 'reports nothing for a field with no menu to read', () => {
		// MathLive throws "Mathfield not mounted" when asked too early or after teardown.
		const unmounted = { get menuItems(): never {
			throw new Error( 'Mathfield not mounted' );
		} } as MathLiveMenuField;

		expect( getMenuItemState( unmounted, 'delete-row' ) ).toEqual( MENU_ITEM_UNAVAILABLE );
		expect( getMenuItemState( {}, 'delete-row' ) ).toEqual( MENU_ITEM_UNAVAILABLE );
	} );
} );

describe( 'getMenuItemLabel', () => {
	it( 'reads what MathLive calls the action, nested or not, dynamic or not', () => {
		const field = fieldWith(
			{ id: 'delete-row', label: () => 'Delete row' },
			{ submenu: [ { id: 'environment-braces', label: '{⋱}' } ] }
		);

		expect( getMenuItemLabel( field, 'delete-row' ) ).toBe( 'Delete row' );
		expect( getMenuItemLabel( field, 'environment-braces' ) ).toBe( '{⋱}' );
	} );

	it( 'has nothing to report for an unknown id, or a label-less entry', () => {
		expect( getMenuItemLabel( fieldWith( { id: 'delete-row' } ), 'delete-row' ) ).toBeNull();
		expect( getMenuItemLabel( fieldWith(), 'delete-row' ) ).toBeNull();
	} );
} );

describe( 'runMenuItem', () => {
	it( 'calls the entry\'s own handler, nested or not, with no modifier held', () => {
		const onMenuSelect = vi.fn();
		const field = fieldWith( { submenu: [ { id: 'insert-abs', onMenuSelect } ] } );

		expect( runMenuItem( field, 'insert-abs' ) ).toBe( true );
		expect( onMenuSelect ).toHaveBeenCalledWith( {
			target: undefined,
			modifiers: { alt: false, control: false, shift: false, meta: false },
			id: 'insert-abs'
		} );
	} );

	it( 'reports back when there is no such entry, or it has no handler', () => {
		expect( runMenuItem( fieldWith( { id: 'insert-abs' } ), 'insert-abs' ) ).toBe( false );
		expect( runMenuItem( fieldWith(), 'insert-abs' ) ).toBe( false );
	} );
} );
