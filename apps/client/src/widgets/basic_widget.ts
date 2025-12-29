import { isValidElement, VNode } from "preact";

import Component, { TypedComponent } from "../components/component.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import toastService, { showErrorForScriptNote } from "../services/toast.js";
import { randomString } from "../services/utils.js";
import { renderReactWidget } from "./react/react_utils.jsx";

export class TypedBasicWidget<T extends TypedComponent<any>> extends TypedComponent<T> {
    protected attrs: Record<string, string>;
    private classes: string[];
    private childPositionCounter: number;
    private cssEl?: string;
    _noteId!: string;

    constructor() {
        super();

        this.attrs = {
            style: ""
        };
        this.classes = [];

        this.children = [];
        this.childPositionCounter = 10;
    }

    child(..._components: (T | VNode)[]) {
        if (!_components) {
            return this;
        }

        // Convert any React components to legacy wrapped components.
        const components = wrapReactWidgets(_components);

        super.child(...components);

        for (const component of components) {
            if (component.position === undefined) {
                component.position = this.childPositionCounter;
                this.childPositionCounter += 10;
            }
        }

        this.children.sort((a, b) => a.position - b.position);

        return this;
    }

    /**
     * Conditionally adds the given components as children to this component.
     *
     * @param condition whether to add the components.
     * @param components the components to be added as children to this component provided the condition is truthy.
     * @returns self for chaining.
     */
    optChild(condition: boolean, ...components: (T | VNode)[]) {
        if (condition) {
            return this.child(...components);
        }
        return this;
    }

    id(id: string) {
        this.attrs.id = id;
        return this;
    }

    class(className: string) {
        this.classes.push(className);
        return this;
    }

    /**
     * Sets the CSS attribute of the given name to the given value.
     *
     * @param name the name of the CSS attribute to set (e.g. `padding-inline-start`).
     * @param value the value of the CSS attribute to set (e.g. `12px`).
     * @returns self for chaining.
     */
    css(name: string, value: string) {
        this.attrs.style += `${name}: ${value};`;
        return this;
    }

    /**
     * Sets the CSS attribute of the given name to the given value, but only if the condition provided is truthy.
     *
     * @param condition `true` in order to apply the CSS, `false` to ignore it.
     * @param name the name of the CSS attribute to set (e.g. `padding-inline-start`).
     * @param value the value of the CSS attribute to set (e.g. `12px`).
     * @returns self for chaining.
     */
    optCss(condition: boolean, name: string, value: string) {
        if (condition) {
            return this.css(name, value);
        }

        return this;
    }

    contentSized() {
        this.css("contain", "none");

        return this;
    }

    collapsible() {
        this.css("min-height", "0");
        this.css("min-width", "0");
        return this;
    }

    filling() {
        this.css("flex-grow", "1");
        return this;
    }

    /**
     * Accepts a string of CSS to add with the widget.
     * @returns for chaining
     */
    cssBlock(block: string) {
        this.cssEl = block;
        return this;
    }

    render() {
        try {
            this.doRender();
        } catch (e: any) {
            this.logRenderingError(e);
        }

        this.$widget.attr("data-component-id", this.componentId);
        this.$widget.addClass("component").prop("component", this);

        if (!this.isEnabled()) {
            this.toggleInt(false);
        }

        if (this.cssEl) {
            const css = this.cssEl.trim().startsWith("<style>") ? this.cssEl : `<style>${this.cssEl}</style>`;

            this.$widget.append(css);
        }

        for (const key in this.attrs) {
            if (key === "style") {
                if (this.attrs[key]) {
                    let style = this.$widget.attr("style");
                    style = style ? `${style}; ${this.attrs[key]}` : this.attrs[key];

                    this.$widget.attr(key, style);
                }
            } else {
                this.$widget.attr(key, this.attrs[key]);
            }
        }

        for (const className of this.classes) {
            this.$widget.addClass(className);
        }

        return this.$widget;
    }

    logRenderingError(e: Error) {
        console.log("Got issue in widget ", this);
        console.error(e);

        const noteId = this._noteId;
        if (this._noteId) {
            froca.getNote(noteId, true).then((note) => {
                showErrorForScriptNote(noteId, t("toast.widget-error.message-custom", {
                    id: noteId,
                    title: note?.title,
                    message: e.message || e.toString()
                }));
            });
        } else {
            toastService.showPersistent({
                id: `custom-widget-failure-unknown-${randomString()}`,
                title: t("toast.widget-error.title"),
                icon: "bx bx-error-circle",
                message: t("toast.widget-error.message-unknown", {
                    message: e.message || e.toString()
                })
            });
        }
    }

    /**
     * Indicates if the widget is enabled. Widgets are enabled by default. Generally setting this to `false` will cause the widget not to be displayed, however it will still be available on the DOM but hidden.
     * @returns whether the widget is enabled.
     */
    isEnabled(): boolean | null | undefined {
        return true;
    }

    /**
     * Method used for rendering the widget.
     *
     * Your class should override this method.
     * The method is expected to create a this.$widget containing jQuery object
     */
    doRender() {}

    toggleInt(show: boolean | null | undefined) {
        this.$widget.toggleClass("hidden-int", !show)
            .toggleClass("visible", !!show);
    }

    isHiddenInt() {
        return this.$widget.hasClass("hidden-int");
    }

    toggleExt(show: boolean | null | "" | undefined) {
        this.$widget.toggleClass("hidden-ext", !show)
            .toggleClass("visible", !!show);
    }

    isHiddenExt() {
        return this.$widget.hasClass("hidden-ext");
    }

    canBeShown() {
        return !this.isHiddenInt() && !this.isHiddenExt();
    }

    isVisible() {
        return this.$widget.is(":visible");
    }

    getPosition() {
        return this.position;
    }

    remove() {
        if (this.$widget) {
            this.$widget.remove();
        }
    }

    getClosestNtxId() {
        if (this.$widget) {
            return this.$widget.closest("[data-ntx-id]").attr("data-ntx-id");
        }
        return null;
    }

    cleanup() {}
}

/**
 * This is the base widget for all other widgets.
 *
 * For information on using widgets, see the tutorial {@tutorial widget_basics}.
 */
export default class BasicWidget extends TypedBasicWidget<Component> {}

export function wrapReactWidgets<T extends TypedComponent<any>>(components: (T | VNode)[]) {
    const wrappedResult: T[] = [];
    for (const component of components) {
        if (isValidElement(component)) {
            wrappedResult.push(new ReactWrappedWidget(component) as unknown as T);
        } else {
            wrappedResult.push(component);
        }
    }
    return wrappedResult;
}

export class ReactWrappedWidget extends BasicWidget {

    private el: VNode;

    constructor(el: VNode) {
        super();
        this.el = el;
    }

    doRender() {
        this.$widget = renderReactWidget(this, this.el);
    }

}
