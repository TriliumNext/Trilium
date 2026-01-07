import { ClassicEditor, type EditorConfig } from 'ckeditor5';
import MathUI from '../src/mathui';
import { describe, beforeEach, it, afterEach, expect } from "vitest";

// Suppress MathLive errors during async cleanup
if (typeof window !== 'undefined') {
	window.addEventListener('unhandledrejection', event => {
		if (event.reason?.message?.includes('options') || event.reason?.message?.includes('mathlive')) {
			event.preventDefault();
		}
	});
	window.addEventListener('error', event => {
		if (event.message?.includes('options') || event.message?.includes('mathlive')) {
			event.preventDefault();
		}
	});
}

describe( 'Lazy load', () => {
	let editorElement: HTMLDivElement;
	let editor: ClassicEditor;
	let lazyLoadInvoked: boolean;
	let mathUIFeature: MathUI;

	function buildEditor( config: EditorConfig ) {
		return ClassicEditor
			.create( editorElement, {
				...config,
				licenseKey: "GPL",
				plugins: [ MathUI ]
			} )
			.then( newEditor => {
				editor = newEditor;
				mathUIFeature = editor.plugins.get( MathUI );
			} );
	}

	beforeEach( () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );
		lazyLoadInvoked = false;
	} );

	afterEach( async () => {
		if ( mathUIFeature?.formView ) {
			mathUIFeature._hideUI();
		}
		await new Promise( resolve => setTimeout( resolve, 50 ) );
		editorElement.remove();
		return editor.destroy();
	} );

	it( 'initializes lazy load for KaTeX', async () => {
		await buildEditor( {
			math: {
				engine: 'katex',
				enablePreview: true,
				lazyLoad: async () => {
					lazyLoadInvoked = true;
				}
			}
		} );

		mathUIFeature._showUI();

		// Trigger render with a non-empty value to bypass empty check optimization
		if ( mathUIFeature.formView ) {
			mathUIFeature.formView.equation = 'x^2';
		}

		// Wait for async rendering and lazy loading
		await new Promise( resolve => setTimeout( resolve, 100 ) );

		expect( lazyLoadInvoked ).to.be.true;
	} );
} );
