import { ClassicEditor, CodeBlockEditing, Essentials, Paragraph, _getModelData as getModelData, _setModelData as setModelData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MermaidEditing from './mermaid_editing.js';

/* global document */

/**
 * The diagram renderer: how `_renderMermaid` lazy-loads the mermaid instance, what it does with
 * the SVG it gets back, and how it behaves when a render fails or is superseded by a newer one.
 */
describe( 'MermaidEditing rendering', () => {
	let domElement: HTMLDivElement, editor: ClassicEditor;

	/** A stand-in for the mermaid library, with a render we can resolve or reject at will. */
	function createFakeMermaid( render: MermaidInstance['render'] ) {
		return { initialize: vi.fn(), render: vi.fn( render ) };
	}

	async function createEditor( mermaidConfig?: Record<string, unknown> ) {
		domElement = document.createElement( 'div' );
		document.body.appendChild( domElement );

		return ClassicEditor.create( domElement, {
			licenseKey: 'GPL',
			plugins: [ Paragraph, Essentials, CodeBlockEditing, MermaidEditing ],
			...( mermaidConfig ? { mermaid: mermaidConfig } : {} )
		} ) as Promise<ClassicEditor>;
	}

	/** The rendered preview pane of the first mermaid widget in the editing view. */
	function previewDom(): HTMLElement {
		const preview = editor.editing.view.getDomRoot()?.querySelector( '.ck-mermaid__preview' );
		if ( !( preview instanceof HTMLElement ) ) {
			throw new Error( 'Expected a rendered mermaid preview.' );
		}
		return preview;
	}

	/** Let the render promise chain settle. */
	const flush = () => new Promise( resolve => setTimeout( resolve, 0 ) );

	/** Poll until `predicate` holds — the render chain takes several microtask turns. */
	async function waitFor( predicate: () => boolean ) {
		for ( let i = 0; i < 50 && !predicate(); i++ ) {
			await flush();
		}
		if ( !predicate() ) {
			throw new Error( 'Timed out waiting for the render to start.' );
		}
	}

	/** The `source` attribute of the first mermaid element in the model. */
	function sourceAttribute(): unknown {
		const item = editor.model.document.getRoot()?.getChild( 0 );
		return item?.is( 'element' ) ? item.getAttribute( 'source' ) : undefined;
	}

	afterEach( async () => {
		domElement?.remove();
		await editor?.destroy();
	} );

	it( 'lazy-loads mermaid once, initialises it, and injects the SVG', async () => {
		const instance = createFakeMermaid( async () => ( { svg: '<svg id="rendered"></svg>' } ) );
		const lazyLoad = vi.fn( async () => instance );
		editor = await createEditor( { lazyLoad, config: { theme: 'dark' } } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="graph TD;"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'graph TD; A-->B;', item );
			}
		} );
		await flush();

		expect( lazyLoad ).toHaveBeenCalledTimes( 1 );
		expect( instance.initialize ).toHaveBeenCalledWith( { theme: 'dark' } );
		expect( previewDom().innerHTML ).to.equal( '<svg id="rendered"></svg>' );
	} );

	it( 'falls back to an empty config object when none is supplied', async () => {
		const instance = createFakeMermaid( async () => ( { svg: '<svg></svg>' } ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'b', item );
			}
		} );
		await flush();

		expect( instance.initialize ).toHaveBeenCalledWith( {} );
	} );

	it( 'shows the error message when a render throws, and cleans up the orphan node', async () => {
		const instance = createFakeMermaid( async ( id: string ) => {
			// mermaid leaves a probe element behind in the document when it fails.
			const orphan = document.createElement( 'div' );
			orphan.id = id;
			document.body.appendChild( orphan );
			throw new Error( 'Parse error on line 1' );
		} );
		editor = await createEditor( { lazyLoad: async () => instance } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'not a diagram', item );
			}
		} );
		await flush();

		expect( previewDom().innerText ).to.equal( 'Parse error on line 1' );
		expect( document.querySelectorAll( '[id^="ck-mermaid-"]' ) ).to.have.length( 0 );
	} );

	it( 'ignores a render that a newer one has superseded', async () => {
		const pending: Array<( value: { svg: string } ) => void> = [];
		const instance = createFakeMermaid( () => new Promise( resolve => {
			pending.push( resolve );
		} ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		// Drive the renderer directly: going through attribute changes would re-render the
		// widget and hand each render a different preview node, which is not what is under
		// test here — the generation guard is.
		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			_renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );

		const stale = plugin._renderMermaid( target, 'first' );
		await waitFor( () => pending.length >= 1 );
		const latest = plugin._renderMermaid( target, 'second' );
		await waitFor( () => pending.length >= 2 );

		// Resolve the newer render first, then let the stale one finish.
		pending[ 1 ]?.( { svg: '<svg id="second"></svg>' } );
		await latest;
		pending[ 0 ]?.( { svg: '<svg id="first"></svg>' } );
		await stale;

		expect( target.innerHTML ).to.equal( '<svg id="second"></svg>' );
	} );

	it( 'does nothing when the host configured no lazyLoad', async () => {
		editor = await createEditor( {} );

		setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'b', item );
			}
		} );
		await flush();

		expect( previewDom().innerHTML ).to.equal( '' );
	} );

	describe( 'the source textarea', () => {
		beforeEach( async () => {
			editor = await createEditor( { lazyLoad: async () => createFakeMermaid( async () => ( { svg: '' } ) ) } );
		} );

		function textarea(): HTMLTextAreaElement {
			const el = editor.editing.view.getDomRoot()?.querySelector( '.ck-mermaid__editing-view' );
			if ( !( el instanceof HTMLTextAreaElement ) ) {
				throw new Error( 'Expected a rendered mermaid textarea.' );
			}
			return el;
		}

		it( 'writes typed text back to the model, debounced', async () => {
			vi.useFakeTimers();
			try {
				setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );

				const el = textarea();
				el.value = 'graph TD; A-->B;';
				el.dispatchEvent( new Event( 'input' ) );

				// Nothing yet — the listener is debounced.
				expect( sourceAttribute() ).to.equal( 'a' );

				vi.advanceTimersByTime( 300 );

				expect( sourceAttribute() ).to.equal( 'graph TD; A-->B;' );
			} finally {
				vi.useRealTimers();
			}
		} );

		it( 'selects the widget when the textarea takes focus', () => {
			setModelData( editor.model, '<paragraph>[]foo</paragraph><mermaid displayMode="split" source="a"></mermaid>' );

			textarea().dispatchEvent( new FocusEvent( 'focus' ) );

			expect( editor.model.document.selection.getSelectedElement()?.name ).to.equal( 'mermaid' );
		} );

		it( 'leaves the selection alone when the widget is already selected', () => {
			setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
			const before = getModelData( editor.model );

			textarea().dispatchEvent( new FocusEvent( 'focus' ) );

			expect( getModelData( editor.model ) ).to.equal( before );
		} );
	} );
} );
