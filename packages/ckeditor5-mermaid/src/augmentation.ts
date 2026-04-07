import type { Mermaid } from './index.js';
import MermaidEditing from './mermaidediting.js';
import MermaidToolbar from './mermaidtoolbar.js';
import MermaidUI from './mermaidui.js';

declare global {
	interface MermaidInstance {
		initialize(config: MermaidConfig): void;
		render(id: string, source: string): Promise<{ svg: string }>;
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
		[ MermaidUI.pluginName]: MermaidUI;
	}

	interface EditorConfig {
		"mermaid"?: {
			lazyLoad?: () => Promise<MermaidInstance> | MermaidInstance;
			config: MermaidConfig;
		}
	}

}

