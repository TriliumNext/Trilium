import ckeditor from './../theme/icons/math.svg?raw';
import './augmentation.js';
import "../theme/mathform.css";
import 'mathlive';
import 'mathlive/fonts.css';
import 'mathlive/static.css';

export { default as Math } from './math.js';
export { default as MathUI } from './mathui.js';
export { default as AutoformatMath } from './autoformatmath.js';

export const icons = {
	ckeditor
};
