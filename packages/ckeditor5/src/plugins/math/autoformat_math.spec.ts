import { Autoformat, ClassicEditor, Paragraph, Typing, _setModelData as setData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Side-effect import: declares the `math` key on EditorConfig used by the editor configs below.
import './math.js';

import AutoformatMath from './autoformat_math.js';
import Math from './math.js';
import MathUI from './math_ui.js';

describe( 'AutoformatMath', () => {
	let editorElement: HTMLDivElement, editor: ClassicEditor;

	async function createEditor( plugins: Array<unknown> ) {
		editorElement = document.createElement( 'div' );
		document.body.appendChild( editorElement );

		return ClassicEditor.create( editorElement, {
			plugins: plugins as never,
			licenseKey: 'GPL',
			math: {
				engine: ( equation: string, element: HTMLElement ) => {
					element.innerHTML = equation;
				}
			}
		} );
	}

	afterEach( async () => {
		editorElement.remove();
		await editor.destroy();
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	describe( 'with the Math feature loaded', () => {
		beforeEach( async () => {
			editor = await createEditor( [ Math, AutoformatMath, Autoformat, Typing, Paragraph ] );
		} );

		it( 'has proper name and requirements', () => {
			expect( AutoformatMath.pluginName ).to.equal( 'AutoformatMath' );
			expect( AutoformatMath.requires ).to.contain( Math );
			expect( AutoformatMath.requires ).to.contain( 'Autoformat' );
		} );

		it( 'turns `$$` at the start of a block into an equation prompt', () => {
			vi.useFakeTimers();
			const showUI = vi.spyOn( editor.plugins.get( MathUI ), '_showUI' ).mockImplementation( () => undefined );

			setData( editor.model, '<paragraph>[]</paragraph>' );
			editor.execute( 'insertText', { text: '$' } );
			editor.execute( 'insertText', { text: '$' } );
			editor.execute( 'insertText', { text: ' ' } );

			// The `$$` marker is consumed and the UI is opened on a short delay, once the
			// selection has settled.
			expect( showUI ).not.toHaveBeenCalled();
			vi.advanceTimersByTime( 50 );
			expect( showUI ).toHaveBeenCalled();
		} );

		it( 'turns `\\[` at the start of a block into a display equation prompt', () => {
			vi.useFakeTimers();
			const showUI = vi.spyOn( editor.plugins.get( MathUI ), '_showUI' ).mockImplementation( () => undefined );

			setData( editor.model, '<paragraph>[]</paragraph>' );
			editor.execute( 'insertText', { text: '\\' } );
			editor.execute( 'insertText', { text: '[' } );
			editor.execute( 'insertText', { text: ' ' } );

			vi.advanceTimersByTime( 50 );
			expect( showUI ).toHaveBeenCalled();
		} );

		it( 'does nothing when the math command is disabled', () => {
			vi.useFakeTimers();
			const showUI = vi.spyOn( editor.plugins.get( MathUI ), '_showUI' ).mockImplementation( () => undefined );
			editor.commands.get( 'math' )?.forceDisabled( 'test' );

			setData( editor.model, '<paragraph>[]</paragraph>' );
			editor.execute( 'insertText', { text: '$' } );
			editor.execute( 'insertText', { text: '$' } );
			editor.execute( 'insertText', { text: ' ' } );

			vi.advanceTimersByTime( 50 );
			expect( showUI ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'without the Math feature', () => {
		it( 'warns rather than throwing', async () => {
			const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => undefined );

			// `requires` pulls Math in, so the missing-feature warning is only reachable by
			// removing it from the plugin map after the fact.
			editor = await createEditor( [ Math, AutoformatMath, Autoformat, Typing, Paragraph ] );
			const plugins = editor.plugins as unknown as { has( name: string ): boolean };
			const originalHas = plugins.has.bind( plugins );
			plugins.has = ( name: string ) => name === 'Math' ? false : originalHas( name );

			editor.plugins.get( AutoformatMath ).init();

			expect( warn ).toHaveBeenCalled();
			plugins.has = originalHas;
		} );
	} );
} );
