import { lineText } from "../line_text.js";
import { Styles, TitleText } from "./parser.terms.js";

export const titleText = lineText(TitleText);

export const styles = lineText(Styles, [ 59 ]);
