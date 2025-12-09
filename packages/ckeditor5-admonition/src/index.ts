import admonitionIcon from '../theme/icons/admonition.svg?raw';
import './augmentation.js';
import "../theme/blockquote.css";

export { default as Admonition } from './admonition.js';
export { default as AdmonitionEditing } from './admonitionediting.js';
export { default as AdmonitionUI, ADMONITION_TYPES } from './admonitionui.js';
export { default as AdmonitionAutoformat } from './admonitionautoformat.js';
export type { default as AdmonitionCommand, AdmonitionType } from './admonitioncommand.js';

export const icons = {
	admonitionIcon
};
