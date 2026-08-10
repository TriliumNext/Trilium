import { ClassicEditor, Paragraph, _getModelData as getModelData, _setModelData as setModelData } from 'ckeditor5';

import './mermaid.js';
import Mermaid from './mermaid.js';
import MermaidUI from './mermaid_ui.js';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { expect } from 'vitest';

/* global document */

describe( 'MermaidUI', () => {
	it( 'should be named', () => {
		expect( MermaidUI.pluginName ).to.equal( 'MermaidUI' );
	} );

	describe( 'init()', () => {
		let domElement, editor;

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				licenseKey: "GPL",
				plugins: [
					Mermaid
				]
			} );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'should register the UI item', () => {
			expect( editor.ui.componentFactory.has( 'mermaid' ) ).to.equal( true );
		} );

		it( 'has the base properties', () => {
			const dropdown = editor.ui.componentFactory.create( 'mermaid' );

			expect( dropdown.buttonView ).to.have.property( 'label', 'Insert Mermaid diagram' );
			expect( dropdown.buttonView ).to.have.property( 'icon' );
			expect( dropdown.buttonView ).to.have.property( 'tooltip', true );
		} );

		describe( 'UI components', () => {
			for ( const buttonName of [
				'mermaidPreview',
				'mermaidSourceView',
				'mermaidSplitView',
				'mermaidInfo'
			] ) {
				it( `should register the ${ buttonName } button`, () => {
					expect( editor.ui.componentFactory.has( buttonName ) ).to.equal( true );
				} );

				it( `should add the base properties for ${ buttonName } button`, () => {
					const button = editor.ui.componentFactory.create( buttonName );

					expect( button ).to.have.property( 'label' );
					expect( button ).to.have.property( 'icon' );
					expect( button ).to.have.property( 'tooltip', true );
				} );
			}
		} );

		it( 'should set focus inside textarea of a newly created mermaid', () => {
			const dropdown = editor.ui.componentFactory.create( 'mermaid' );

			dropdown.buttonView.fire( 'execute' );

			expect( document.activeElement.tagName ).to.equal( 'TEXTAREA' );
		} );

		it( 'should insert exactly one diagram on the main action (no double insert)', () => {
			const dropdown = editor.ui.componentFactory.create( 'mermaid' );

			dropdown.buttonView.fire( 'execute' );

			const data = getModelData( editor.model, { withoutSelection: true } );
			expect( ( data.match( /<mermaid/g ) || [] ).length ).to.equal( 1 );
		} );

		it( 'should not crash if the button is fired inside model.change()', () => {
			const dropdown = editor.ui.componentFactory.create( 'mermaid' );

			setModelData( editor.model, '[]' );

			editor.model.change( () => {
				dropdown.buttonView.fire( 'execute' );
			} );
			// As the conversion is to be executed after the model.change(), we don't have access to the fully prepared view and
			// despite that, we should still successfully add mermaid widget to the editor, not requiring the selection change
			// to the inside of the nonexisting textarea element.
		} );
	} );

	describe( 'diagram templates', () => {
		let domElement, editor;

		const SAMPLES = [
			{ name: 'Flowchart', content: 'graph LR; A --> B' },
			{ name: 'Pie', content: 'pie title Pets' }
		];

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				licenseKey: "GPL",
				plugins: [
					Mermaid,
					Paragraph
				],
				mermaid: {
					config: {},
					samples: SAMPLES
				}
			} );
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		it( 'lists the configured templates in the dropdown', () => {
			const dropdown = editor.ui.componentFactory.create( 'mermaid' );
			dropdown.render();
			document.body.appendChild( dropdown.element );
			dropdown.isOpen = true;

			const labels = [ ...dropdown.listView.items ].map( item => item.children.first.label );
			expect( labels ).to.deep.equal( [ 'Flowchart', 'Pie' ] );

			dropdown.element.remove();
		} );

		it( 'inserts a diagram pre-filled with the picked template source', () => {
			setModelData( editor.model, '<paragraph>[foo]</paragraph>' );

			const dropdown = editor.ui.componentFactory.create( 'mermaid' );
			dropdown.render();
			document.body.appendChild( dropdown.element );
			dropdown.isOpen = true;

			dropdown.listView.items.first.children.first.fire( 'execute' );

			expect( getModelData( editor.model, { withoutSelection: true } ) ).to.equal(
				'<mermaid displayMode="split" source="graph LR; A --> B"></mermaid>'
			);

			dropdown.element.remove();
		} );
	} );
} );


describe( 'MermaidUI without its commands', () => {
	let domElement: HTMLDivElement;

	beforeEach( () => {
		domElement = document.createElement( 'div' );
		document.body.appendChild( domElement );
	} );

	afterEach( () => {
		domElement.remove();
	} );

	it( 'refuses to initialise without the insert command', async () => {
		// MermaidUI alone: MermaidEditing never registered insertMermaid, and the
		// insert button is built during init(), so the whole editor fails to start.
		await expect( ClassicEditor.create( domElement, {
			licenseKey: 'GPL',
			plugins: [ Paragraph, MermaidUI ]
		} ) ).rejects.toThrow( 'Missing command.' );
	} );

	it( 'refuses to build a toolbar button whose command is missing', async () => {
		const editor = await ClassicEditor.create( domElement, {
			licenseKey: 'GPL',
			plugins: [ Paragraph, Mermaid ]
		} );
		const ui = editor.plugins.get( MermaidUI ) as unknown as {
			_createToolbarButton( editor: ClassicEditor, name: string, label: string, icon: string ): void;
		};

		// Toolbar buttons resolve their command lazily, inside the factory callback.
		ui._createToolbarButton( editor, 'mermaidNoSuch', 'No such', '<svg></svg>' );

		expect( () => editor.ui.componentFactory.create( 'mermaidNoSuch' ) ).to.throw( 'Missing command.' );

		await editor.destroy();
	} );
} );

describe( 'MermaidUI buttons', () => {
	let domElement: HTMLDivElement, editor: ClassicEditor;

	beforeEach( async () => {
		domElement = document.createElement( 'div' );
		document.body.appendChild( domElement );

		editor = await ClassicEditor.create( domElement, {
			licenseKey: 'GPL',
			plugins: [ Paragraph, Mermaid ]
		} );
	} );

	afterEach( () => {
		domElement.remove();
		return editor.destroy();
	} );

	it( 'opens the syntax documentation in a new tab', () => {
		const open = vi.spyOn( window, 'open' ).mockReturnValue( null );
		const button = editor.ui.componentFactory.create( 'mermaidInfo' );

		button.fire( 'execute' );

		expect( open ).toHaveBeenCalledWith(
			'https://ckeditor.com/blog/basic-overview-of-creating-flowcharts-using-mermaid/',
			'_blank',
			'noopener'
		);

		open.mockRestore();
	} );

	it( 'runs the matching command and returns focus when a toolbar button executes', () => {
		setModelData( editor.model, '[<mermaid displayMode="split" source="foo"></mermaid>]' );

		const execute = vi.spyOn( editor, 'execute' );
		const focus = vi.spyOn( editor.editing.view, 'focus' );
		const scroll = vi.spyOn( editor.editing.view, 'scrollToTheSelection' );

		editor.ui.componentFactory.create( 'mermaidPreview' ).fire( 'execute' );

		expect( execute ).toHaveBeenCalledWith( 'mermaidPreviewCommand' );
		expect( scroll ).toHaveBeenCalled();
		expect( focus ).toHaveBeenCalled();
	} );

	it( 'tracks its command through isOn and isEnabled', () => {
		setModelData( editor.model, '[<mermaid displayMode="preview" source="foo"></mermaid>]' );

		const button = editor.ui.componentFactory.create( 'mermaidPreview' ) as unknown as {
			isOn: boolean; isEnabled: boolean;
		};

		expect( button.isOn ).to.equal( true );
		expect( button.isEnabled ).to.equal( true );
	} );
} );
