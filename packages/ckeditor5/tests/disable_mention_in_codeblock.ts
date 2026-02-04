import { ClassicEditor, CodeBlock, Mention } from 'ckeditor5';
import DisableMentionInCodeBlock from '../src/plugins/disable_mention_in_codeblock.js';
import { describe, beforeEach, it, afterEach, expect } from "vitest";

describe( 'DisableMentionInCodeBlock', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor
			.create( editorElement, {
				plugins: [ CodeBlock, Mention, DisableMentionInCodeBlock ],
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
		expect( editor.plugins.get( DisableMentionInCodeBlock ) ).to.instanceOf( DisableMentionInCodeBlock );
	} );

	it( 'has proper name', () => {
		expect( DisableMentionInCodeBlock.pluginName ).to.equal( 'DisableMentionInCodeBlock' );
	} );

	it( 'should prevent mention attribute inside code blocks', () => {
		const schema = editor.model.schema;

		// Test that mention attribute is disallowed in code block context
		const context = schema.createContext( [ 'codeBlock', '$text' ] );
		const isAllowed = schema.checkAttribute( context, 'mention' );

		expect( isAllowed ).to.be.false;
	} );

	it( 'should allow mention attribute outside code blocks', () => {
		const schema = editor.model.schema;

		// Test that mention attribute is still allowed in regular paragraphs
		const context = schema.createContext( [ 'paragraph', '$text' ] );
		const isAllowed = schema.checkAttribute( context, 'mention' );

		expect( isAllowed ).to.be.true;
	} );

	it( 'should allow mention attribute in list items', () => {
		const schema = editor.model.schema;

		// Test that mention attribute is still allowed in list items
		const context = schema.createContext( [ 'listItem', '$text' ] );
		const isAllowed = schema.checkAttribute( context, 'mention' );

		expect( isAllowed ).to.be.true;
	} );
} );
