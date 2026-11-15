import {
    BalloonPanelView, Command, type DowncastAttributeEvent, type DropdownView, type Editor,
    IconObjectCenter, IconObjectInlineLeft, IconObjectInlineRight, IconObjectLeft, IconObjectRight,
    type Locale, type ModelElement, Plugin, type PositioningFunction, type ViewElement
} from "ckeditor5";

import { createPositionDropdown } from "./position_dropdown.js";
import type { ResizeAnchor } from "./resizable_widgets/resizable_widgets.js";

/**
 * Where a widget is placed in the text: on lines of its own, at the left, the center or the right
 * ("Break text"), or with the text wrapped around it, at the left or the right ("Wrap text").
 */
export const POSITIONS = [ "left", "center", "right", "wrap-left", "wrap-right" ] as const;

export type PositionValue = typeof POSITIONS[number];

/** The positions of a widget that cannot be placed now. */
export const NO_POSITIONS: readonly PositionValue[] = [];

/** The positions saved as `data-position`. Centered, the default, is not saved. */
const SAVED_POSITIONS: unknown[] = [ "left", "right", "wrap-left", "wrap-right" ];

/** How the widgets of a model element are placed in the text. */
export interface PositionedWidgetConfig {
    /** The name of the command that sets the position of the selected widget. */
    commandName: string;
    /** The positions that `element` can take now. Every position by default. */
    getPositions?: (element: ModelElement) => readonly PositionValue[];
    /** Where the stylesheet places `element`. Its saved position by default. */
    getPosition?: (element: ModelElement) => PositionValue;
}

/**
 * Lets the user place widgets in the text, on lines of their own or with the text wrapped around
 * them. A widget's converters save the position with `getPositionAttributes()` and load it with
 * `getPositionOfView()`, and the widget's stylesheet places it by `data-position`.
 */
export default class PositionedWidgets extends Plugin {

    private readonly configs = new Map<string, PositionedWidgetConfig>();

    static get pluginName() {
        return "PositionedWidgets" as const;
    }

    /**
     * Makes the widgets of `modelName` positioned, and registers and returns their command. Call
     * it from `init()` of the widget's plugin, after the widget's schema.
     */
    register(modelName: string, config: PositionedWidgetConfig): WidgetPositionCommand {
        const editor = this.editor;
        this.configs.set(modelName, config);
        editor.model.schema.extend(modelName, { allowAttributes: "position" });

        editor.conversion.for("editingDowncast").add((dispatcher) => {
            dispatcher.on<DowncastAttributeEvent>(`attribute:position:${modelName}`,
                (_evt, data, api) => {
                    const viewElement = api.mapper.toViewElement(data.item as ModelElement);
                    /* v8 ignore next 3 -- converted after the widget itself, so always mapped */
                    if (!viewElement) {
                        return;
                    }

                    const value = data.attributeNewValue;
                    if (value) {
                        api.writer.setAttribute("data-position", String(value), viewElement);
                    } else {
                        api.writer.removeAttribute("data-position", viewElement);
                    }
                });
        });

        const command = new WidgetPositionCommand(editor, modelName, config);
        editor.commands.add(config.commandName, command);
        return command;
    }

    /** Where `element` is placed in the text. */
    getPosition(element: ModelElement): PositionValue {
        const getPosition = this.configs.get(element.name)?.getPosition ?? getSavedPosition;
        return getPosition(element);
    }

    /**
     * The edge that the stylesheet places `element` against, which stays in place while it is
     * resized and which its toolbar is level with.
     */
    getAnchor(element: ModelElement): ResizeAnchor {
        const position = this.getPosition(element);
        if (position === "left" || position === "wrap-left") {
            return "left";
        }
        return position === "right" || position === "wrap-right" ? "right" : "center";
    }
}

/**
 * Sets where the selected widget, or the widget around the selection, is placed in the text.
 * Centered removes the position.
 */
export class WidgetPositionCommand extends Command {
    /** The position of the selected widget, or `null`. */
    declare value: PositionValue | null;
    /** The positions that the selected widget can take now, or none. */
    declare positions: readonly PositionValue[];

    constructor(
        editor: Editor,
        private readonly modelName: string,
        private readonly config: PositionedWidgetConfig
    ) {
        super(editor);
        this.set("positions", NO_POSITIONS);
    }

    override refresh() {
        const element = this.getWidget();
        const positions = element ? this.getPositions(element) : NO_POSITIONS;

        this.isEnabled = positions.length > 0;
        this.value = element && this.isEnabled
            ? this.editor.plugins.get(PositionedWidgets).getPosition(element)
            : null;
        this.positions = positions;
    }

    override execute({ value }: { value: PositionValue }) {
        const element = this.getWidget();
        if (!element || !this.getPositions(element).includes(value)) {
            return;
        }

        this.editor.model.change((writer) => {
            if (SAVED_POSITIONS.includes(value)) {
                writer.setAttribute("position", value, element);
            } else {
                writer.removeAttribute("position", element);
            }
        });
    }

    private getPositions(element: ModelElement) {
        return this.config.getPositions?.(element) ?? POSITIONS;
    }

    /** The widget that the selection is on or inside, or `null`. */
    private getWidget(): ModelElement | null {
        const selection = this.editor.model.document.selection;
        const selectedElement = selection.getSelectedElement();
        if (selectedElement?.name === this.modelName) {
            return selectedElement;
        }

        return selection.getFirstPosition()?.findAncestor(this.modelName) ?? null;
    }
}

/**
 * Creates a dropdown that runs `commandName`, a `WidgetPositionCommand`, with the position picked.
 * Its rows and icons are those of the image position dropdown, and it hides the rows that the
 * command does not offer for the selected widget.
 */
export function createWidgetPositionDropdown(
    editor: Editor,
    locale: Locale,
    { commandName, label }: { commandName: string; label: string }
): DropdownView {
    const t = editor.t;
    return createPositionDropdown(editor, locale, {
        commandName,
        label,
        offeredProperty: "positions",
        groups: [
            {
                label: t("Break text"),
                rows: [
                    { value: "left", label: t("Align left"), icon: IconObjectLeft },
                    { value: "center", label: t("Align center"), icon: IconObjectCenter },
                    { value: "right", label: t("Align right"), icon: IconObjectRight }
                ]
            },
            {
                label: t("Wrap text"),
                rows: [
                    { value: "wrap-left", label: t("Align left"), icon: IconObjectInlineLeft },
                    { value: "wrap-right", label: t("Align right"), icon: IconObjectInlineRight }
                ]
            }
        ]
    });
}

/**
 * The positions of the toolbar of a positioned widget: level with the edge of the widget that
 * `getAnchor()` returns, then, or where those do not fit, the positions that
 * `WidgetToolbarRepository` gives a widget toolbar.
 */
export function getAnchoredToolbarPositions(getAnchor: () => ResizeAnchor): PositioningFunction[] {
    const {
        northArrowSouth, northArrowSouthWest, northArrowSouthEast, southArrowNorth,
        southArrowNorthWest, southArrowNorthEast, viewportStickyNorth
    } = BalloonPanelView.defaultPositions;

    return [
        alignToAnchor(northArrowSouth, { left: "arrow_sw", right: "arrow_se" }, getAnchor),
        alignToAnchor(southArrowNorth, { left: "arrow_nw", right: "arrow_ne" }, getAnchor),
        alignToAnchor(viewportStickyNorth, { left: "arrowless", right: "arrowless" }, getAnchor),
        northArrowSouth, northArrowSouthWest, northArrowSouthEast,
        southArrowNorth, southArrowNorthWest, southArrowNorthEast, viewportStickyNorth
    ];
}

/** The `data-position` attribute of `element`, when it is not centered. */
export function getPositionAttributes(element: ModelElement): Record<string, string> {
    const position = element.getAttribute("position");
    return SAVED_POSITIONS.includes(position) ? { "data-position": position as string } : {};
}

/** The position in the `data-position` attribute of a saved widget, when not centered. */
export function getPositionOfView(viewElement: ViewElement): { position?: PositionValue } {
    const position = viewElement.getAttribute("data-position");
    return SAVED_POSITIONS.includes(position) ? { position: position as PositionValue } : {};
}

/** The saved position of `element`, or centered. */
function getSavedPosition(element: ModelElement): PositionValue {
    const position = element.getAttribute("position");
    return POSITIONS.find((value) => value === position) ?? "center";
}

/** The arrow names of a toolbar level with the left and with the right edge of its target. */
type EdgeArrows = Record<"left" | "right", string>;

/**
 * `position` moved level with the edge of the target that `getAnchor()` returns, with the arrow
 * that `arrows` names for that edge. A centered target gets no position.
 */
function alignToAnchor(
    position: PositioningFunction,
    arrows: EdgeArrows,
    getAnchor: () => ResizeAnchor
): PositioningFunction {
    return (targetRect, balloonRect, viewportRect, limiterRect) => {
        const anchor = getAnchor();
        if (anchor !== "left" && anchor !== "right") {
            return null;
        }

        const result = position(targetRect, balloonRect, viewportRect, limiterRect);
        return result && {
            ...result,
            left: anchor === "left" ? targetRect.left : targetRect.right - balloonRect.width,
            name: arrows[anchor]
        };
    };
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ PositionedWidgets.pluginName ]: PositionedWidgets;
    }
}
