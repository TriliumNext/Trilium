import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type RenderResult, renderComponent } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// A stub bootstrap Modal whose instance records hide/show calls. The shared bootstrapMock does not
// provide getOrCreateInstance, which this spec relies on, so it keeps its own bootstrap mock.
const modalInstance = { hide: vi.fn(), show: vi.fn() };
vi.mock("bootstrap", () => {
    class Modal {
        static getOrCreateInstance = vi.fn(() => modalInstance);
        static getInstance = vi.fn(() => modalInstance);
    }
    // hooks.tsx (imported transitively via useSyncedRef) patches Tooltip.prototype at import time.
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// openDialog resolves with the jQuery-wrapped widget so the `.then()` chain runs.
const openDialog = vi.fn((...args: unknown[]) => {
    const $dialog = args[0] as JQuery<HTMLElement>;
    return Promise.resolve($dialog);
});
vi.mock("../../services/dialog", () => ({
    openDialog: (...args: unknown[]) => openDialog(...args),
    closeActiveDialog: vi.fn()
}));

const triggerCommand = vi.fn();
vi.mock("../../components/app_context", () => ({
    default: { triggerCommand: (...args: unknown[]) => triggerCommand(...args) }
}));

import Modal, { ModalProps } from "./Modal";

// --- Render helper --------------------------------------------------------------------------------

let rendered: RenderResult | undefined;

function makeProps(props: Partial<ModalProps>): ModalProps {
    return {
        className: "test-modal",
        size: "lg",
        show: true,
        onHidden: vi.fn(),
        children: <p className="body-child">body</p>,
        ...props
    };
}

function renderModal(props: Partial<ModalProps> = {}) {
    rendered = renderComponent(<Modal {...makeProps(props)} />);
    const root = rendered.container.querySelector(".modal");
    if (!root) throw new Error("modal root not rendered");
    return root as HTMLElement;
}

function rerenderModal(props: Partial<ModalProps>) {
    if (!rendered) throw new Error("no container");
    rendered.rerender(<Modal {...makeProps(props)} />);
}

beforeEach(() => {
    vi.clearAllMocks();
    rendered = undefined;
    openDialog.mockImplementation((...args: unknown[]) => Promise.resolve(args[0] as JQuery<HTMLElement>));
});

// --- Static structure -----------------------------------------------------------------------------

describe("Modal static structure", () => {
    it("applies className, tabIndex, role and renders body content when shown", () => {
        const root = renderModal({ className: "my-special-modal" });
        expect(root.className).toBe("modal fade mx-auto my-special-modal");
        expect(root.getAttribute("tabindex")).toBe("-1");
        expect(root.getAttribute("role")).toBe("dialog");
        expect(root.querySelector(".modal-dialog")).toBeTruthy();
        expect(root.querySelector(".body-child")?.textContent).toBe("body");
        // No footer when none provided.
        expect(root.querySelector(".modal-footer")).toBeNull();
        // Close button always present.
        expect(root.querySelector("button.btn-close")).toBeTruthy();
    });

    it("does not render the dialog inner content when hidden and not kept in DOM", () => {
        const root = renderModal({ show: false });
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector(".body-child")).toBeNull();
    });

    it("keeps the dialog content in the DOM when keepInDom is set even while hidden", () => {
        const root = renderModal({ show: false, keepInDom: true });
        expect(root.querySelector(".modal-dialog")).toBeTruthy();
        expect(root.querySelector(".body-child")).toBeTruthy();
    });

    it("applies the size modifier and scrollable/full-page classes", () => {
        const root = renderModal({ size: "sm", scrollable: true, isFullPageOnMobile: true });
        const dialog = root.querySelector(".modal-dialog");
        expect(dialog?.classList.contains("modal-sm")).toBe(true);
        expect(dialog?.classList.contains("modal-dialog-scrollable")).toBe(true);
        expect(dialog?.classList.contains("modal-dialog-full-page-on-mobile")).toBe(true);
    });
});

// --- Title rendering branches ---------------------------------------------------------------------

describe("Modal title", () => {
    it("renders a string title inside the modal-title heading", () => {
        const root = renderModal({ title: "Hello" });
        const heading = root.querySelector("h5.modal-title");
        expect(heading?.textContent).toBe("Hello");
    });

    it("renders a non-breaking-space placeholder heading when no title is given", () => {
        const root = renderModal({ title: undefined });
        const heading = root.querySelector("h5.modal-title");
        expect(heading).toBeTruthy();
        // The &nbsp; placeholder is a single non-breaking space.
        expect(heading?.textContent).toBe(" ");
    });

    it("renders a component title verbatim (no modal-title heading)", () => {
        const root = renderModal({ title: <span className="custom-title">Custom</span> });
        expect(root.querySelector("h5.modal-title")).toBeNull();
        expect(root.querySelector(".custom-title")?.textContent).toBe("Custom");
    });
});

// --- Header / help / title-bar buttons ------------------------------------------------------------

describe("Modal header extras", () => {
    it("renders the header content alongside the title", () => {
        const root = renderModal({ header: <button className="header-btn">H</button> });
        expect(root.querySelector(".header-btn")).toBeTruthy();
    });

    it("renders the help button and triggers the help command on click", () => {
        const root = renderModal({ helpPageId: "abc" });
        const helpBtn = root.querySelector("button.help-button");
        expect(helpBtn).toBeTruthy();
        (helpBtn as HTMLButtonElement).click();
        expect(triggerCommand).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: "_help_abc" });
    });

    it("renders custom title-bar buttons, skipping nulls, and forwards clicks", () => {
        const onClick = vi.fn();
        const root = renderModal({
            customTitleBarButtons: [
                null,
                { title: "Star", iconClassName: "bx-star", onClick }
            ]
        });
        const buttons = root.querySelectorAll("button.custom-title-bar-button");
        expect(buttons.length).toBe(1);
        const btn = buttons[0] as HTMLButtonElement;
        expect(btn.className).toContain("bx-star");
        expect(btn.getAttribute("title")).toBe("Star");
        btn.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

// --- Footer / form / sidebar ----------------------------------------------------------------------

describe("Modal footer, form and sidebar", () => {
    it("renders the footer and applies between-alignment style", () => {
        const root = renderModal({ footer: <span className="foot">F</span>, footerAlignment: "between" });
        const footer = root.querySelector(".modal-footer") as HTMLElement;
        expect(footer).toBeTruthy();
        expect(footer.querySelector(".foot")).toBeTruthy();
        expect(footer.style.justifyContent).toBe("space-between");
    });

    it("merges a custom footerStyle with default alignment", () => {
        const root = renderModal({ footer: <span>F</span>, footerStyle: { color: "red" }, footerAlignment: "right" });
        const footer = root.querySelector(".modal-footer") as HTMLElement;
        expect(footer.style.color).toBe("red");
        // "right" alignment does not force space-between.
        expect(footer.style.justifyContent).toBe("");
    });

    it("wraps body and footer in a form and calls onSubmit on submit, preventing default", () => {
        const onSubmit = vi.fn();
        const root = renderModal({ onSubmit, footer: <span className="foot">F</span> });
        const form = root.querySelector("form");
        expect(form).toBeTruthy();
        // The body lives inside the form when onSubmit is present.
        expect(form?.querySelector(".body-child")).toBeTruthy();
        const event = new Event("submit", { bubbles: true, cancelable: true });
        act(() => { form?.dispatchEvent(event); });
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it("renders without a form when onSubmit is absent", () => {
        const root = renderModal({});
        expect(root.querySelector("form")).toBeNull();
    });

    it("renders a sidebar layout with a header that mirrors the title", () => {
        const root = renderModal({ sidebar: <nav className="side-nav">nav</nav>, title: "Side" });
        const content = root.querySelector(".modal-content");
        expect(content?.classList.contains("modal-content-with-sidebar")).toBe(true);
        expect(root.querySelector(".modal-sidebar .side-nav")).toBeTruthy();
        // Sidebar header echoes the title.
        expect(root.querySelector(".modal-sidebar-header h5")?.textContent).toBe("Side");
        // Main content is wrapped in modal-main when a sidebar is present.
        expect(root.querySelector(".modal-main")).toBeTruthy();
    });

    it("renders a sidebar without a header when no title is provided", () => {
        const root = renderModal({ sidebar: <nav className="side-nav">nav</nav>, title: undefined });
        expect(root.querySelector(".modal-sidebar")).toBeTruthy();
        expect(root.querySelector(".modal-sidebar-header")).toBeNull();
    });
});

// --- Inline styles (memoized) ---------------------------------------------------------------------

describe("Modal style props", () => {
    it("applies zIndex to the dialog and min/max width to the document", () => {
        const root = renderModal({ zIndex: 1500, maxWidth: 640, minWidth: "300px" });
        expect((root as HTMLElement).style.zIndex).toBe("1500");
        const dialog = root.querySelector(".modal-dialog") as HTMLElement;
        expect(dialog.style.maxWidth).toBe("640px");
        expect(dialog.style.minWidth).toBe("300px");
    });

    it("applies a bodyStyle to the modal body", () => {
        const root = renderModal({ bodyStyle: { padding: "10px" } });
        const body = root.querySelector(".modal-body") as HTMLElement;
        expect(body.style.padding).toBe("10px");
    });

    it("leaves dialog/document styles empty when no size props are given", () => {
        const root = renderModal({});
        expect((root as HTMLElement).style.zIndex).toBe("");
        const dialog = root.querySelector(".modal-dialog") as HTMLElement;
        expect(dialog.style.maxWidth).toBe("");
        expect(dialog.style.minWidth).toBe("");
    });
});

// --- Show / hide lifecycle (effects) --------------------------------------------------------------

describe("Modal show/hide lifecycle", () => {
    it("opens the dialog via openDialog and creates the bootstrap instance when shown", async () => {
        renderModal({ show: true });
        // The show effect calls openDialog with the modal jQuery element.
        expect(openDialog).toHaveBeenCalledTimes(1);
        const args = openDialog.mock.calls[0];
        // second arg is !stackable → true when stackable is undefined
        expect(args[1]).toBe(true);
        await act(async () => { await Promise.resolve(); });
        const bootstrap = await import("bootstrap");
        expect(bootstrap.Modal.getOrCreateInstance).toHaveBeenCalled();
    });

    it("passes !stackable correctly and respects noFocus", async () => {
        renderModal({ show: true, stackable: true, noFocus: true });
        const args = openDialog.mock.calls[0];
        expect(args[1]).toBe(false); // stackable → !stackable = false
        expect(args[2]).toEqual({ focus: false }); // noFocus → focus: false
    });

    it("does not call openDialog when not shown", () => {
        renderModal({ show: false });
        expect(openDialog).not.toHaveBeenCalled();
    });

    it("hides the bootstrap instance when transitioning from shown to hidden", async () => {
        renderModal({ show: true });
        await act(async () => { await Promise.resolve(); });
        modalInstance.hide.mockClear();
        rerenderModal({ show: false });
        expect(modalInstance.hide).toHaveBeenCalled();
    });

    it("registers onShown and invokes onHidden + restores focus on hidden.bs.modal", () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const focusTarget = document.createElement("input");
        document.body.appendChild(focusTarget);
        focusTarget.focus();
        const focusSpy = vi.spyOn(focusTarget, "focus");

        const root = renderModal({ show: true, onShown, onHidden });

        // shown.bs.modal → onShown
        act(() => { root.dispatchEvent(new Event("shown.bs.modal")); });
        expect(onShown).toHaveBeenCalledTimes(1);

        // hidden.bs.modal → onHidden and refocus of the previously active element
        act(() => { root.dispatchEvent(new Event("hidden.bs.modal")); });
        expect(onHidden).toHaveBeenCalledTimes(1);
        expect(focusSpy).toHaveBeenCalled();

        focusTarget.remove();
    });

    it("removes its event listeners on unmount", () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const root = renderModal({ show: true, onShown, onHidden });
        rendered?.unmount();
        // After unmount, firing the events on the detached node must not call handlers.
        root.dispatchEvent(new Event("shown.bs.modal"));
        root.dispatchEvent(new Event("hidden.bs.modal"));
        expect(onShown).not.toHaveBeenCalled();
        expect(onHidden).not.toHaveBeenCalled();
    });
});
