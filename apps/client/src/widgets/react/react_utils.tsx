import { ComponentChild, createContext, render, type JSX, type RefObject } from "preact";
import { useContext } from "preact/hooks";

import type { CommandMappings, CommandNames } from "../../components/app_context";
import Component from "../../components/component";
import NoteContext from "../../components/note_context";

export const ParentComponent = createContext<Component | null>(null);

export const NoteContextContext = createContext<NoteContext | null>(null);

/** The `ntxId` of the quick-edit popup's note context. A nested popup's starts with it too. */
export const POPUP_EDITOR_NTX_ID = "_popup-editor";

/**
 * A click handler that triggers `command` from the surrounding component with the `ntxId` of the
 * note context the component stands in: the surrounding `NoteContextContext`, or else the one held by
 * the closest legacy ancestor, such as a split's. A handler can then act on the note of a context
 * that is not the active one, such as the quick edit popup's or an inactive split's, since a split
 * activates only once the click has reached it. Undefined when there is no command to trigger.
 */
export function useCommandTrigger(command: CommandNames | undefined) {
    const parentComponent = useContext(ParentComponent);
    const noteContext = useContext(NoteContextContext);

    return command && (() => {
        const ntxId = (noteContext ?? findClosestNoteContext(parentComponent))?.ntxId;
        parentComponent?.triggerCommand(command, { ntxId } as CommandMappings[typeof command]);
    });
}

/**
 * Finds the note context held by the closest legacy ancestor component (e.g. the note split's
 * `NoteWrapperWidget`). Used to initialize `useNoteContext()` for components that mount after
 * the initial `setNoteContext` event has been dispatched (e.g. components rendered via
 * `LazyComponent`), which would otherwise not know their context until the next note switch.
 */
export function findClosestNoteContext(component: Component | null): NoteContext | undefined {
    let current: Component | undefined = component ?? undefined;
    while (current) {
        if ("noteContext" in current) {
            const { noteContext } = current as { noteContext?: NoteContext };
            if (noteContext) {
                return noteContext;
            }
        }
        current = current.parent as Component | undefined;
    }
    return undefined;
}

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
export function refToJQuerySelector<T extends HTMLElement>(
    ref: RefObject<T | null> | null
): JQuery<T> {
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
