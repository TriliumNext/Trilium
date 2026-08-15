import { describe, expect, it, vi } from 'vitest';

import { getMatrixActionState, MATRIX_ACTION_UNAVAILABLE, type MatrixMenuField } from './mathlive_matrix.js';

/** A stand-in for a `<math-field>`, carrying only the menu declarations we read. */
function fieldWith( ...menuItems: Array<Record<string, unknown>> ): MatrixMenuField {
	return { menuItems } as MatrixMenuField;
}

describe( 'getMatrixActionState', () => {
	it( 'reads visibility and enablement off the item of that id', () => {
		const field = fieldWith(
			{ id: 'delete-row', visible: () => true, enabled: () => false },
			{ id: 'delete-column', visible: () => true, enabled: () => true }
		);

		expect( getMatrixActionState( field, 'delete-row' ) ).toEqual( { visible: true, enabled: false } );
		expect( getMatrixActionState( field, 'delete-column' ) ).toEqual( { visible: true, enabled: true } );
	} );

	it( 'takes a plain value as readily as a predicate', () => {
		const field = fieldWith( { id: 'add-row-above', visible: true, enabled: false } );

		expect( getMatrixActionState( field, 'add-row-above' ) ).toEqual( { visible: true, enabled: false } );
	} );

	it( 'defaults either to true when the declaration omits it, as MathLive does', () => {
		const field = fieldWith( { id: 'add-column-after' } );

		expect( getMatrixActionState( field, 'add-column-after' ) ).toEqual( { visible: true, enabled: true } );
	} );

	it( 'never reports an invisible action as enabled', () => {
		const field = fieldWith( { id: 'add-row-below', visible: () => false, enabled: () => true } );

		expect( getMatrixActionState( field, 'add-row-below' ) ).toEqual( { visible: false, enabled: false } );
	} );

	it( 'asks the predicates with no modifier held', () => {
		const visible = vi.fn().mockReturnValue( true );
		const field = fieldWith( { id: 'delete-row', visible } );

		getMatrixActionState( field, 'delete-row' );

		expect( visible ).toHaveBeenCalledWith( { alt: false, control: false, shift: false, meta: false } );
	} );

	it( 'reports nothing for an id the menu does not carry', () => {
		expect( getMatrixActionState( fieldWith( { id: 'copy' } ), 'delete-row' ) )
			.toEqual( MATRIX_ACTION_UNAVAILABLE );
		expect( getMatrixActionState( fieldWith(), 'delete-row' ) ).toEqual( MATRIX_ACTION_UNAVAILABLE );
	} );

	it( 'reports nothing for a field with no menu to read', () => {
		// MathLive throws "Mathfield not mounted" when asked too early or after teardown.
		const unmounted = { get menuItems(): never {
			throw new Error( 'Mathfield not mounted' );
		} } as MatrixMenuField;

		expect( getMatrixActionState( unmounted, 'delete-row' ) ).toEqual( MATRIX_ACTION_UNAVAILABLE );
		expect( getMatrixActionState( {}, 'delete-row' ) ).toEqual( MATRIX_ACTION_UNAVAILABLE );
	} );
} );
