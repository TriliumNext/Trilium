/**
 * Shared `vi.mock` factories for heavy/side-effectful modules that many specs stub identically.
 * `vi.mock` is hoisted per-file, so use these as the factory body:
 *
 *     vi.mock("bootstrap", () => bootstrapMock());
 */

/** Stub for bootstrap's `Tooltip`/`Dropdown`/`Modal` classes (happy-dom can't run the real ones). */
export function bootstrapMock() {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getInstance(el: Element) { return Dropdown.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Dropdown.instances.set(el, this); }
        dispose() { Dropdown.instances.delete(this.element); }
        show() {}
        hide() {}
        toggle() {}
    }
    class Modal {
        static instances = new Map<Element, Modal>();
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Modal.instances.set(el, this); }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, Modal, default: { Tooltip, Dropdown, Modal } };
}
