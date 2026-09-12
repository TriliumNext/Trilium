import { ComponentChild, createContext, render, type JSX, type RefObject } from "preact";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";

export const ParentComponent = createContext<Component | null>(null);

export const NoteContextContext = createContext<NoteContext | null>(null);

/**
 * Whether the container (e.g. a dialog) holding the current note view is actually shown. False inside a dialog
 * that's hidden but kept mounted in the DOM (e.g. the quick-edit popup with `keepInDom`), so descendants like
 * media players can stop instead of playing on invisibly. Defaults to true — no enclosing dialog means shown.
 */
export const ContainerVisibilityContext = createContext(true);

/**
 * Takes in a React ref and returns a corresponding JQuery selector.
 *
 * @param ref the React ref from which to obtain the jQuery selector.
 * @returns the corresponding jQuery selector.
 */
export function refToJQuerySelector<T extends HTMLElement>(ref: RefObject<T> | null): JQuery<T> {
    if (ref?.current) {
        return $(ref.current);
    } else {
        return $();
    }
}

/**
 * Renders a React component and returns the corresponding DOM element wrapped in JQuery.
 *
 * @param parentComponent the parent Trilium component for the component to be able to handle events.
 * @param el the JSX element to render.
 * @returns the rendered wrapped DOM element.
 */
export function renderReactWidget(parentComponent: Component | null, el: JSX.Element) {
    return renderReactWidgetAtElement(parentComponent, el, new DocumentFragment()).children();
}

export function renderReactWidgetAtElement(parentComponent: Component | null, el: JSX.Element, container: Element | DocumentFragment) {
    render((
        <ParentComponent.Provider value={parentComponent}>
            {el}
        </ParentComponent.Provider>
    ), container);
    return $(container) as JQuery<HTMLElement>;
}

/**
 * Unmounts the tree rendered into `container`, running every effect cleanup and releasing the DOM
 * the vnodes still point at. `container` has to be the element the tree was rendered *into* -- for a
 * widget built by `renderReactWidget()` that is the fragment, not the `$widget` it returned.
 */
export function disposeReactWidget(container: Element | DocumentFragment) {
    render(null, container);
}

export function joinElements(components: ComponentChild[] | undefined, separator: ComponentChild = ", ") {
    if (!components) return <></>;

    const joinedComponents: ComponentChild[] = [];
    for (let i=0; i<components.length; i++) {
        joinedComponents.push(components[i]);
        if (i + 1 < components.length) {
            joinedComponents.push(separator);
        }
    }

    return <>{joinedComponents}</>;
}
