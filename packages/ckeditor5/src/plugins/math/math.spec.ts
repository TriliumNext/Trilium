import { ClassicEditor, Widget } from 'ckeditor5';
import Mathematics from './math.js';
import MathEditing from './math_editing.js';
import MathUI from './math_ui.js';
import { describe, beforeEach, it, afterEach, expect } from "vitest";

describe( 'Math', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor
			.create( editorElement, {
				plugins: [ Mathematics ],
				licenseKey: "GPL"
			} )
			.then( newEditor => {
				editor = newEditor;
			} );
	} );

	afterEach( () => {
		editorElement.remove();

		return editor.destroy();
	} );

	it( 'should be loaded', () => {
		expect( editor.plugins.get( Mathematics ) ).to.instanceOf( Mathematics );
	} );

	it( 'should load MathEditing plugin', () => {
		expect( editor.plugins.get( MathEditing ) ).to.instanceOf( MathEditing );
	} );

	it( 'should load Widget plugin', () => {
		expect( editor.plugins.get( Widget ) ).to.instanceOf( Widget );
	} );

	it( 'should load MathUI plugin', () => {
		expect( editor.plugins.get( MathUI ) ).to.instanceOf( MathUI );
	} );

	it( 'has proper name', () => {
		expect( Mathematics.pluginName ).to.equal( 'Math' );
	} );
} );
