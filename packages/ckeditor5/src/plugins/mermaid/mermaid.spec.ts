import { ClassicEditor, Essentials, Paragraph, Heading, _setModelData as setModelData } from 'ckeditor5';

import Mermaid from './mermaid.js';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { expect } from 'vitest';

/* global document */

describe( 'Mermaid', () => {
	it( 'should be named', () => {
		expect( Mermaid.pluginName ).to.equal( 'Mermaid' );
	} );

	describe( 'init()', () => {
		let domElement, editor;

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				licenseKey: "GPL",
				plugins: [
					Paragraph,
					Heading,
					Essentials,
					Mermaid
				],
				toolbar: [
					'mermaid'
				]
			} );

			setModelData( editor.model, '<paragraph>[]</paragraph>' );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'should add an icon to the toolbar', () => {
			expect( editor.ui.componentFactory.has( 'Mermaid' ) ).to.equal( true );
		} );
	} );
} );
