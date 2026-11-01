import { Plugin } from 'ckeditor5';

import MermaidUI, { type MermaidSample } from './mermaid_ui.js';

/**
 * The Mermaid diagram feature: the button and the slash commands that insert a diagram. A diagram
 * is an embed of its source, which `ContentEmbedInlineSource` keeps as a `language-mermaid` code
 * block and the host renders, so `mermaid` must be one of `contentEmbed.inlineLanguages`.
 */
export default class Mermaid extends Plugin {
	static get requires() {
		return [ MermaidUI ];
	}

	public static get pluginName() {
		return 'Mermaid' as const;
	}
}

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Mermaid.pluginName ]: Mermaid;
		[ MermaidUI.pluginName ]: MermaidUI;
	}

	interface EditorConfig {
		mermaid?: {
			/** Diagram templates listed in the insert-diagram split button's dropdown. */
			samples?: MermaidSample[];
		};
	}
}
