import { type ComponentChild, render } from "preact";
import { afterEach } from "vitest";

let container: HTMLDivElement | undefined;

/**
 * Render a Preact vnode into a detached-but-attached div and return the container.
 *
 * The container is torn down automatically after each test (see the `afterEach` below), which also
 * disposes any Bootstrap tooltips / event listeners the component registered, preventing leaks
 * between tests.
 */
export function renderInto(vnode: ComponentChild) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});
