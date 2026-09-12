import { ClassicEditor, CodeBlockEditing, Essentials, Paragraph, _getModelData as getModelData, _setModelData as setModelData } from 'ckeditor5';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MermaidEditing from './mermaid_editing.js';

/* global document */

/**
 * The diagram renderer: how `renderMermaid` lazy-loads the mermaid instance, what it does with
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
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );

		const stale = plugin.renderMermaid( target, 'first' );
		await waitFor( () => pending.length >= 1 );
		// Queue the newer render while the first is still in flight. Renders are serialized,
		// so the second mermaid.render() only starts after the first settles — but the
		// generation bump must still discard the stale SVG.
		const latest = plugin.renderMermaid( target, 'second' );

		pending[ 0 ]?.( { svg: '<svg id="first"></svg>' } );
		await stale;
		await waitFor( () => pending.length >= 2 );
		pending[ 1 ]?.( { svg: '<svg id="second"></svg>' } );
		await latest;

		expect( target.innerHTML ).to.equal( '<svg id="second"></svg>' );
	} );

	it( 'keeps concurrent renders on different preview elements independent', async () => {
		const pending = new Map<string, ( value: { svg: string } ) => void>();
		const instance = createFakeMermaid( ( _id: string, source: string ) => new Promise( resolve => {
			pending.set( source, resolve );
		} ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const first = document.createElement( 'div' );
		const second = document.createElement( 'div' );

		const firstRender = plugin.renderMermaid( first, 'diagram-a' );
		const secondRender = plugin.renderMermaid( second, 'diagram-b' );

		// Serialized queue: only the first render is in flight initially.
		await waitFor( () => pending.has( 'diagram-a' ) );
		expect( pending.has( 'diagram-b' ) ).to.equal( false );

		pending.get( 'diagram-a' )?.( { svg: '<svg id="a"></svg>' } );
		await firstRender;
		await waitFor( () => pending.has( 'diagram-b' ) );
		pending.get( 'diagram-b' )?.( { svg: '<svg id="b"></svg>' } );
		await secondRender;

		expect( first.innerHTML ).to.equal( '<svg id="a"></svg>' );
		expect( second.innerHTML ).to.equal( '<svg id="b"></svg>' );
	} );

	it( 'clears the preview when the source becomes empty', async () => {
		const instance = createFakeMermaid( async () => ( { svg: '<svg id="rendered"></svg>' } ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );
		target.innerHTML = '<svg id="stale"></svg>';

		await plugin.renderMermaid( target, '   ' );

		expect( target.innerHTML ).to.equal( '' );
		expect( instance.render ).not.toHaveBeenCalled();
	} );

	it( 'does not restore a stale SVG after the source is cleared mid-render', async () => {
		const pending: Array<( value: { svg: string } ) => void> = [];
		const instance = createFakeMermaid( () => new Promise( resolve => {
			pending.push( resolve );
		} ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );

		const first = plugin.renderMermaid( target, 'graph TD; A-->B;' );
		await waitFor( () => pending.length >= 1 );

		await plugin.renderMermaid( target, '   ' );
		expect( target.innerHTML ).to.equal( '' );

		pending[ 0 ]?.( { svg: '<svg id="stale"></svg>' } );
		await first;

		expect( target.innerHTML ).to.equal( '' );
	} );

	it( 'removes the temporary mermaid probe node after a successful render', async () => {
		const instance = createFakeMermaid( async ( id: string ) => {
			const probe = document.createElement( 'div' );
			probe.id = id;
			document.body.appendChild( probe );
			// Real mermaid SVGs reuse the render id; ensure we don't delete that
			// after inserting it into the preview.
			return { svg: `<svg id="${ id }"></svg>` };
		} );
		editor = await createEditor( { lazyLoad: async () => instance } );

		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );

		await plugin.renderMermaid( target, 'graph TD; A-->B;' );

		expect( target.querySelector( 'svg' ) ).to.not.equal( null );
		expect( target.contains( target.querySelector( 'svg' )! ) ).to.equal( true );
		// Probe on document.body is gone; only the preview SVG remains.
		expect( document.body.querySelector( '[id^="ck-mermaid-"]' ) ).to.equal( null );
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

	it( 'clears the preview when the source attribute is removed outright', async () => {
		const instance = createFakeMermaid( async () => ( { svg: '<svg id="rendered"></svg>' } ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'b', item );
			}
		} );
		await waitFor( () => previewDom().innerHTML !== '' );

		// Removal hands the downcast a null value rather than an empty string.
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.removeAttribute( 'source', item );
			}
		} );
		await waitFor( () => previewDom().innerHTML === '' );

		expect( previewDom().innerHTML ).to.equal( '' );
	} );

	it( 'stringifies a non-Error thrown by the renderer', async () => {
		const instance = createFakeMermaid( async () => {
			throw 'boom';
		} );
		editor = await createEditor( { lazyLoad: async () => instance } );

		setModelData( editor.model, '[<mermaid displayMode="split" source="a"></mermaid>]' );
		editor.model.change( writer => {
			const item = editor.model.document.getRoot()?.getChild( 0 );
			if ( item?.is( 'element' ) ) {
				writer.setAttribute( 'source', 'not a diagram', item );
			}
		} );
		await waitFor( () => previewDom().innerText === 'boom' );

		expect( previewDom().innerText ).to.equal( 'boom' );
	} );

	it( 'does not surface an error from a render a newer one has superseded', async () => {
		const pending: Array<( reason: unknown ) => void> = [];
		const instance = createFakeMermaid( () => new Promise( ( _resolve, reject ) => {
			pending.push( reject );
		} ) );
		editor = await createEditor( { lazyLoad: async () => instance } );

		const plugin = editor.plugins.get( MermaidEditing ) as unknown as {
			renderMermaid( domElement: HTMLElement, source: string ): Promise<void>;
		};
		const target = document.createElement( 'div' );

		const stale = plugin.renderMermaid( target, 'first' );
		await waitFor( () => pending.length >= 1 );
		// Clearing bumps this element's generation synchronously, so the in-flight render is
		// already stale by the time it rejects.
		await plugin.renderMermaid( target, '' );

		pending[ 0 ]?.( new Error( 'Parse error on line 1' ) );
		await stale;

		expect( target.innerHTML ).to.equal( '' );
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
