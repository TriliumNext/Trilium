import { describe, expect, it } from 'vitest';

import { MATH_STRUCTURE_SECTIONS } from './structures.js';

describe( 'MATH_STRUCTURE_SECTIONS', () => {
	it( 'is a set of named sections, each with a face and entries of its own', () => {
		const ids = MATH_STRUCTURE_SECTIONS.map( section => section.id );
		expect( new Set( ids ).size ).toBe( ids.length );

		for ( const { id, glyph, structures } of MATH_STRUCTURE_SECTIONS ) {
			expect( glyph, id ).toBeTruthy();
			expect( structures.length, id ).toBeGreaterThan( 0 );

			// Two entries drawing the same thing in one gallery is a slip, not a choice.
			const previews = structures.map( structure => structure.preview );
			expect( new Set( previews ).size, id ).toBe( previews.length );
		}
	} );

	it( 'keeps the placeholders to what is typed, never to what is drawn', () => {
		for ( const { id, structures } of MATH_STRUCTURE_SECTIONS ) {
			for ( const { insert, preview } of structures ) {
				// `#?` is MathLive's insertion token, not LaTeX: left in a preview it renders as
				// the literal characters rather than as anything, which is why a preview spells
				// its slots out with letters instead.
				expect( preview, `${ id }: ${ preview }` ).not.toContain( '#?' );

				// The selection token belongs to the accents, which wrap what is already there.
				// A gallery entry is dropped at the caret and has nothing to wrap.
				expect( insert, `${ id }: ${ preview }` ).not.toContain( '#@' );
			}
		}
	} );
} );
