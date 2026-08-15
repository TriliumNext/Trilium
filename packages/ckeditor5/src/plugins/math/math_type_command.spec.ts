// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import { type ClassicEditor, Paragraph, Typing, _getModelData as getData, _setModelData as setData } from 'ckeditor5';
import { beforeEach, describe, expect, it } from 'vitest';

import Math from './math.js';
import type MathTypeCommand from './math_type_command.js';
import { createTestEditor } from '../../../test/editor-kit.js';

const INLINE_WIDGET = '<mathtex-inline display="false" equation="x^2" type="span"></mathtex-inline>';
const DISPLAY_WIDGET = '<mathtex-display display="true" equation="x^2" type="span"></mathtex-display>';

describe( 'MathTypeCommand', () => {
	let editor: ClassicEditor;
	let inlineCommand: MathTypeCommand;
	let displayCommand: MathTypeCommand;

	beforeEach( async () => {
		editor = await createTestEditor( [ Math, Paragraph, Typing ] );
		inlineCommand = editor.commands.get( 'mathTypeInline' ) as MathTypeCommand;
		displayCommand = editor.commands.get( 'mathTypeDisplay' ) as MathTypeCommand;
	} );

	it( 'is registered under both names', () => {
		expect( inlineCommand ).toBeDefined();
		expect( displayCommand ).toBeDefined();
	} );

	it( 'reports which form the selected equation is in, and enables both directions', () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		expect( inlineCommand.value ).toBe( true );
		expect( displayCommand.value ).toBe( false );
		expect( inlineCommand.isEnabled ).toBe( true );
		expect( displayCommand.isEnabled ).toBe( true );
	} );

	it( 'is disabled with no equation in play', () => {
		setData( editor.model, '<paragraph>foo[]bar</paragraph>' );

		expect( inlineCommand.isEnabled ).toBe( false );
		expect( displayCommand.isEnabled ).toBe( false );
		expect( inlineCommand.value ).toBe( false );
	} );

	it( 'converts inline to display, keeping the equation and selecting the result', () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );

		const newElement = displayCommand.execute();

		const data = getData( editor.model );
		expect( data ).toContain( '<mathtex-display' );
		expect( data ).not.toContain( '<mathtex-inline' );
		expect( data ).toContain( 'equation="x^2"' );
		expect( data ).toContain( 'display="true"' );
		// The block equation split the paragraph it sat in, and came out selected.
		expect( data ).toMatch( /<paragraph>foo<\/paragraph>\[<mathtex-display[\s\S]*?<\/mathtex-display>]<paragraph>bar<\/paragraph>/ );
		expect( newElement?.name ).toBe( 'mathtex-display' );
		expect( newElement?.getAttribute( 'type' ) ).toBe( 'span' );
	} );

	it( 'converts display back to inline, wrapping it in a paragraph of its own', () => {
		setData( editor.model, `[${ DISPLAY_WIDGET }]` );

		expect( inlineCommand.isEnabled ).toBe( true );
		inlineCommand.execute();

		const data = getData( editor.model );
		expect( data ).toContain( '<paragraph>' );
		expect( data ).toContain( '<mathtex-inline' );
		expect( data ).toContain( 'display="false"' );
	} );

	it( 'drops attributes the target form does not allow', () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );
		editor.model.change( writer => {
			const element = editor.model.document.selection.getSelectedElement();
			if ( element ) {
				writer.setAttribute( 'fontBackgroundColor', 'red', element );
			}
		} );
		expect( getData( editor.model ) ).toContain( 'fontBackgroundColor' );

		displayCommand.execute();

		// `mathtex-display` allows fontColor but not fontBackgroundColor.
		expect( getData( editor.model ) ).not.toContain( 'fontBackgroundColor' );
	} );

	it( 'is a no-op for the form the equation is already in', () => {
		setData( editor.model, `<paragraph>foo[${ INLINE_WIDGET }]bar</paragraph>` );
		const before = getData( editor.model );

		expect( inlineCommand.execute() ).toBeNull();
		expect( getData( editor.model ) ).toBe( before );
	} );

	it( 'does nothing when there is no equation at all', () => {
		setData( editor.model, '<paragraph>foo[]bar</paragraph>' );

		// Being disabled, it never reaches our implementation: `Command` stops its own `execute`
		// event, which is why nothing (rather than `null`) comes back.
		expect( displayCommand.execute() ).toBeUndefined();
		expect( getData( editor.model ) ).toContain( '<paragraph>foo[]bar</paragraph>' );
	} );
} );
