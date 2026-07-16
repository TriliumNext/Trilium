import { type ComponentChild, render } from "preact";
import { afterEach } from "vitest";

const containers: HTMLDivElement[] = [];

/**
 * Render a Preact vnode into a detached-but-attached div and return the container.
 *
 * The containers are torn down automatically after each test (see the `afterEach` below), which also
 * disposes any Bootstrap tooltips / event listeners the component registered, preventing leaks
 * between tests.
 */
export function renderInto(vnode: ComponentChild) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    containers.push(container);
    return container;
}

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
});
