// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import katex from 'katex';
import { renderEquation } from './utils.js';
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
	// (`Object.create( null )`). KaTeX <= 0.17 called `macros.hasOwnProperty()` directly while
	// expanding macros and threw "hasOwnProperty is not a function" on such an object; 0.18 moved to
	// `Object.prototype.hasOwnProperty.call()`, so the crash is gone upstream. Either way the
	// normalization runs and the formula has to render.
	it( 'renders with a prototype-less macros object (as produced by CKEditor config)', async () => {
		const macros = Object.assign( Object.create( null ), { '\\differentialD': '\\mathrm{d}' } );

		await renderEquation( '\\int f(x) \\differentialD x', element, 'katex', undefined, false, false, '', [], { macros } );

		expect( element.querySelector( '.katex' ) ).to.not.be.null;
		expect( element.textContent ?? '' ).to.not.contain( 'hasOwnProperty' );
	} );

	// KaTeX writes `\gdef` definitions straight into the `macros` object it is handed, and Trilium
	// passes the shared `KATEX_MACROS` constant by reference, so one note's `\gdef` must not leak
	// into every later render in the session. This is what keeps the normalization load-bearing now
	// that KaTeX itself tolerates prototype-less macros.
	it( 'keeps a \\gdef out of the caller\'s macros object', async () => {
		const macros = { '\\differentialD': '\\mathrm{d}' };

		await renderEquation( '\\gdef\\leaked{42}\\leaked', element, 'katex', undefined, false, false, '', [], { macros } );

		expect( Object.keys( macros ) ).to.deep.equal( [ '\\differentialD' ] );
	} );

	it( 'renders without any custom macros', async () => {
		await renderEquation( 'x^2', element, 'katex', undefined, false, false, '', [], {} );

		expect( element.querySelector( '.katex' ) ).to.not.be.null;
	} );
} );
