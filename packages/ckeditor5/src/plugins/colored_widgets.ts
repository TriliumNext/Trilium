import {
    type Command, type DecoratedMethodEvent, type ModelItem, type ModelWriter, Plugin, priorities,
    type UpcastElementEvent
} from "ckeditor5";

/**
 * Lets the font color and background color commands color a selected widget, as they color text.
 * The widget's element saves each color in its inline style with the variable that
 * `AdaptiveColors` writes for text, so the shared stylesheet adapts the color to the theme. The
 * widget's own stylesheet decides which of its parts show the color.
 */
export default class ColoredWidgets extends Plugin {

    private readonly modelNames = new Set<string>();

    static get pluginName() {
        return "ColoredWidgets" as const;
    }

    init() {
        this.editor.conversion.for("upcast").add((dispatcher) => {
            // After the widget's own converter sets `modelRange`, and before General HTML Support
            // keeps the styles that are left.
            dispatcher.on<UpcastElementEvent>("element", (_evt, data, { consumable, writer }) => {
                const element = data.modelRange?.start.nodeAfter;
                if (!element?.is("element") || !this.modelNames.has(element.name)) {
                    return;
                }

                for (const { key, property } of COLORS) {
                    const value = data.viewItem.getStyle(property);
                    if (value && consumable.consume(data.viewItem, { styles: property })) {
                        writer.setAttribute(key, value, element);
                    }
                }
            }, { priority: priorities.get("low") + 1 });
        });
    }

    afterInit() {
        for (const { key } of COLORS) {
            const command = this.editor.commands.get(key);
            if (command) {
                this.showWidgetColor(command, key);
            }
        }
    }

    /**
     * Lets the font color and background color commands color the widgets of `modelName`. Call it
     * from `init()` of the widget's plugin, after the widget's schema.
     */
    register(modelName: string) {
        const { conversion, model } = this.editor;
        this.modelNames.add(modelName);
        model.schema.extend(modelName, { allowAttributes: COLORS.map(({ key }) => key) });

        for (const { key, property, variable } of COLORS) {
            conversion.for("downcast").attributeToAttribute({
                model: { name: modelName, key },
                view: (value: string) => ({
                    key: "style",
                    value: { [property]: value, [variable]: value }
                }),
                // Before the converters of colored text, which wrap a widget in a `<span>`.
                converterPriority: "highest"
            });
        }
    }

    /**
     * Gives `command` the color of the selected widget. A selection reads the colors of an inline
     * widget, but not those of a block.
     */
    private showWidgetColor(command: Command, key: string) {
        command.decorate("refresh");
        this.listenTo<DecoratedMethodEvent<Command, "refresh">>(command, "refresh", () => {
            const element = this.editor.model.document.selection.getSelectedElement();
            if (element && this.modelNames.has(element.name)) {
                command.value = element.getAttribute(key);
            }
        }, { priority: "low" });
    }
}

/**
 * Gives `target` the colors of `source` that the schema allows on it, for a feature that replaces
 * a widget or text with another element or text.
 */
export function copyColors(writer: ModelWriter, source: ModelItem, target: ModelItem) {
    for (const { key } of COLORS) {
        const value = source.getAttribute(key);
        if (value !== undefined && writer.model.schema.checkAttribute(target, key)) {
            writer.setAttribute(key, value, target);
        }
    }
}

/**
 * The attributes of the font color and background color commands, and the style property and the
 * `AdaptiveColors` variable that a colored widget's element saves each in.
 */
const COLORS = [
    { key: "fontColor", property: "color", variable: "--tn-color" },
    { key: "fontBackgroundColor", property: "background-color", variable: "--tn-background" }
] as const;
