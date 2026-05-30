import { Plugin } from "ckeditor5";

import CollapsibleEditing from "./collapsible-editing.js";
import CollapsibleUI from "./collapsible-ui.js";

export default class Collapsible extends Plugin {

    public static get requires() {
        return [CollapsibleEditing, CollapsibleUI] as const;
    }

    public static get pluginName() {
        return "Collapsible" as const;
    }

}
