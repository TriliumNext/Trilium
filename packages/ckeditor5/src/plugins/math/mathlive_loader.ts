// Shared MathLive access for the math plugin: one lazy load of the library, plus static markup
// rendering for equation previews. The editor renders equations with MathLive (not KaTeX) so a
// preview and a mounted <math-field> are pixel-identical, which is what makes promoting one to
// the other on cursor entry seamless. Reading mode and shared notes still render with KaTeX.
import 'mathlive/fonts.css';
import 'mathlive/static.css';

type MathLiveModule = typeof import( 'mathlive' );

let mathLiveModule: MathLiveModule | null = null;
let mathLiveLoad: Promise<boolean> | undefined;

export function loadMathLive(): Promise<boolean> {
	mathLiveLoad ??= ( async () => {
		try {
			const mod = await import( 'mathlive' );
			await customElements.whenDefined( 'math-field' );
			const mathfieldClass = customElements.get( 'math-field' ) as unknown as
				{ soundsDirectory: string | null; plonkSound: string | null } | undefined;
			if ( mathfieldClass ) {
				mathfieldClass.soundsDirectory = null;
				mathfieldClass.plonkSound = null;
			}
			mathLiveModule = mod;
			return true;
		} catch {
			return false;
		}
	} )();
	return mathLiveLoad;
}

/** The loaded module, or `null` before {@link loadMathLive} has resolved. */
export function getMathLive(): MathLiveModule | null {
	return mathLiveModule;
}

/**
 * Renders an equation into `element` as static MathLive markup. Until the library is loaded the
 * raw LaTeX shows as plain text; rendering an equation is also what triggers the load, so
 * MathLive is fetched exactly when a note first displays one. Re-renders race-safely: each call
 * stamps the element, and a late load re-reads the stamp instead of using its stale closure.
 */
export function renderStaticMath( element: HTMLElement, equation: string, display: boolean ): void {
	element.dataset.equation = equation;
	element.dataset.display = String( display );

	const mathlive = mathLiveModule;
	if ( !mathlive ) {
		element.textContent = equation;
		void loadMathLive().then( ok => {
			if ( ok && element.isConnected ) {
				renderStaticMath(
					element,
					element.dataset.equation ?? '',
					element.dataset.display === 'true'
				);
			}
		} );
		return;
	}

	try {
		// The explicit style switch, because `defaultMode: 'inline-math'` alone is silently
		// ignored by convertLatexToMarkup — everything renders displaystyle, so an inline
		// fraction came out larger in the preview than in the mounted field (which honors
		// its `defaultMode` and renders textstyle), and visibly shrank when editing started.
		const latex = display ? equation : `\\textstyle ${ equation }`;
		element.innerHTML = mathlive.convertLatexToMarkup( latex, {
			defaultMode: display ? 'math' : 'inline-math'
		} );
	} catch {
		element.textContent = equation;
	}
}
