import { ClassicEditor, CodeBlockEditing, Essentials, Paragraph, _getModelData as getModelData, _setModelData as setModelData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MermaidEditing from './mermaid_editing.js';

/* global document */

/**
 * The converters all begin by asking whether someone else has already claimed the item. Those
 * guards only fire when another converter of higher priority consumed it first, so each test
 * here registers exactly such a competitor.
 */
describe( 'MermaidEditing converter guards', () => {
	let domElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( () => {
		domElement = document.createElement( 'div' );
		document.body.appendChild( domElement );
	} );

	afterEach( async () => {
		domElement.remove();
		await editor?.destroy();
	} );

	async function createEditor( extraPlugins: unknown[] = [] ) {
		return ClassicEditor.create( domElement, {
			licenseKey: 'GPL',
			plugins: [ Paragraph, Essentials, CodeBlockEditing, MermaidEditing, ...extraPlugins ] as never
		} ) as Promise<ClassicEditor>;
	}

	it( 'skips the data downcast when another converter already consumed the item', async () => {
		editor = await createEditor();

		editor.data.downcastDispatcher.on( 'insert:mermaid', ( evt, data, conversionApi ) => {
			conversionApi.consumable.consume( data.item, 'insert' );
		}, { priority: 'highest' } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="graph TD;"></mermaid>]' );

		// Ours bailed out, so nothing of its <pre><code> structure reached the data.
		expect( editor.getData() ).to.not.contain( 'language-mermaid' );
	} );

	it( 'skips the editing downcast when another converter already consumed the item', async () => {
		editor = await createEditor();

		editor.editing.downcastDispatcher.on( 'insert:mermaid', ( evt, data, conversionApi ) => {
			// Claim the item *and* stand in for it, otherwise the attribute converters that run
			// afterwards have no view element to attach to.
			conversionApi.consumable.consume( data.item, 'insert' );
			conversionApi.consumable.consume( data.item, 'attribute:displayMode' );
			conversionApi.consumable.consume( data.item, 'attribute:source' );

			const stub = conversionApi.writer.createContainerElement( 'div', { class: 'stub' } );
			conversionApi.mapper.bindElements( data.item as never, stub );
			conversionApi.writer.insert(
				conversionApi.mapper.toViewPosition( editor.model.createPositionBefore( data.item as never ) ),
				stub
			);
		}, { priority: 'highest' } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="graph TD;"></mermaid>]' );

		expect( editor.editing.view.getDomRoot()?.querySelector( '.ck-mermaid__wrapper' ) ).to.equal( null );
	} );

	it( 'skips the upcast when another converter already claimed the code element', async () => {
		editor = await createEditor();

		editor.data.upcastDispatcher.on( 'element:code', ( evt, data, conversionApi ) => {
			conversionApi.consumable.consume( data.viewItem, { name: true } );
		}, { priority: 'highest' } );

		editor.setData(
			'<pre spellcheck="false"><code class="language-mermaid">flowchart TB</code></pre>'
		);

		expect( getModelData( editor.model, { withoutSelection: true } ) ).to.not.contain( '<mermaid' );
	} );

	describe( 'the source attribute downcast', () => {
		/** Invoke the converter directly — these guards depend on mapper/DOM lookups failing. */
		function callSourceDowncast( mapperResult: unknown, viewToDomResult: unknown ) {
			const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
				_sourceAttributeDowncast( evt: unknown, data: unknown, conversionApi: unknown ): void;
			};
			const item = editor.model.document.getRoot()?.getChild( 0 );

			// Only the preview lookup is stubbed: the textarea branch runs first and dereferences
			// its DOM element unguarded.
			const realViewToDom = editor.editing.view.domConverter.viewToDom.bind( editor.editing.view.domConverter );
			vi.spyOn( editor.editing.view.domConverter, 'viewToDom' ).mockImplementation( ( view: never ) => {
				const element = view as unknown as { hasClass( name: string ): boolean };
				if ( element.hasClass?.( 'ck-mermaid__preview' ) ) {
					return viewToDomResult as ReturnType<typeof realViewToDom>;
				}
				return realViewToDom( view );
			} );

			plugin._sourceAttributeDowncast(
				{},
				{ item, attributeNewValue: 'graph TD;' },
				{ mapper: { toViewElement: () => mapperResult } }
			);
		}

		beforeEach( async () => {
			editor = await createEditor();
			setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		} );

		it( 'does nothing when the item has no view element', () => {
			expect( () => callSourceDowncast( undefined, null ) ).to.not.throw();
		} );

		it( 'does nothing when the preview wrapper has no DOM element', () => {
			const viewElement = editor.editing.mapper.toViewElement(
				editor.model.document.getRoot()?.getChild( 0 ) as never
			);

			// The preview child is found in the view, but has no DOM counterpart.
			expect( () => callSourceDowncast( viewElement, null ) ).to.not.throw();
		} );
	} );
} );
