// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { ClassicEditor, Paragraph, type EditorConfig } from 'ckeditor5';
import MathUI from './math_ui.js';
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
				plugins: [ MathUI, Paragraph ]
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

		// Inserting an equation renders the widget preview, which goes through the lazy loader.
		expect( mathUIFeature ).to.not.be.undefined;
		editor.execute( 'math', 'x^2', false );

		// Wait for async rendering and lazy loading
		await new Promise( resolve => setTimeout( resolve, 100 ) );

		expect( lazyLoadInvoked ).to.be.true;
	} );
} );
