import { View, type Locale } from 'ckeditor5';
import type { KatexOptions } from '../typings-external.js';
import { renderEquation } from '../utils.js';

/**
 * Configuration options for the MathView.
 */
export interface MathViewOptions {
	engine: 'mathjax' | 'katex' | ( ( equation: string, element: HTMLElement, display: boolean ) => void );
	lazyLoad: undefined | ( () => Promise<void> );
	previewUid: string;
	previewClassName: Array<string>;
	katexRenderOptions: KatexOptions;
}

export default class MathView extends View {
	/**
	 * The LaTeX equation value to render.
	 * @observable
	 */
	public declare value: string;

	/**
	 * Whether to render in display mode (centered) or inline.
	 * @observable
	 */
	public declare display: boolean;

	/**
	 * Configuration options passed during initialization.
	 */
	private options: MathViewOptions;

	constructor( locale: Locale, options: MathViewOptions ) {
		super( locale );
		this.options = options;

		this.set( 'value', '' );
		this.set( 'display', false );

		// Update rendering when state changes.
		// Checking isRendered prevents errors during initialization.
		this.on( 'change', () => {
			if ( this.isRendered ) {
				this.updateMath();
			}
		} );

		this.setTemplate( {
			tag: 'div',
			attributes: {
				class: [ 'ck', 'ck-math-preview', 'ck-reset_all-excluded' ]
			}
		} );
	}

	public updateMath(): void {
		if ( !this.element ) {
			return;
		}

		// Handle empty equations
		if ( !this.value || !this.value.trim() ) {
			this.element.textContent = '';
			this.element.classList.remove( 'ck-math-render-error' );
			return;
		}

		// Clear previous render
		this.element.textContent = '';
		this.element.classList.remove( 'ck-math-render-error' );

		renderEquation(
			this.value,
			this.element,
			this.options.engine,
			this.options.lazyLoad,
			this.display,
			true, // isPreview
			this.options.previewUid,
			this.options.previewClassName,
			this.options.katexRenderOptions
		).catch( error => {
			console.error( 'Math rendering failed:', error );

			if ( this.element ) {
				this.element.textContent = 'Error rendering equation';
				this.element.classList.add( 'ck-math-render-error' );
			}
		} );
	}

	public override render(): void {
		super.render();
		this.updateMath();
	}
}
