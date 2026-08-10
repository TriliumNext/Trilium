import { Plugin } from 'ckeditor5';

import "../../theme/mermaid.css";
import MermaidEditing from './mermaid_editing.js';
import MermaidToolbar from './mermaid_toolbar.js';
import MermaidUI, { type MermaidSample } from './mermaid_ui.js';

/**
 * The Mermaid diagram feature: a `<mermaid>` block widget with a source textarea and a rendered
 * preview, switchable between source / split / preview modes.
 *
 * This is a "glue" plugin which loads {@link MermaidEditing}, {@link MermaidToolbar} and
 * {@link MermaidUI}.
 *
 * The mermaid library itself is not a dependency — the host supplies it through
 * `config.mermaid.lazyLoad`, so the diagram renderer is only fetched when a diagram is shown.
 *
 * Derived from CKSource's `@ckeditor/ckeditor5-mermaid`; see `LICENSE.md` and `README.md` next to
 * this file.
 */
export default class Mermaid extends Plugin {

	static get requires() {
		return [ MermaidEditing, MermaidToolbar, MermaidUI ];
	}

	public static get pluginName() {
		return 'Mermaid' as const;
	}

}

declare global {
	interface MermaidInstance {
		initialize( config: MermaidConfig ): void;
		render( id: string, source: string ): Promise<{ svg: string }>;
	}

	interface MermaidConfig {

	}

	var mermaid: Mermaid | null | undefined;
}

declare module 'ckeditor5' {
	interface PluginsMap {
		[ Mermaid.pluginName ]: Mermaid;
		[ MermaidEditing.pluginName ]: MermaidEditing;
		[ MermaidToolbar.pluginName ]: MermaidToolbar;
		[ MermaidUI.pluginName ]: MermaidUI;
	}

	interface EditorConfig {
		"mermaid"?: {
			lazyLoad?: () => Promise<MermaidInstance> | MermaidInstance;
			config: MermaidConfig;
			/** Diagram templates listed in the insert-diagram split button's dropdown. */
			samples?: MermaidSample[];
		}
	}

}
