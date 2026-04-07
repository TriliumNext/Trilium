import { ClassicEditor, Essentials, Paragraph, Heading, CodeBlockEditing, ViewElement, _setModelData as setModelData, _getModelData as getModelData, _getViewData as getViewData } from 'ckeditor5';
import MermaidEditing from '../src/mermaidediting.js';
import { afterEach, beforeEach, describe, it, expect, vi, type MockInstance } from 'vitest';

/* global document */

describe( 'MermaidEditing', () => {
	it( 'should be named', () => {
		expect( MermaidEditing.pluginName ).to.equal( 'MermaidEditing' );
	} );

	describe( 'conversion', () => {
		let domElement: HTMLDivElement, editor: ClassicEditor, model: ClassicEditor['model'];

		beforeEach( async () => {
			domElement = document.createElement( 'div' );
			document.body.appendChild( domElement );

			editor = await ClassicEditor.create( domElement, {
				licenseKey: "GPL",
				plugins: [
					Paragraph,
					Heading,
					Essentials,
					CodeBlockEditing,
					MermaidEditing
				]
			} );

			model = editor.model;
		} );

		afterEach( () => {
			domElement.remove();
			return editor.destroy();
		} );

		describe( 'conversion', () => {
			describe( 'upcast', () => {
				it( 'works correctly', () => {
					editor.setData(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --> B\nB --> C</code>' +
						'</pre>'
					);

					expect( getModelData( model, { withoutSelection: true } ) ).to.equal(
						'<mermaid displayMode="split" source="flowchart TB\nA --> B\nB --> C">' +
						'</mermaid>'
					);
				} );

				it( 'works correctly when empty', () => {
					editor.setData(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid"></code>' +
						'</pre>'
					);

					expect( getModelData( model, { withoutSelection: true } ) ).to.equal(
						'<mermaid displayMode="split" source=""></mermaid>'
					);
				} );
			} );

			describe( 'data downcast', () => {
				it( 'works correctly', () => {
					// Using editor.setData() instead of setModelData helper because of #11365.
					editor.setData(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --> B\nB --> C</code>' +
						'</pre>'
					);

					expect( editor.getData() ).to.equal(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --&gt; B\nB --&gt; C</code>' +
						'</pre>'
					);
				} );

				it( 'works correctly when empty ', () => {
					// Using editor.setData() instead of setModelData helper because of #11365.
					editor.setData(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid"></code>' +
						'</pre>'
					);

					expect( editor.getData() ).to.equal(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid"></code>' +
						'</pre>'
					);
				} );
			} );

			describe( 'editing downcast', () => {
				it( 'works correctly without displayMode attribute', () => {
					// Using editor.setData() instead of setModelData helper because of #11365.
					editor.setData(
						'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --> B\nB --> C</code>' +
						'</pre>'
					);

					expect( getViewData( editor.editing.view, { withoutSelection: true } ) ).to.equal(
						'<div class="ck-mermaid__split-mode ck-mermaid__wrapper ck-widget ck-widget_selected' +
							' ck-widget_with-selection-handle" contenteditable="false">' +
							'<div class="ck ck-widget__selection-handle"></div>' +
							// New lines replaced with space, same issue in getViewData as in #11365.
							'<textarea class="ck-mermaid__editing-view" data-cke-ignore-events="true"' +
								' placeholder="Insert mermaid source code"></textarea>' +
							'<div class="ck-mermaid__preview"></div>' +
							'<div class="ck ck-reset_all ck-widget__type-around"></div>' +
						'</div>'
					);
				} );

				it( 'works correctly with displayMode attribute', () => {
					setModelData( editor.model,
						'<mermaid source="foo" displayMode="preview"></mermaid>'
					);

					expect( getViewData( editor.editing.view, { withoutSelection: true } ) ).to.equal(
						'<div class="ck-mermaid__preview-mode ck-mermaid__wrapper ck-widget ck-widget_selected ' +
							'ck-widget_with-selection-handle" contenteditable="false">' +
							'<div class="ck ck-widget__selection-handle"></div>' +
							'<textarea class="ck-mermaid__editing-view" data-cke-ignore-events="true"' +
								' placeholder="Insert mermaid source code"></textarea>' +
							'<div class="ck-mermaid__preview"></div>' +
							'<div class="ck ck-reset_all ck-widget__type-around"></div>' +
						'</div>'
					);
				} );

				it( 'works correctly with empty source', () => {
					setModelData( editor.model,
						'<mermaid source="" displayMode="preview"></mermaid>'
					);

					expect( getViewData( editor.editing.view, { withoutSelection: true } ) ).to.equal(
						'<div class="ck-mermaid__preview-mode ck-mermaid__wrapper ck-widget ck-widget_selected ' +
							'ck-widget_with-selection-handle" contenteditable="false">' +
							'<div class="ck ck-widget__selection-handle"></div>' +
							'<textarea class="ck-mermaid__editing-view" data-cke-ignore-events="true"' +
								' placeholder="Insert mermaid source code"></textarea>' +
							'<div class="ck-mermaid__preview"></div>' +
							'<div class="ck ck-reset_all ck-widget__type-around"></div>' +
						'</div>'
					);
				} );

				describe( 'textarea value', () => {
					let domTextarea: HTMLTextAreaElement;

					beforeEach( () => {
						// Using editor.setData() instead of setModelData helper because of #11365.
						editor.setData(
							'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --> B\nB --> C</code>' +
							'</pre>'
						);

						const textareaView = editor.editing.view.document.getRoot()!.getChild( 0 )! as ViewElement;
						domTextarea = editor.editing.view.domConverter.viewToDom( textareaView.getChild( 1 )! ) as HTMLTextAreaElement;
					} );

					it( 'is properly set during the initial conversion', () => {
						expect( domTextarea.value ).to.equal( 'flowchart TB\nA --> B\nB --> C' );
					} );

					it( 'is properly updated after model\'s attribute change', () => {
						const { model } = editor;

						const mermaidModel = model.document.getRoot()!.getChild( 0 )!;

						model.change( writer => {
							writer.setAttribute( 'source', 'abc', mermaidModel );
						} );

						expect( domTextarea.value ).to.equal( 'abc' );
					} );

					it( 'doesn\'t loop if model attribute changes to the same value', () => {
						const { model } = editor;

						const mermaidModel = model.document.getRoot()!.getChild( 0 )!;

						model.change( writer => {
							writer.setAttribute( 'source', 'flowchart TB\nA --> B\nB --> C', mermaidModel );
						} );

						expect( domTextarea.value ).to.equal( 'flowchart TB\nA --> B\nB --> C' );
					} );
				} );

				describe( 'preview div', () => {
					let domPreviewContainer: HTMLElement;
					let renderMermaidStub: MockInstance;

					beforeEach( () => {
						renderMermaidStub = vi.spyOn( editor.plugins.get( 'MermaidEditing' ) as unknown as MermaidEditing, '_renderMermaid' );

						// Using editor.setData() instead of setModelData helper because of #11365.
						editor.setData(
							'<pre spellcheck="false">' +
							'<code class="language-mermaid">flowchart TB\nA --> B\nB --> C</code>' +
							'</pre>'
						);

						const wrapperView = editor.editing.view.document.getRoot()!.getChild( 0 )! as ViewElement;
						const previewContainerView = wrapperView.getChild( 2 )!;
						domPreviewContainer = editor.editing.view.domConverter.viewToDom( previewContainerView ) as HTMLElement;
					} );

					afterEach( () => {
						vi.clearAllMocks();
					} );

					it( 'calls render with source during the initial conversion', () => {
						expect( renderMermaidStub ).toBeCalledWith( domPreviewContainer, 'flowchart TB\nA --> B\nB --> C' );
					} );

					it( 'calls render with updated source after a model\'s attribute change', () => {
						const { model } = editor;

						renderMermaidStub.mockClear();

						const mermaidModel = model.document.getRoot()!.getChild( 0 )!;

						model.change( writer => {
							writer.setAttribute( 'source', 'abc', mermaidModel );
						} );

						expect( renderMermaidStub ).toBeCalledWith( domPreviewContainer, 'abc' );
					} );
				} );
			} );

			it( 'adds a editing pipeline converter that has a precedence over code block', () => {
				setModelData( editor.model, '<mermaid source="foo"></mermaid>' );

				const firstViewChild = editor.editing.view.document.getRoot()!.getChild( 0 ) as ViewElement;

				expect( firstViewChild.name ).to.equal( 'div' );
				expect( firstViewChild.hasClass( 'ck-mermaid__wrapper' ), 'has ck-mermaid__wrapper class' ).to.be.true;
			} );

			it( 'does not convert code blocks other than mermaid language', () => {
				setModelData( editor.model, '<codeBlock language="javascript">foo</codeBlock>' );

				const firstViewChild = editor.editing.view.document.getRoot()!.getChild( 0 ) as ViewElement;

				expect( firstViewChild.name ).not.to.equal( 'div' );
				expect( firstViewChild.hasClass( 'ck-mermaid__wrapper' ), 'has ck-mermaid__wrapper class' ).to.be.false;
			} );

			it( 'adds a preview element', () => {
				setModelData( editor.model, '<mermaid source="foo"></mermaid>' );

				const widget = editor.editing.view.document.getRoot()!.getChild( 0 ) as ViewElement;
				const widgetChildren = [ ...widget.getChildren() ] as ViewElement[];
				const previewView = widgetChildren.filter( item => item.name === 'div' && item.hasClass( 'ck-mermaid__preview' ) );

				expect( previewView.length ).to.equal( 1 );
			} );

			it( 'adds an editing element', () => {
				setModelData( editor.model, '<mermaid source="foo"></mermaid>' );

				const widget = editor.editing.view.document.getRoot()!.getChild( 0 ) as ViewElement;
				const widgetChildren = [ ...widget.getChildren() ] as ViewElement[];
				const previewView = widgetChildren.filter(
					item => item.name === 'textarea' && item.hasClass( 'ck-mermaid__editing-view' )
				);

				expect( previewView.length ).to.equal( 1 );
			} );
		} );
	} );
} );
