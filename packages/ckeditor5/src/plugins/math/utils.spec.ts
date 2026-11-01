// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MathJax2 } from './typings_external.js';
import {
	extractDelimiters,
	hasDelimiters,
	isMathJaxVersion2,
	isMathJaxVersion3,
	renderEquation
} from './utils.js';

describe( 'utils: delimiter helpers', () => {
	describe( 'hasDelimiters', () => {
		it( 'matches a fully delimited display equation', () => {
			expect( hasDelimiters( '\\[x^2\\]' ) ).not.toBeNull();
		} );

		it( 'matches a fully delimited inline equation', () => {
			expect( hasDelimiters( '\\(x^2\\)' ) ).not.toBeNull();
		} );

		it( 'does not match bare or partially delimited text', () => {
			expect( hasDelimiters( 'x^2' ) ).toBeNull();
			expect( hasDelimiters( '\\[x^2' ) ).toBeNull();
			expect( hasDelimiters( 'lead \\[x^2\\]' ) ).toBeNull();
		} );
	} );

	describe( 'extractDelimiters', () => {
		it( 'strips display delimiters and reports display mode', () => {
			expect( extractDelimiters( '\\[x^2\\]' ) ).toEqual( { equation: 'x^2', display: true } );
		} );

		it( 'strips inline delimiters and reports inline mode', () => {
			expect( extractDelimiters( '\\(x^2\\)' ) ).toEqual( { equation: 'x^2', display: false } );
		} );

		it( 'trims surrounding and inner whitespace', () => {
			expect( extractDelimiters( '  \\[ x^2 \\]  ' ) ).toEqual( { equation: 'x^2', display: true } );
		} );

		it( 'leaves an undelimited equation untouched', () => {
			expect( extractDelimiters( ' x^2 ' ) ).toEqual( { equation: 'x^2', display: false } );
		} );
	} );
} );

describe( 'utils: MathJax version detection', () => {
	it( 'recognises a MathJax 3 object by its three-part version starting with 3', () => {
		expect( isMathJaxVersion3( { version: '3.2.2' } ) ).toBe( true );
	} );

	it( 'rejects anything that is not MathJax 3', () => {
		expect( isMathJaxVersion3( undefined ) ).toBe( false );
		expect( isMathJaxVersion3( null ) ).toBe( false );
		expect( isMathJaxVersion3( '3.2.2' ) ).toBe( false );
		expect( isMathJaxVersion3( {} ) ).toBe( false );
		expect( isMathJaxVersion3( { version: 3 } ) ).toBe( false );
		expect( isMathJaxVersion3( { version: '3.2' } ) ).toBe( false );
		expect( isMathJaxVersion3( { version: '2.7.9' } ) ).toBe( false );
	} );

	it( 'recognises a MathJax 2 object by its Hub', () => {
		expect( isMathJaxVersion2( { Hub: {} } ) ).toBe( true );
	} );

	it( 'rejects anything without a Hub', () => {
		expect( isMathJaxVersion2( undefined ) ).toBe( false );
		expect( isMathJaxVersion2( null ) ).toBe( false );
		expect( isMathJaxVersion2( 'Hub' ) ).toBe( false );
		expect( isMathJaxVersion2( {} ) ).toBe( false );
	} );
} );

describe( 'utils: rendering through MathJax 2', () => {
	/** What MathJax 2 is, as far as the renderer is concerned: a Hub with a queue. */
	function installMathJax2() {
		const queue = vi.fn();
		globalThis.MathJax = { Hub: { Queue: queue } } as unknown as MathJax2;
		return queue;
	}

	afterEach( () => {
		globalThis.MathJax = undefined;
	} );

	it( 'hands the equation to the Hub as delimited text, display and inline alike', async () => {
		const queue = installMathJax2();
		const element = document.createElement( 'span' );

		// Text rather than markup: MathJax 2 typesets by scanning text nodes for the delimiters.
		await renderEquation( 'x^2', element, 'mathjax', undefined, true );
		await vi.waitFor( () => expect( element.textContent ).toBe( '\\[x^2\\]' ) );

		await renderEquation( 'x^2', element, 'mathjax', undefined, false );
		await vi.waitFor( () => expect( element.textContent ).toBe( '\\(x^2\\)' ) );

		expect( queue ).toHaveBeenCalledWith( [ 'Typeset', expect.anything(), element ] );
	} );

	it( 'leaves the element alone where MathJax never arrived', async () => {
		const element = document.createElement( 'span' );
		element.textContent = 'untouched';

		// The renderer falls through to MathJax 2 whenever MathJax is not version 3, this build
		// included, so it has to answer for finding nothing there at all.
		await renderEquation( 'x^2', element, 'mathjax' );
		await new Promise( resolve => window.setTimeout( resolve ) );

		expect( element.textContent ).toBe( 'untouched' );
	} );
} );
