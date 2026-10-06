import "../../theme/resizable_widgets.css";

import {
    type DowncastAttributeEvent,
    type DowncastInsertEvent,
    type ModelElement,
    Plugin,
    type ViewDowncastWriter,
    type ViewElement,
    WidgetToolbarRepository
} from "ckeditor5";

import { type ResizeAxes, type ResizeSize, startResizeGesture } from "./resize_gesture.js";

/** How the widgets of a model element are resized. */
export interface ResizableWidgetConfig {
    /**
     * The prefix of the CSS custom properties that save the size on the widget,
     * `<prefix>-width` and `<prefix>-height`. The widget's stylesheet applies them.
     */
    propertyPrefix: string;
    isWidthResizable?: boolean;
    isHeightResizable?: boolean;
    /** Whether the widget's stylesheet centers it, so that its width changes on both sides. */
    isCentered?: boolean;
    /** A selector for the element inside the widget whose height changes, or the widget. */
    heightTarget?: string;
    /** The smallest width, in `em`. */
    minWidth?: number;
    /** The smallest height, in `em`. */
    minHeight?: number;
    /** Whether `element` can be resized in its current state. Always by default. */
    isResizable?: (element: ModelElement) => boolean;
}

type Axis = keyof ResizeAxes;

/** The model attributes that store the size, in `em`. */
export const SIZE_ATTRIBUTES: Record<Axis, string> = {
    width: "customWidth",
    height: "customHeight"
};

const HANDLES: Record<string, ResizeAxes> = {
    width: { width: true, height: false },
    height: { width: false, height: true },
    corner: { width: true, height: true }
};

const RESIZABLE_CLASS = "ck-widget_resizable";
const RESIZING_CLASS = "ck-widget_resizing";
const TOOLBAR_LOCK = "ResizableWidgets";
const DEFAULT_MIN_SIZE = 2;
const DOUBLE_TAP_MS = 400;
const EM_PATTERN = /^\d+(\.\d+)?em$/;

/**
 * Lets the user resize widgets by dragging handles on their inline-end edge, bottom edge and
 * corner, with a mouse, a pen or a finger. Double-clicking a handle resets its size.
 */
export default class ResizableWidgets extends Plugin {

    private lastTap: { handle: Element; time: number } | null = null;
    /** Cancels the resize under way, if any. */
    private cancelResize: (() => void) | null = null;

    static get pluginName() {
        return "ResizableWidgets" as const;
    }

    /** Makes the widgets of `modelName` resizable. Call it from `init()` of the widget's plugin. */
    register(modelName: string, config: ResizableWidgetConfig) {
        const editor = this.editor;
        const axes = getAxes(config);
        editor.model.schema.extend(modelName, {
            allowAttributes: axes.map((axis) => SIZE_ATTRIBUTES[axis])
        });

        for (const axis of axes) {
            const property = `${config.propertyPrefix}-${axis}`;
            editor.conversion.for("upcast").attributeToAttribute({
                view: { styles: { [property]: EM_PATTERN } },
                model: {
                    key: SIZE_ATTRIBUTES[axis],
                    value: (viewElement: ViewElement) => viewElement.getStyle(property)
                }
            });
            editor.conversion.for("downcast").attributeToAttribute({
                model: { name: modelName, key: SIZE_ATTRIBUTES[axis] },
                view: (value: string) => ({ key: "style", value: { [property]: value } })
            });
        }

        editor.conversion.for("editingDowncast").add((dispatcher) => {
            const insertEvent = `insert:${modelName}` as const;
            dispatcher.on<DowncastInsertEvent<ModelElement>>(insertEvent, (_evt, { item }, api) => {
                const viewElement = api.mapper.toViewElement(item);
                /* v8 ignore next 3 -- the widget's own converter has drawn it */
                if (!viewElement) {
                    return;
                }

                const subject = { element: item, viewElement, config };
                const handles = this.createHandles(api.writer, subject, axes);
                api.writer.insert(api.writer.createPositionAt(viewElement, "end"), handles);
                updateResizableClass(api.writer, viewElement, item, config);
            }, { priority: "low" });

            if (config.isResizable) {
                dispatcher.on<DowncastAttributeEvent>("attribute", (_evt, { item }, api) => {
                    if (!item.is("element", modelName)) {
                        return;
                    }

                    const viewElement = api.mapper.toViewElement(item);
                    /* v8 ignore next 3 -- converted after the widget itself, so always mapped */
                    if (!viewElement) {
                        return;
                    }

                    updateResizableClass(api.writer, viewElement, item, config);
                }, { priority: "low" });
            }
        });
    }

    override destroy() {
        this.cancelResize?.();
        super.destroy();
    }

    private createHandles(writer: ViewDowncastWriter, subject: ResizeSubject, axes: Axis[]) {
        const names = axes.length === 2 ? Object.keys(HANDLES) : axes;
        const startResize = (event: PointerEvent, handle: HTMLElement, name: string) => {
            this.startResize(event, handle, HANDLES[name], subject);
        };

        return writer.createUIElement("div", {
            class: "ck-widget__resize-handles",
            "aria-hidden": "true",
            "data-cke-ignore-events": "true"
        }, function (domDocument) {
            const domElement = this.toDomElement(domDocument);
            for (const name of names) {
                const handle = domDocument.createElement("div");
                handle.className = `ck-widget__resize-handle ck-widget__resize-handle_${name}`;
                handle.addEventListener("pointerdown", (event) => startResize(event, handle, name));
                domElement.append(handle);
            }
            return domElement;
        });
    }

    private startResize(
        event: PointerEvent,
        handle: HTMLElement,
        handleAxes: ResizeAxes,
        { element, viewElement, config }: ResizeSubject
    ) {
        const editor = this.editor;
        const widget = handle.parentElement?.parentElement;
        if (!widget || editor.isReadOnly || event.button !== 0 || !event.isPrimary) {
            return;
        }

        const heightTarget = handleAxes.height ? findHeightTarget(widget, config) : null;
        const axes = { width: handleAxes.width, height: !!heightTarget };
        if (!axes.width && !axes.height) {
            return;
        }

        event.preventDefault();
        editor.editing.view.focus();
        editor.model.enqueueChange({ isUndoable: false }, (writer) => {
            writer.setSelection(element, "on");
        });

        const targets: Record<Axis, HTMLElement> = {
            width: widget,
            height: heightTarget ?? widget
        };
        const toolbars = editor.plugins.has(WidgetToolbarRepository)
            ? editor.plugins.get(WidgetToolbarRepository)
            : null;
        const finish = () => {
            toolbars?.clearForceDisabled(TOOLBAR_LOCK);
            this.showSize(viewElement, getSavedSize(element, config), config, false);
        };

        // One resize at a time: another pointer, such as a pen beside the mouse, cancels the first.
        this.cancelResize?.();
        this.cancelResize = startResizeGesture(event, {
            handle,
            axes,
            widthTarget: targets.width,
            isCentered: !!config.isCentered,
            heightTarget: targets.height,
            minWidth: toPixels(config.minWidth ?? DEFAULT_MIN_SIZE, targets.width),
            minHeight: toPixels(config.minHeight ?? DEFAULT_MIN_SIZE, targets.height),
            onPreview: (size) => {
                toolbars?.forceDisabled(TOOLBAR_LOCK);
                this.showSize(viewElement, toEmSize(size, targets), config, true);
            },
            onCommit: (size) => {
                this.saveSize(element, toEmSize(size, targets));
                finish();
            },
            onCancel: finish,
            onTap: () => {
                if (this.isDoubleTap(handle)) {
                    this.saveSize(element, {
                        ...(axes.width ? { width: null } : {}),
                        ...(axes.height ? { height: null } : {})
                    });
                }
            }
        });
    }

    /** Shows `size` on the widget's view without changing the model. */
    private showSize(
        viewElement: ViewElement,
        size: SizeValues,
        config: ResizableWidgetConfig,
        isResizing: boolean
    ) {
        this.editor.editing.view.change((writer) => {
            if (isResizing) {
                writer.addClass(RESIZING_CLASS, viewElement);
            } else {
                writer.removeClass(RESIZING_CLASS, viewElement);
            }

            for (const [ axis, value ] of Object.entries(size)) {
                const property = `${config.propertyPrefix}-${axis}`;
                if (value) {
                    writer.setStyle(property, value, viewElement);
                } else {
                    writer.removeStyle(property, viewElement);
                }
            }
        });
    }

    /** Saves `size` on `element` in one undo step, unless it was removed meanwhile. */
    private saveSize(element: ModelElement, size: SizeValues) {
        const model = this.editor.model;
        if (element.root === model.document.graveyard) {
            return;
        }

        model.change((writer) => {
            for (const [ axis, value ] of Object.entries(size) as [Axis, string | null][]) {
                if (value) {
                    writer.setAttribute(SIZE_ATTRIBUTES[axis], value, element);
                } else {
                    writer.removeAttribute(SIZE_ATTRIBUTES[axis], element);
                }
            }
        });
    }

    /** Whether a tap on `handle` follows another one on it closely enough to make a double tap. */
    private isDoubleTap(handle: Element) {
        const now = performance.now();
        const isDoubleTap = this.lastTap?.handle === handle
            && now - this.lastTap.time < DOUBLE_TAP_MS;
        this.lastTap = isDoubleTap ? null : { handle, time: now };
        return isDoubleTap;
    }
}

/** A size in `em`, where `null` is the size the widget takes by itself. */
type SizeValues = Partial<Record<Axis, string | null>>;

/** A rendered widget that can be resized. */
interface ResizeSubject {
    element: ModelElement;
    viewElement: ViewElement;
    config: ResizableWidgetConfig;
}

function getAxes(config: ResizableWidgetConfig) {
    const axes: Axis[] = [];
    if (config.isWidthResizable) {
        axes.push("width");
    }
    if (config.isHeightResizable) {
        axes.push("height");
    }
    return axes;
}

function updateResizableClass(
    writer: ViewDowncastWriter,
    viewElement: ViewElement,
    element: ModelElement,
    config: ResizableWidgetConfig
) {
    if (config.isResizable?.(element) ?? true) {
        writer.addClass(RESIZABLE_CLASS, viewElement);
    } else {
        writer.removeClass(RESIZABLE_CLASS, viewElement);
    }
}

/** The element whose height changes, when it is rendered. */
function findHeightTarget(widget: HTMLElement, config: ResizableWidgetConfig) {
    const target = config.heightTarget
        ? widget.querySelector<HTMLElement>(config.heightTarget)
        : widget;
    return target?.getClientRects().length ? target : null;
}

/** The size saved on `element`, for every axis it can be resized on. */
function getSavedSize(element: ModelElement, config: ResizableWidgetConfig): SizeValues {
    const size: SizeValues = {};
    for (const axis of getAxes(config)) {
        size[axis] = element.getAttribute(SIZE_ATTRIBUTES[axis]) as string | undefined ?? null;
    }
    return size;
}

function toEmSize(size: ResizeSize, targets: Record<Axis, HTMLElement>): SizeValues {
    const values: SizeValues = {};
    for (const axis of [ "width", "height" ] as const) {
        const pixels = size[axis];
        if (pixels !== undefined) {
            values[axis] = pixels === null ? null : toEm(pixels, targets[axis]);
        }
    }
    return values;
}

/** `pixels` in `em` of `element`, to one decimal. */
function toEm(pixels: number, element: HTMLElement) {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    return `${Math.round(pixels / fontSize * 10) / 10}em`;
}

function toPixels(em: number, element: HTMLElement) {
    return em * parseFloat(getComputedStyle(element).fontSize);
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ ResizableWidgets.pluginName ]: ResizableWidgets;
    }
}
