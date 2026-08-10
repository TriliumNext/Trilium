// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import katex from 'katex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MathJax2, MathJax3 } from './typings_external.js';
import { renderEquation } from './utils.js';

/**
 * `renderEquation` reads its engines off the globals (`window.katex`, `MathJax`) and caches the
 * lazy-load promise on `window.CKEDITOR_MATH_LAZY_LOAD`, so each test installs what it needs and
 * the teardown puts the globals back.
 */
describe( 'renderEquation', () => {
	let element: HTMLDivElement;

	const globals = window as unknown as {
		katex: typeof katex | undefined;
		MathJax: MathJax2 | MathJax3 | undefined;
		CKEDITOR_MATH_LAZY_LOAD: Promise<void> | undefined;
	};

	const originalKatex = globals.katex;
	const originalMathJax = globals.MathJax;

	beforeEach( () => {
		element = document.createElement( 'div' );
		document.body.appendChild( element );
		globals.CKEDITOR_MATH_LAZY_LOAD = undefined;
	} );

	afterEach( () => {
		element.remove();
		globals.katex = originalKatex;
		globals.MathJax = originalMathJax;
		globals.CKEDITOR_MATH_LAZY_LOAD = undefined;
		document.querySelectorAll( '[id^="preview-"]' ).forEach( node => node.remove() );
		vi.restoreAllMocks();
	} );

	describe( 'the katex engine', () => {
		beforeEach( () => {
			globals.katex = katex;
		} );

		it( 'renders into the element itself when not previewing', async () => {
			await renderEquation( 'x^2', element, 'katex' );

			expect( element.querySelector( '.katex' ) ).not.toBeNull();
		} );

		it( 'renders display mode when asked', async () => {
			await renderEquation( 'x^2', element, 'katex', undefined, true );

			expect( element.querySelector( '.katex-display' ) ).not.toBeNull();
		} );

		it( 'renders into a generated preview element and reveals it', async () => {
			await renderEquation( 'x^2', element, 'katex', undefined, false, true, 'preview-a', [ 'cls-a', 'cls-b' ] );

			const preview = document.getElementById( 'preview-a' );
			expect( preview ).not.toBeNull();
			expect( preview?.classList.contains( 'cls-a' ) ).toBe( true );
			expect( preview?.classList.contains( 'cls-b' ) ).toBe( true );
			expect( preview?.style.visibility ).toBe( 'visible' );
		} );

		it( 'reuses an existing preview element rather than making a second one', async () => {
			await renderEquation( 'x^2', element, 'katex', undefined, false, true, 'preview-b', [] );
			await renderEquation( 'y^2', element, 'katex', undefined, false, true, 'preview-b', [] );

			expect( document.querySelectorAll( '#preview-b' ) ).toHaveLength( 1 );
		} );
	} );

	describe( 'a custom engine function', () => {
		it( 'is called with the equation, element and display flag', async () => {
			const engine = vi.fn();

			await renderEquation( 'x^2', element, engine, undefined, true );

			expect( engine ).toHaveBeenCalledWith( 'x^2', element, true );
		} );
	} );

	describe( 'the mathjax 3 engine', () => {
		it( 'renders through tex2chtmlPromise and replaces any previous child', async () => {
			const rendered = document.createElement( 'span' );
			rendered.textContent = 'chtml';
			const tex2chtmlPromise = vi.fn().mockResolvedValue( rendered );
			globals.MathJax = { version: '3.2.2', tex2chtmlPromise } as unknown as MathJax3;
			element.appendChild( document.createElement( 'b' ) );

			await renderEquation( 'x^2', element, 'mathjax' );
			await tex2chtmlPromise.mock.results[ 0 ]?.value;

			expect( tex2chtmlPromise ).toHaveBeenCalledWith( 'x^2', { display: false } );
			expect( element.querySelector( 'b' ) ).toBeNull();
			expect( element.textContent ).toBe( 'chtml' );
		} );

		it( 'falls back to tex2svgPromise', async () => {
			const rendered = document.createElement( 'span' );
			const tex2svgPromise = vi.fn().mockResolvedValue( rendered );
			globals.MathJax = { version: '3.2.2', tex2svgPromise } as unknown as MathJax3;

			await renderEquation( 'x^2', element, 'mathjax' );
			await tex2svgPromise.mock.results[ 0 ]?.value;

			expect( tex2svgPromise ).toHaveBeenCalled();
		} );

		it( 'reveals the preview element once rendering resolves', async () => {
			const tex2chtmlPromise = vi.fn().mockResolvedValue( document.createElement( 'span' ) );
			globals.MathJax = { version: '3.2.2', tex2chtmlPromise } as unknown as MathJax3;

			await renderEquation( 'x^2', element, 'mathjax', undefined, false, true, 'preview-c', [] );
			await tex2chtmlPromise.mock.results[ 0 ]?.value;

			expect( document.getElementById( 'preview-c' )?.style.visibility ).toBe( 'visible' );
		} );

		it( 'does nothing when neither promise function is available', async () => {
			globals.MathJax = { version: '3.2.2' } as unknown as MathJax3;

			await renderEquation( 'x^2', element, 'mathjax' );

			expect( element.innerHTML ).toBe( '' );
		} );
	} );

	describe( 'the mathjax 2 engine', () => {
		it( 'wraps the equation in inline delimiters and queues a typeset', async () => {
			const Queue = vi.fn();
			globals.MathJax = { Hub: { Queue } } as unknown as MathJax2;

			await renderEquation( 'x^2', element, 'mathjax' );
			await vi.waitFor( () => expect( Queue ).toHaveBeenCalled() );

			expect( element.innerHTML ).toBe( '\\(x^2\\)' );
		} );

		it( 'wraps the equation in display delimiters when display is set', async () => {
			const Queue = vi.fn();
			globals.MathJax = { Hub: { Queue } } as unknown as MathJax2;

			await renderEquation( 'x^2', element, 'mathjax', undefined, true );
			await vi.waitFor( () => expect( Queue ).toHaveBeenCalled() );

			expect( element.innerHTML ).toBe( '\\[x^2\\]' );
		} );

		it( 'queues the preview reveal behind the typeset', async () => {
			const queued: Array<unknown> = [];
			const Queue = vi.fn( ( arg: unknown ) => queued.push( arg ) );
			globals.MathJax = { Hub: { Queue } } as unknown as MathJax2;

			await renderEquation( 'x^2', element, 'mathjax', undefined, false, true, 'preview-d', [] );
			await vi.waitFor( () => expect( Queue ).toHaveBeenCalledTimes( 2 ) );

			// The second queued entry is the callback that reveals the preview.
			const reveal = queued[ 1 ];
			expect( typeof reveal ).toBe( 'function' );
			( reveal as () => void )();
			expect( document.getElementById( 'preview-d' )?.style.visibility ).toBe( 'visible' );
		} );

		it( 'does nothing when MathJax is absent entirely', async () => {
			globals.MathJax = undefined;

			await renderEquation( 'x^2', element, 'mathjax' );
			await vi.waitFor( () => expect( element.innerHTML ).toBe( '' ) );
		} );
	} );

	describe( 'lazy loading', () => {
		it( 'shows the raw equation, awaits the loader, then re-renders', async () => {
			globals.katex = undefined;
			const lazyLoad = vi.fn( async () => {
				globals.katex = katex;
			} );

			await renderEquation( 'x^2', element, 'katex', lazyLoad );

			expect( lazyLoad ).toHaveBeenCalledTimes( 1 );
			expect( element.querySelector( '.katex' ) ).not.toBeNull();
		} );

		it( 'only runs the loader once across calls', async () => {
			globals.katex = undefined;
			const lazyLoad = vi.fn( async () => {
				globals.katex = katex;
			} );

			await renderEquation( 'x^2', element, 'katex', lazyLoad );
			globals.katex = undefined;
			await renderEquation( 'y^2', element, 'katex', lazyLoad );

			expect( lazyLoad ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'leaves the raw equation in place and logs when the loader rejects', async () => {
			globals.katex = undefined;
			const error = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
			const lazyLoad = vi.fn( () => Promise.reject( new Error( 'boom' ) ) );

			await renderEquation( 'x^2', element, 'katex', lazyLoad );

			expect( element.innerHTML ).toBe( 'x^2' );
			expect( error ).toHaveBeenCalledWith( expect.stringContaining( 'math-tex-typesetting-lazy-load-failed' ) );
		} );

		it( 'leaves the raw equation in place and warns when there is no loader', async () => {
			globals.katex = undefined;
			const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );

			await renderEquation( 'x^2', element, 'katex' );

			expect( element.innerHTML ).toBe( 'x^2' );
			expect( warn ).toHaveBeenCalledWith( expect.stringContaining( 'math-tex-typesetting-missing' ) );
		} );
	} );
} );
