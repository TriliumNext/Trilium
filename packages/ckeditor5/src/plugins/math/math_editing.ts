import MathCommand from './math_command.js';
import MathTypeCommand from './math_type_command.js';
import { type DowncastAttributeEvent, type Editor, type GetCallback, Plugin, toWidget, Widget, viewToModelPositionOutsideModelElement, type ViewDowncastWriter, type ModelElement, CKEditorError } from 'ckeditor5';
import { extractDelimiters } from './utils.js';
import { renderStaticMath } from './mathlive_loader.js';

export default class MathEditing extends Plugin {
	public static get requires() {
		return [ Widget ] as const;
	}

	public static get pluginName() {
		return 'MathEditing' as const;
	}

	constructor( editor: Editor ) {
		super( editor );
		editor.config.define( 'math', {
			engine: 'mathjax',
			outputType: 'script',
			className: 'math-tex',
			forceOutputType: false,
			enablePreview: true,
			previewClassName: [],
			popupClassName: [],
			katexRenderOptions: {}
		} );
	}

	public init(): void {
		const editor = this.editor;

		const originalProcessor = editor.data.processor;
		const originalToView = originalProcessor.toView.bind(originalProcessor);
		const mathSpanRegex = /<span class="math-tex">([\s\S]*?)<\/span>/g;
		originalProcessor.toView = (data: string) => {
			// Preprocessing: preserve line breaks inside math formulas by replacing \n with <!--LF-->
			const processedData = data.replace(mathSpanRegex, (_, content) =>
				`<span class="math-tex">${content.replace(/\n/g, '___MATH_TEX_LF___')}</span>`
			);
			return originalToView(processedData);
		};

		editor.commands.add( 'math', new MathCommand( editor ) );
		editor.commands.add( 'mathTypeInline', new MathTypeCommand( editor, 'mathtex-inline' ) );
		editor.commands.add( 'mathTypeDisplay', new MathTypeCommand( editor, 'mathtex-display' ) );

		this._defineSchema();
		this._defineConverters();

		editor.editing.mapper.on(
			'viewToModelPosition',
			viewToModelPositionOutsideModelElement(
				editor.model,
				viewElement => viewElement.hasClass( 'math' )
			)
		);
	}

	private _defineSchema() {
		const schema = this.editor.model.schema;
		schema.register( 'mathtex-inline', {
			allowWhere: '$text',
			isInline: true,
			isObject: true,
			allowAttributes: [ 'equation', 'type', 'display', 'fontSize', 'fontColor', 'fontBackgroundColor' ]
		} );

		// Prevent <mathtex-inline> from being inserted inside <codeBlock>
		schema.addChildCheck( ( context, childDefinition ) => {
			if ( childDefinition && childDefinition.name === 'mathtex-inline' ) {
				// If the context is inside a codeBlock, disallow it
				if ( context.endsWith( 'codeBlock' ) ) {
					return false;
				}
			}
		});

		schema.register( 'mathtex-display', {
			inheritAllFrom: '$blockObject',
			allowAttributes: [ 'equation', 'type', 'display', 'fontSize', 'fontColor' ]
		} );
	}

	private _defineConverters() {
		const conversion = this.editor.conversion;
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const mathConfig = this.editor.config.get( 'math' )!;

		// View -> Model
		conversion
			.for( 'upcast' )
			// MathJax inline way (e.g. <script type="math/tex">\sqrt{\frac{a}{b}}</script>)
			.elementToElement( {
				view: {
					name: 'script',
					attributes: {
						type: 'math/tex'
					}
				},
				model: ( viewElement, { writer } ) => {
					const child = viewElement.getChild( 0 );
					if ( child?.is( '$text' ) ) {
						const equation = child.data.trim();
						return writer.createElement( 'mathtex-inline', {
							equation,
							type: mathConfig.forceOutputType ?
								mathConfig.outputType :
								'script',
							display: false
						} );
					}
					return null;
				}
			} )
			// MathJax display way (e.g. <script type="math/tex; mode=display">\sqrt{\frac{a}{b}}</script>)
			.elementToElement( {
				view: {
					name: 'script',
					attributes: {
						type: 'math/tex; mode=display'
					}
				},
				model: ( viewElement, { writer } ) => {
					const child = viewElement.getChild( 0 );
					if ( child?.is( '$text' ) ) {
						const equation = child.data.trim();
						return writer.createElement( 'mathtex-display', {
							equation,
							type: mathConfig.forceOutputType ?
								mathConfig.outputType :
								'script',
							display: true
						} );
					}
					return null;
				}
			} )
			// CKEditor 4 way (e.g. <span class="math-tex">\( \sqrt{\frac{a}{b}} \)</span>)
			.elementToElement( {
				view: {
					name: 'span',
					// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
					classes: [ mathConfig.className! ]
				},
				model: ( viewElement, { writer } ) => {
					const child = viewElement.getChild( 0 );
					if ( child?.is( '$text' ) ) {
						const equation = child.data.trim().replace(/___MATH_TEX_LF___/g, '\n');
						const params = Object.assign( extractDelimiters( equation ), {
							type: mathConfig.forceOutputType ?
								mathConfig.outputType :
								'span'
						} );

						return writer.createElement(
							params.display ? 'mathtex-display' : 'mathtex-inline',
							params
						);
					}

					return null;
				}
			} )
			// KaTeX from Quill: https://github.com/quilljs/quill/blob/develop/formats/formula.js
			.elementToElement( {
				view: {
					name: 'span',
					classes: [ 'ql-formula' ]
				},
				model: ( viewElement, { writer } ) => {
					const equation = viewElement.getAttribute( 'data-value' );
					if ( equation == null ) {
						/**
						* Couldn't find equation on current element
						* @error missing-equation
						*/
						throw new CKEditorError( 'missing-equation', { pluginName: 'math' } );
					}
					return writer.createElement( 'mathtex-inline', {
						equation: equation.trim(),
						type: mathConfig.forceOutputType ?
							mathConfig.outputType :
							'script',
						display: false
					} );
				}
			} );

		// Model -> View (element)
		conversion
			.for( 'editingDowncast' )
			.elementToElement( {
				model: 'mathtex-inline',
				view: ( modelItem, { writer } ) => {
					const widgetElement = createMathtexEditingView(
						modelItem,
						writer
					);
					return toWidget( widgetElement, writer );
				}
			} )
			.elementToElement( {
				model: 'mathtex-display',
				view: ( modelItem, { writer } ) => {
					const widgetElement = createMathtexEditingView(
						modelItem,
						writer
					);
					return toWidget( widgetElement, writer );
				}
			} );

		// Model -> Data
		conversion
			.for( 'dataDowncast' )
			.elementToElement( {
				model: 'mathtex-inline',
				view: createMathtexView
			} )
			.elementToElement( {
				model: 'mathtex-display',
				view: createMathtexView
			} );

		// The elementToElement editing converters above only run on insertion; `equation` can now
		// also change in place (in-place MathLive editing, undo/redo of it), so patch the already
		// rendered widget DOM instead of reconverting — reconversion would destroy a mounted
		// <math-field> mid-edit. Same approach as the mermaid widget's source downcast.
		const editor = this.editor;
		conversion.for( 'editingDowncast' ).add( dispatcher => {
			const updateEquation: GetCallback<DowncastAttributeEvent> = ( evt, data, conversionApi ) => {
				if ( !data.item.is( 'element' ) || !conversionApi.consumable.consume( data.item, evt.name ) ) {
					return;
				}

				const viewElement = conversionApi.mapper.toViewElement( data.item );
				/* v8 ignore next 3 -- defensive: an attribute change on a rendered widget always has a mapped view */
				if ( !viewElement ) {
					return;
				}

				const dom = editor.editing.view.domConverter.mapViewToDom( viewElement );
				const body = dom instanceof HTMLElement ? dom.querySelector( '.ck-math-widget-body' ) : null;
				if ( !body ) {
					return;
				}

				const equation = String( data.attributeNewValue ?? '' );
				const display = !!data.item.getAttribute( 'display' );

				const preview = body.querySelector<HTMLElement>( '.ck-math-widget-preview' );
				if ( preview ) {
					renderStaticMath( preview, equation, display );
				}

				// An externally caused change (undo, sync) while a math field is mounted lands in
				// the field too; its own edits round-trip as equal values and are skipped here.
				const mathfield = body.querySelector( 'math-field' ) as MathFieldLike | null;
				if ( mathfield && mathfield.value.trim() !== equation.trim() ) {
					if ( mathfield.setValue ) {
						mathfield.setValue( equation, { silenceNotifications: true } );
					} else {
						mathfield.value = equation;
					}
				}
			};

			dispatcher.on<DowncastAttributeEvent>( 'attribute:equation:mathtex-inline', updateEquation );
			dispatcher.on<DowncastAttributeEvent>( 'attribute:equation:mathtex-display', updateEquation );
		} );

		// Create view for editor
		function createMathtexEditingView(
			modelItem: ModelElement,
			writer: ViewDowncastWriter
		) {
			const equation = String( modelItem.getAttribute( 'equation' ) );
			const display = !!modelItem.getAttribute( 'display' );

			const styles =
				'user-select: none; ' +
				( display ? '' : 'display: inline-block;' );
			const classes =
				'ck-math-tex ' +
				( display ? 'ck-math-tex-display' : 'ck-math-tex-inline' );

			const mathtexView = writer.createContainerElement(
				display ? 'div' : 'span',
				{
					style: styles,
					class: classes
				}
			);

			// The equation renders into a nested `.ck-math-widget-preview` element rather than the
			// UI element itself, so that in-place editing (MathLiveEdit) can hide the preview
			// and mount a <math-field> next to it inside the same renderer-opaque container.
			// Static MathLive markup (not KaTeX) keeps the preview pixel-identical to the field.
			const uiElement = writer.createUIElement(
				'div',
				{ class: 'ck-math-widget-body' },
				function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					const preview = domDocument.createElement( display ? 'div' : 'span' );
					preview.className = 'ck-math-widget-preview';
					domElement.appendChild( preview );

					renderStaticMath( preview, equation, display );

					return domElement;
				}
			);

			writer.insert( writer.createPositionAt( mathtexView, 0 ), uiElement );

			return mathtexView;
		}

		// Create view for data
		function createMathtexView(
			modelItem: ModelElement,
			{ writer }: { writer: ViewDowncastWriter }
		) {
			const equation = modelItem.getAttribute( 'equation' );
			if ( typeof equation != 'string' ) {
				/**
				* Couldn't find equation on current element
				* @error missing-equation
				*/
				throw new CKEditorError( 'missing-equation', { pluginName: 'math' } );
			}

			const type = modelItem.getAttribute( 'type' );
			const display = modelItem.getAttribute( 'display' );

			if ( type === 'span' ) {
				const mathtexView = writer.createContainerElement( 'span', {
					class: mathConfig.className
				} );

				if ( display ) {
					writer.insert(
						writer.createPositionAt( mathtexView, 0 ),
						writer.createText( '\\[' + equation + '\\]' )
					);
				} else {
					writer.insert(
						writer.createPositionAt( mathtexView, 0 ),
						writer.createText( '\\(' + equation + '\\)' )
					);
				}

				return mathtexView;
			} else {
				const mathtexView = writer.createContainerElement( 'script', {
					type: display ? 'math/tex; mode=display' : 'math/tex'
				} );

				writer.insert(
					writer.createPositionAt( mathtexView, 0 ),
					writer.createText( equation )
				);

				return mathtexView;
			}
		}
	}
}

/** The slice of MathLive's MathfieldElement the in-place downcast patch needs. */
interface MathFieldLike extends HTMLElement {
	value: string;
	setValue?: ( value: string, options?: { silenceNotifications?: boolean } ) => void;
}
