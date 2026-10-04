import {
    type DowncastAttributeEvent,
    type ModelElement,
    Plugin,
    type UpcastElementEvent,
    type ViewElement
} from "ckeditor5";

/**
 * Saves the colors of text and tables a second time as CSS variables: `--tn-color`,
 * `--tn-background` and `--tn-border-color`. The app's and the share theme's stylesheets derive a
 * shade that suits the theme from them; everything else shows the color itself, which stays in the
 * markup. The variables never reach the model.
 */
export default class AdaptiveColors extends Plugin {

    static get pluginName() {
        return "AdaptiveColors" as const;
    }

    init() {
        this.convertTextColor("fontColor", "color", "--tn-color");
        this.convertTextColor("fontBackgroundColor", "background-color", "--tn-background");
        this.addVariable("table", "tableBackgroundColor", "--tn-background");
        this.addVariable("table", "tableBorderColor", "--tn-border-color");
        this.addVariable("tableCell", "tableCellBackgroundColor", "--tn-background");
        this.addVariable("tableCell", "tableCellBorderColor", "--tn-border-color");
        this.dropVariablesOnLoad();
    }

    /** Writes a text color or highlight as CKEditor does, with the variable next to it. */
    private convertTextColor(modelKey: string, property: string, variable: string) {
        this.editor.conversion.for("downcast").attributeToElement({
            model: modelKey,
            view: (value: string, { writer }) => writer.createAttributeElement(
                "span",
                { style: `${property}:${value};${variable}:${value}` },
                // CKEditor's own priority for font colors, so the two spans of a run merge.
                { priority: 7 }
            ),
            converterPriority: "high"
        });
    }

    /**
     * Sets the variable on the `<table>` or the cell next to the style CKEditor writes for the
     * attribute, leaving CKEditor's conversion in place. A border whose sides differ gets none.
     */
    private addVariable(modelElement: string, attribute: string, variable: string) {
        this.editor.conversion.for("downcast").add((dispatcher) => {
            dispatcher.on<DowncastAttributeEvent<ModelElement>>(
                `attribute:${attribute}:${modelElement}`,
                (eventInfo, data, { consumable, mapper, writer }) => {
                    if (!consumable.test(data.item, eventInfo.name)) {
                        return;
                    }

                    const element = findStyledElement(mapper.toViewElement(data.item));
                    /* v8 ignore next -- CKEditor gives every table and cell a view element, and
                       draws a table as a `<figure>` holding its `<table>`. */
                    if (!element) {
                        return;
                    }

                    const value = data.attributeNewValue;
                    if (typeof value === "string" && value) {
                        writer.setStyle(variable, value, element);
                    } else {
                        writer.removeStyle(variable, element);
                    }
                },
                { priority: "high" }
            );
        });
    }

    /** Takes the variables off loaded elements, so General HTML Support cannot keep a stale one. */
    private dropVariablesOnLoad() {
        this.editor.conversion.for("upcast").add((dispatcher) => {
            dispatcher.on<UpcastElementEvent>(
                "element",
                (_eventInfo, { viewItem }, { consumable }) => {
                    for (const variable of VARIABLES) {
                        if (viewItem.hasStyle(variable)) {
                            consumable.consume(viewItem, { styles: variable });
                        }
                    }
                },
                { priority: "highest" }
            );
        });
    }

}

const VARIABLES = [ "--tn-color", "--tn-background", "--tn-border-color" ];

/** The cell itself, or the `<table>` inside the table widget's `<figure>`. */
function findStyledElement(viewElement: ViewElement | undefined) {
    if (!viewElement?.is("element", "figure")) {
        return viewElement;
    }

    return [ ...viewElement.getChildren() ]
        .find((child): child is ViewElement => child.is("element", "table"));
}
