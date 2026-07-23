import type Math from './math.js';
import MathCommand from './mathcommand.js';
import MathEditing from './mathediting.js';
import MathUI from './mathui.js';
import { KatexOptions } from './typings-external.js';

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
