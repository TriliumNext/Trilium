import { Plugin, Widget } from 'ckeditor5';

import '../../theme/math_form.css';

import type MathCommand from './math_command.js';
import MathEditing from './math_editing.js';
import MathUI from './math_ui.js';
import type { KatexOptions } from './typings_external.js';

/**
 * TeX equations, rendered with KaTeX or MathJax: an inline `mathtex-inline` widget or a block
 * `mathtex-display` one, edited through a MathLive-backed dialog.
 *
 * This is a "glue" plugin which loads {@link MathEditing} and {@link MathUI}.
 *
 * Derived from `@isaul32/ckeditor5-math`; see the `LICENSE` and `README.md` next to this file.
 */
export default class Math extends Plugin {
	public static get requires() {
		return [ MathEditing, MathUI, Widget ] as const;
	}

	public static get pluginName() {
		return 'Math' as const;
	}
}

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Math.pluginName ]: Math;
		[ MathEditing.pluginName ]: MathEditing;
		[ MathUI.pluginName ]: MathUI;
	}

	interface CommandsMap {
		math: MathCommand;
	}

	interface EditorConfig {
		math?: {
			engine?:
				| 'mathjax'
				| 'katex'
				| ( ( equation: string, element: HTMLElement, display: boolean ) => void )
				| undefined;
			lazyLoad?: undefined | ( () => Promise<void> );
			outputType?: 'script' | 'span' | undefined;
			className?: string | undefined;
			forceOutputType?: boolean | undefined;
			enablePreview?: boolean | undefined;
			enableMathField?: boolean | undefined;
			previewClassName?: Array<string> | undefined;
			popupClassName?: Array<string> | undefined;
			katexRenderOptions?: Partial<KatexOptions> | undefined;
		};
	}
}
