import katex from "katex";
import "katex/contrib/mhchem";

import "./katex.scss";

export { default as renderMathInElement } from "katex/contrib/auto-render";
export default katex;
