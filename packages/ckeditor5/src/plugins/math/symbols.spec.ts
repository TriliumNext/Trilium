import { describe, expect, it } from 'vitest';

import { MATH_SYMBOL_SECTIONS } from './symbols.js';

describe( 'MATH_SYMBOL_SECTIONS', () => {
	it( 'is a set of named sections, each holding LaTeX commands and nothing else', () => {
		expect( MATH_SYMBOL_SECTIONS.length ).toBeGreaterThan( 0 );

		const ids = MATH_SYMBOL_SECTIONS.map( section => section.id );
		expect( new Set( ids ).size ).toBe( ids.length );

		for ( const { id, symbols } of MATH_SYMBOL_SECTIONS ) {
			expect( symbols.length, id ).toBeGreaterThan( 0 );

			// A gallery entry is a symbol to drop in at the caret, so none of these takes an
			// argument or opens a placeholder — those are structures, and belong to the insert
			// group instead.
			for ( const latex of symbols ) {
				expect( latex, id ).toMatch( /^\\[a-zA-Z]+(\{[A-Za-z]\})?$/ );
				expect( latex, id ).not.toContain( '#' );
			}
		}
	} );

	it( 'repeats a symbol only across sections, never within one', () => {
		// `\perp` is both a relation and a piece of geometry, and someone will look for it in
		// either — but twice in the same grid is a slip, not a second place to find it.
		for ( const { id, symbols } of MATH_SYMBOL_SECTIONS ) {
			expect( new Set( symbols ).size, id ).toBe( symbols.length );
		}
	} );
} );
