import { describe, expect, it } from 'vitest';
import { getMathLive, loadMathLive, renderMathMarkup, renderStaticMath } from './mathlive_loader.js';

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

describe( 'mathlive_loader', () => {
	// Order matters: this must run before anything awaits loadMathLive(), so the module is
	// still unloaded and the plain-text fallback path is observable.
	it( 'shows plain LaTeX until the library loads, then upgrades in place', async () => {
		const element = document.createElement( 'span' );
		document.body.appendChild( element );

		renderStaticMath( element, 'x^2', false );
		expect( element.textContent ).toBe( 'x^2' );

		await waitFor( () => element.querySelector( '[class*="ML__"]' ) );
		element.remove();
	} );

	it( 'loads MathLive once and exposes the module and the custom element', async () => {
		expect( await loadMathLive() ).toBe( true );
		expect( getMathLive() ).not.toBeNull();
		expect( customElements.get( 'math-field' ) ).toBeDefined();
	} );

	it( 'renders inline equations in textstyle, display equations in displaystyle', async () => {
		// convertLatexToMarkup ignores `defaultMode: 'inline-math'` and renders everything
		// displaystyle; without the explicit \textstyle switch, an inline fraction was larger
		// in the preview than in the mounted field and visibly shrank when editing started.
		await loadMathLive();

		const numeratorFontSize = ( display: boolean ): number => {
			const el = document.createElement( 'span' );
			el.style.fontSize = '16px';
			document.body.appendChild( el );
			renderStaticMath( el, '\\frac{a}{b}', display );
			const glyph = Array.from( el.querySelectorAll( 'span' ) )
				.find( span => span.textContent === 'a' && span.children.length === 0 );
			if ( !glyph ) {
				throw new Error( 'numerator glyph not found' );
			}
			const size = parseFloat( getComputedStyle( glyph ).fontSize );
			el.remove();
			return size;
		};

		expect( numeratorFontSize( false ) ).toBeLessThan( 16 );
		expect( numeratorFontSize( true ) ).toBe( 16 );
	} );

	it( 'renders inline and display markup once loaded', async () => {
		await loadMathLive();

		const inline = document.createElement( 'span' );
		renderStaticMath( inline, '\\frac{a}{b}', false );
		expect( inline.querySelector( '[class*="ML__"]' ) ).not.toBeNull();

		const display = document.createElement( 'div' );
		renderStaticMath( display, '\\sum_{i=0}^n i', true );
		expect( display.querySelector( '[class*="ML__"]' ) ).not.toBeNull();

		// The stamps drive race-safe re-rendering after a late load.
		expect( display.dataset.equation ).toBe( '\\sum_{i=0}^n i' );
		expect( display.dataset.display ).toBe( 'true' );
	} );

	it( 'hands back markup for a preview, and the source itself where it cannot', async () => {
		await loadMathLive();

		expect( renderMathMarkup( '\\nabla' ) ).toContain( 'ML__latex' );

		// A malformed entry shows its source rather than taking the balloon down with it.
		expect( renderMathMarkup( '\\begin{matrix}' ) ).toBeTruthy();
	} );
} );
