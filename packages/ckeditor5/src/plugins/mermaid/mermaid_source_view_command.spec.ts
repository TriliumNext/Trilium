import { ClassicEditor, Paragraph, _setModelData as setModelData, _getModelData as getModelData } from 'ckeditor5';

import MermaidSourceViewCommand from './mermaid_source_view_command.js';
import MermaidEditing from './mermaid_editing.js';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { expect } from 'vitest';

/* global document */

describe( 'MermaidSourceViewCommand', () => {
	let domElement, editor, model, command;

	beforeEach( async () => {
		domElement = document.createElement( 'div' );
		document.body.appendChild( domElement );

		editor = await ClassicEditor.create( domElement, {
			licenseKey: "GPL",
			plugins: [
				MermaidEditing,
				Paragraph
			]
		} );

		model = editor.model;

		command = new MermaidSourceViewCommand( editor );
	} );

	afterEach( () => {
		domElement.remove();
		return editor.destroy();
	} );

	describe( '#value', () => {
		it( 'should be true when mermaid element has displayMode attribute equal to "preview"', () => {
			setModelData( model, '<mermaid displayMode="preview" source="foo"></mermaid>' );

			expect( command.value ).to.equal( false );
		} );

		it( 'should be false when mermaid element has displayMode attribute equal to "split"', () => {
			setModelData( model, '<mermaid displayMode="split" source="foo"></mermaid>' );

			expect( command.value ).to.equal( false );
		} );

		it( 'should be false when mermaid element has displayMode attribute equal to "source"', () => {
			setModelData( model, '<mermaid displayMode="source" source="foo"></mermaid>' );

			expect( command.value ).to.equal( true );
		} );
	} );

	describe( '#isEnabled', () => {
		describe( 'should be false', () => {
			it( 'when text is selected', () => {
				setModelData( model,
					'<paragraph>[foo]</paragraph>' +
					'<mermaid source="flowchart TB\nA --> B\nB --> C"></mermaid>'
				);

				expect( command.isEnabled ).to.be.false;
			} );

			it( 'when mermaid is part of the selection', () => {
				setModelData( model,
					'<paragraph>[foo</paragraph>' +
					'<mermaid source="flowchart TB\nA --> B\nB --> C"></mermaid>' +
					'<paragraph>b]az</paragraph>'
				);

				expect( command.isEnabled ).to.be.false;
			} );
		} );

		describe( 'should be true', () => {
			it( 'when selection is inside mermaid', () => {
				setModelData( model,
					'<paragraph>foo</paragraph>' +
					'<mermaid source="flowchart TB\nA --> B\nB --> C">[]</mermaid>'
				);

				expect( command.isEnabled ).to.be.true;
			} );

			it( 'when mermaid is selected', () => {
				setModelData( model,
					'<paragraph>foo</paragraph>' +
					'[<mermaid source="flowchart TB\nA --> B\nB --> C"></mermaid>]'
				);

				expect( command.isEnabled ).to.be.true;
			} );
		} );
	} );

	describe( 'execute()', () => {
		it( 'should add text', () => {
			setModelData( model,
				'[<mermaid displayMode="preview" source="foo"></mermaid>]'
			);

			command.execute();

			expect( getModelData( model ) ).to.equal(
				'[<mermaid displayMode="source" source="foo"></mermaid>]'
			);
		} );
	} );

	describe( "#execute() edge cases", () => {
		it( "resolves the mermaid from the caret when nothing is selected", () => {
			setModelData( model, '<mermaid displayMode="split" source="foo">[]</mermaid>' );

			command.execute();

			expect( getModelData( model, { withoutSelection: true } ) )
				.to.equal( `<mermaid displayMode="source" source="foo"></mermaid>` );
		} );

		it( "leaves a mermaid already in source mode untouched", () => {
			setModelData( model, `[<mermaid displayMode="source" source="foo"></mermaid>]` );
			const before = getModelData( model, { withoutSelection: true } );

			command.execute();

			expect( getModelData( model, { withoutSelection: true } ) ).to.equal( before );
		} );

		it( "does nothing when no mermaid is selected", () => {
			setModelData( model, "<paragraph>foo[]</paragraph>" );
			const before = getModelData( model, { withoutSelection: true } );

			// CKEditor blocks execute() on a disabled command, and this command disables itself
			// when nothing is selected — so force it through to exercise the guard itself.
			command.isEnabled = true;
			command.execute();

			expect( getModelData( model, { withoutSelection: true } ) ).to.equal( before );
		} );
	} );
} );
