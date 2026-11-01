// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import katex from 'katex';
import { Locale } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MathView, { type MathViewOptions } from './math_view.js';

describe( 'MathView', () => {
	let view: MathView;

	const globals = window as unknown as { katex: typeof katex | undefined };
	const originalKatex = globals.katex;

	function createView( overrides: Partial<MathViewOptions> = {} ): MathView {
		return new MathView( new Locale(), {
			engine: 'katex',
			lazyLoad: undefined,
			previewUid: 'preview-mathview',
			previewClassName: [],
			katexRenderOptions: {},
			...overrides
		} );
	}

	beforeEach( () => {
		globals.katex = katex;
	} );

	afterEach( () => {
		view?.destroy();
		globals.katex = originalKatex;
		document.getElementById( 'preview-mathview' )?.remove();
		vi.restoreAllMocks();
	} );

	it( 'renders an equation into its element', () => {
		view = createView();
		view.render();
		view.value = 'x^2';

		expect( view.element?.querySelector( '.katex' ) ?? view.element?.textContent ).toBeTruthy();
	} );

	it( 'clears the element for an empty equation', () => {
		view = createView();
		view.render();
		view.value = 'x^2';
		view.value = '   ';

		expect( view.element?.textContent ).toBe( '' );
		expect( view.element?.classList.contains( 'ck-math-render-error' ) ).toBe( false );
	} );

	it( 'does nothing before it is rendered', () => {
		view = createView();

		expect( () => view.updateMath() ).not.toThrow();
		expect( view.element ).toBeNull();
	} );

	it( 'reports a rendering failure on the element', async () => {
		const error = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		view = createView();
		view.render();

		// Force the render to reject: no engine and no lazy loader still resolves, so make the
		// element unavailable to the renderer instead.
		const failing = view as unknown as { options: { engine: unknown } };
		failing.options.engine = () => {
			throw new Error( 'boom' );
		};

		view.value = 'x^2';
		await vi.waitFor( () => expect( error ).toHaveBeenCalled() );

		expect( view.element?.textContent ).toBe( 'Error rendering equation' );
		expect( view.element?.classList.contains( 'ck-math-render-error' ) ).toBe( true );
	} );
} );
