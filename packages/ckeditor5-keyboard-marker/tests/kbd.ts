import { ClassicEditor, Paragraph } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { icons, Kbd, KbdEditing, KbdUI } from '../src/index.js';

describe( 'Kbd', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		editor = await ClassicEditor.create( editorElement, {
			plugins: [ Paragraph, Kbd ],
			licenseKey: 'GPL'
		} );
	} );

	afterEach( async () => {
		editorElement.remove();

		await editor.destroy();
	} );

	it( 'loads the glue plugin and its editing/UI parts', () => {
		expect( editor.plugins.get( Kbd ) ).toBeInstanceOf( Kbd );
		expect( editor.plugins.get( KbdEditing ) ).toBeInstanceOf( KbdEditing );
		expect( editor.plugins.get( KbdUI ) ).toBeInstanceOf( KbdUI );
		expect( Kbd.pluginName ).toBe( 'Kbd' );
		expect( icons.kbdIcon ).toContain( '<svg' );
	} );

	it( 'allows the kbd attribute on text and marks it as formatting', () => {
		expect( editor.model.schema.checkAttribute( '$text', 'kbd' ) ).toBe( true );

		// Regression guard: kbd is a discrete inline token, so pressing Enter must NOT
		// carry the formatting onto the next paragraph (mirrors inline `code`, unlike bold/italic).
		expect( editor.model.schema.getAttributeProperties( 'kbd' ) ).toEqual( {
			isFormatting: true,
			copyOnEnter: false
		} );
	} );

	it( 'downcasts the kbd attribute to a <kbd> element with spellcheck disabled', () => {
		editor.setData( '<p>Ctrl</p>' );

		const root = editor.model.document.getRoot();
		editor.model.change( writer => {
			writer.setSelection( root?.getChild( 0 ) ?? null, 'in' );
		} );
		editor.execute( 'kbd' );

		expect( editor.getData() ).toBe( '<p><kbd spellcheck="false">Ctrl</kbd></p>' );
	} );

	it( 'upcasts a <kbd> element back to the kbd attribute', () => {
		editor.setData( '<p>Press <kbd spellcheck="false">Ctrl</kbd>.</p>' );

		expect( editor.getData() ).toBe( '<p>Press <kbd spellcheck="false">Ctrl</kbd>.</p>' );
	} );

	it( 'registers the toolbar button bound to the command', () => {
		const button = editor.ui.componentFactory.create( 'kbd' );
		const command = editor.commands.get( 'kbd' );

		expect( button.isToggleable ).toBe( true );
		expect( button.isOn ).toBe( false );

		button.fire( 'execute' );

		expect( command?.value ).toBe( true );
	} );
} );
