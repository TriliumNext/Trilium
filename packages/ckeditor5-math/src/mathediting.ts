import MathCommand from './mathcommand.js';
import { type Editor, Plugin, toWidget, Widget, viewToModelPositionOutsideModelElement, type ViewDowncastWriter, type ModelElement, CKEditorError, uid } from 'ckeditor5';
import { renderEquation, extractDelimiters } from './utils.js';

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

			const uiElement = writer.createUIElement(
				'div',
				null,
				function( domDocument ) {
					const domElement = this.toDomElement( domDocument );

					void renderEquation(
						equation,
						domElement,
						mathConfig.engine,
						mathConfig.lazyLoad,
						display,
						false,
						`math-editing-${ uid() }`,
						mathConfig.previewClassName,
						mathConfig.katexRenderOptions
					);

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
