import './augmentation.js';

export { default as Mermaid } from './mermaid.js';
export { INSERT_MERMAID_COMMAND } from './commands/insertMermaidCommand.js';
export type { MermaidSample } from './mermaidui.js';
import infoIcon from './../theme/icons/info.svg?raw';
import insertMermaidIcon from './../theme/icons/insert.svg?raw';
import previewModeIcon from './../theme/icons/preview-mode.svg?raw';
import splitModeIcon from './../theme/icons/split-mode.svg?raw';
import sourceModeIcon from './../theme/icons/source-mode.svg?raw';
import "../theme/mermaid.css";

export const icons = {
	infoIcon,
	insertMermaidIcon,
	previewModeIcon,
	splitModeIcon,
	sourceModeIcon
};
