import type { CSSProperties, RefObject, VNode } from "preact";
import { useContext, useDebugValue, useEffect, useMemo, useRef } from "preact/hooks";

import type Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type BasicWidget from "../../basic_widget";
import NoteContextAwareWidget from "../../note_context_aware_widget";
import { ParentComponent } from "../react_utils";

export function useLegacyWidget<T extends BasicWidget>(widgetFactory: () => T, { noteContext, containerId, containerClassName, containerStyle }: {
    noteContext?: NoteContext;
    /** The id of the element the widget is attached to, for stylesheets that select the widget as its child. */
    containerId?: string;
    containerClassName?: string;
    containerStyle?: CSSProperties;
} = {}): [VNode, T] {
    const ref = useRef<HTMLDivElement>(null);
    const parentComponent = useContext(ParentComponent);

    // Render the widget once - note that noteContext is intentionally NOT a dependency
    // to prevent creating new widget instances on every note switch.
    const [ widget, renderedWidget ] = useMemo(() => {
        const widget = widgetFactory();

        if (parentComponent) {
            parentComponent.child(widget);
        }

        const renderedWidget = widget.render();
        return [ widget, renderedWidget ];
    }, [ parentComponent ]); // eslint-disable-line react-hooks/exhaustive-deps
    // widgetFactory() and noteContext are intentionally left out - widget should be created once
    // and updated via activeContextChangedEvent when noteContext changes.

    // Cleanup: remove widget from parent's children when unmounted
    useEffect(() => {
        return () => {
            if (parentComponent) {
                parentComponent.removeChild(widget);
            }
            widget.cleanup();
        };
    }, [ parentComponent, widget ]);

    // Attach the widget to the parent.
    useEffect(() => {
        const parentContainer = ref.current;
        if (parentContainer) {
            parentContainer.replaceChildren();
            renderedWidget.appendTo(parentContainer);
        }
    }, [ renderedWidget ]);

    // Inject the note context - this updates the existing widget without recreating it.
    // We check if the context actually changed to avoid double refresh when the event system
    // also delivers activeContextChanged to the widget through component tree propagation.
    useEffect(() => {
        if (noteContext && widget instanceof NoteContextAwareWidget) {
            // Only trigger refresh if the context actually changed.
            // The event system may have already updated the widget, in which case
            // widget.noteContext will already equal noteContext.
            if (widget.noteContext !== noteContext) {
                widget.activeContextChangedEvent({ noteContext });
            }
        }
    }, [ noteContext, widget ]);

    useDebugValue(widget);

    return [ <div id={containerId} className={containerClassName} style={containerStyle} ref={ref} />, widget ];
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function useLegacyImperativeHandlers(handlers: Record<string, Function>) {
    const parentComponent = useContext(ParentComponent);
    useEffect(() => {
        Object.assign(parentComponent as never, handlers);
    }, [ handlers ]);
}

/**
 * Marks an element as the one the parent component is found at, which is how anything outside the
 * component tree asks for it: `appContext.getComponentByEl` climbs the DOM to the nearest element
 * bearing a component and reads it off there.
 *
 * The counterpart of {@link useLegacyImperativeHandlers} — that hook writes methods onto the parent
 * component, and this is what lets a caller holding only a DOM node arrive at the same object, such
 * as `resolveFocusedComponent()`, which collects the shortcut hints of the focused element, or a
 * render note looking up its parent. A subtree whose parent component the DOM cannot name answers
 * with whichever widget encloses it.
 *
 * Only needed where a subtree provides a `ParentComponent` of its own. A component built as a widget
 * marks its own element (see `BasicWidget.render`), and a React tree mounted under one answers to
 * that same widget, so the two already agree everywhere else.
 */
export function useLegacyComponentElement(elRef: RefObject<HTMLElement | null>, component?: Component) {
    const contextComponent = useContext(ParentComponent);
    const parentComponent = component ?? contextComponent;

    useEffect(() => {
        const el = elRef.current;
        if (!el || !parentComponent) return;

        // The attribute is what the lookup searches by; the component itself is handed over as a
        // property of the element, which is where jQuery's `.prop("component")` reads it from. No
        // `component` class as a widget adds: nothing looks for it, and it carries the theme's
        // styling with it.
        el.dataset.componentId = parentComponent.componentId;
        (el as ComponentElement).component = parentComponent;

        return () => {
            delete el.dataset.componentId;
            delete (el as ComponentElement).component;
        };
    }, [ elRef, parentComponent ]);
}

type ComponentElement = HTMLElement & { component?: Component };
