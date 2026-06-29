import katex from 'katex';
import { renderEquation } from '../src/utils.js';
import { describe, beforeEach, afterEach, it, expect } from "vitest";

describe( 'renderEquation (KaTeX)', () => {
	let element: HTMLDivElement;
	const globalWithKatex = window as unknown as { katex: typeof katex | undefined };
	const originalKatex = globalWithKatex.katex;

	beforeEach( () => {
		// The lazy loader installs KaTeX on the global; renderEquation reads it from there.
		globalWithKatex.katex = katex;
		element = document.createElement( 'div' );
		document.body.appendChild( element );
	} );

	afterEach( () => {
		element.remove();
		globalWithKatex.katex = originalKatex;
	} );

	// Regression for #9523: CKEditor stores config objects with a null prototype
	// (`Object.create( null )`), and KaTeX calls `macros.hasOwnProperty()` directly while
	// expanding macros, which throws "hasOwnProperty is not a function" on such an object.
	it( 'renders with a prototype-less macros object (as produced by CKEditor config)', async () => {
		const macros = Object.assign( Object.create( null ), { '\\differentialD': '\\mathrm{d}' } );

		// Confirms the root cause: passing the raw null-prototype object straight to KaTeX throws.
		expect( () => katex.renderToString( '\\differentialD', { macros, throwOnError: true } ) ).to.throw();

		await renderEquation( '\\int f(x) \\differentialD x', element, 'katex', undefined, false, false, '', [], { macros } );

		// renderEquation normalizes the object, so the formula renders instead of erroring.
		expect( element.querySelector( '.katex' ) ).to.not.be.null;
		expect( element.textContent ?? '' ).to.not.contain( 'hasOwnProperty' );
	} );

	it( 'renders without any custom macros', async () => {
		await renderEquation( 'x^2', element, 'katex', undefined, false, false, '', [], {} );

		expect( element.querySelector( '.katex' ) ).to.not.be.null;
	} );
} );
