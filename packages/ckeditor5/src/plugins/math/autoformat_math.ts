import { Plugin, logWarning, blockAutoformatEditing } from 'ckeditor5';
// eslint-disable-next-line ckeditor5-rules/allow-imports-only-from-main-package-entry-point
import Math from './math.js';
import MathCommand from './math_command.js';
import MathUI from './math_ui.js';

export default class AutoformatMath extends Plugin {
	public static get requires() {
		return [ Math, 'Autoformat' ] as const;
	}

	/**
	 * @inheritDoc
	 */
	public init(): void {
		const editor = this.editor;

		if ( !editor.plugins.has( 'Math' ) ) {
			logWarning( 'autoformat-math-feature-missing', editor );
		}
	}

	public afterInit(): void {
		const editor = this.editor;
		const command = editor.commands.get( 'math' );

		/* v8 ignore next -- defensive: MathEditing always registers a MathCommand under this name */
		if ( command instanceof MathCommand ) {
			const callback = () => {
				if ( !command.isEnabled ) {
					return false;
				}

				command.display = true;

				// Wait until selection is removed.
				window.setTimeout(
					() => {
						const mathUIInstance = editor.plugins.get( 'MathUI' );
						/* v8 ignore next -- defensive: the Math glue plugin always loads MathUI */
						if ( mathUIInstance instanceof MathUI ) {
							mathUIInstance._showUI();
						}
					},
					50
				);
			};

			// @ts-expect-error: blockAutoformatEditing expects an Autoformat instance even though it works with any Plugin instance
			blockAutoformatEditing( editor, this, /^\$\$$/, callback );
			// @ts-expect-error: blockAutoformatEditing expects an Autoformat instance even though it works with any Plugin instance
			blockAutoformatEditing( editor, this, /^\\\[$/, callback );
		}
	}

	public static get pluginName() {
		return 'AutoformatMath' as const;
	}
}
