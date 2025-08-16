import { createContext, JSX, render } from "preact";
import BasicWidget from "../basic_widget.js";
import Component from "../../components/component.js";

export const ParentComponent = createContext<Component | null>(null);

export default abstract class ReactBasicWidget extends BasicWidget {

    abstract get component(): JSX.Element;

    doRender() {        
        this.$widget = renderReactWidget(this, this.component);
    }

}

/**
 * Renders a React component and returns the corresponding DOM element wrapped in JQuery.
 * 
 * @param parentComponent the parent Trilium component for the component to be able to handle events.
 * @param el the JSX element to render.
 * @returns the rendered wrapped DOM element.
 */
export function renderReactWidget(parentComponent: Component, el: JSX.Element) {
    const renderContainer = new DocumentFragment();
    render((
        <ParentComponent.Provider value={parentComponent}>
            {el}
        </ParentComponent.Provider>
    ), renderContainer);
    return $(renderContainer.children) as JQuery<HTMLElement>;
}