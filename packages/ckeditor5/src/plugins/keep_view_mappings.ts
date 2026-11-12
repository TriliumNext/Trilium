import { Plugin, type ViewElement } from "ckeditor5";

/**
 * Keeps a view element bound to the DOM element that the renderer moved it to.
 *
 * `Renderer._updateChildrenMappings()` can bind a reused view element, such as the `<span>` of a
 * highlight, to another DOM element and then unbind the DOM element it had, which in
 * `ViewDomConverter.unbindDomElement()` drops the new binding too. The next render then throws in
 * `_updateDomSelection()`.
 */
export default class KeepViewMappings extends Plugin {

    static get pluginName() {
        return "KeepViewMappings" as const;
    }

    init() {
        const domConverter = this.editor.editing.view.domConverter;
        const unbindDomElement = domConverter.unbindDomElement.bind(domConverter);

        domConverter.unbindDomElement = (domElement) => {
            const viewElement = domConverter.mapDomToView(domElement) as ViewElement | undefined;
            const boundDomElement = viewElement && domConverter.mapViewToDom(viewElement);
            unbindDomElement(domElement);
            if (viewElement && boundDomElement && boundDomElement !== domElement) {
                domConverter.bindElements(boundDomElement, viewElement);
            }
        };
    }

}
