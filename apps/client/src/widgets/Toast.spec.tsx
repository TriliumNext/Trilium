import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub NoteLink so we don't pull in its async link.createLink / froca machinery; we only need to
// know that one is rendered per noteId.
vi.mock("./react/NoteLink", async () => {
    const { h } = await import("preact");
    return {
        default: (props: { notePath: string; titleSuffix?: string }) => h(
            "span",
            { class: "note-link-stub", "data-note-id": props.notePath },
            props.titleSuffix ? h("span", { class: "note-link-suffix" }, props.titleSuffix) : null
        )
    };
});

import { toasts, type ToastOptionsWithRequiredId } from "../services/toast";
import ToastContainer from "./Toast";

let container: HTMLDivElement | undefined;

function renderToasts(items: ToastOptionsWithRequiredId[]) {
    toasts.value = items;
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<ToastContainer />, container);
    return container;
}

afterEach(() => {
    toasts.value = [];
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("Toast rendering", () => {
    it("renders reference-note links (with heading) and a monospace message body", () => {
        const el = renderToasts([ {
            id: "err",
            icon: "bx bx-error-circle",
            title: "Failed",
            message: "api.logg is not a function",
            messageMonospace: true,
            notesHeading: "Scripts that failed:",
            // One plain entry, one annotated — both render a link, only the latter a description.
            notes: [ "noteA", { noteId: "noteB", description: "duplicate identifier" } ]
        } ]);

        const body = el.querySelector(".toast-body");
        expect(body?.className).toContain("monospace");
        expect(body?.textContent).toContain("api.logg is not a function");

        const notes = el.querySelector(".toast-notes");
        expect(notes).not.toBeNull();
        expect(notes?.querySelector(".toast-notes-heading")?.textContent).toBe("Scripts that failed:");
        expect(el.querySelectorAll(".note-link-stub")).toHaveLength(2);

        // The annotation is injected inside the note link (as titleSuffix), not a sibling — only the
        // annotated entry gets one, and it lives on that note's link.
        const suffixes = el.querySelectorAll(".note-link-suffix");
        expect(suffixes).toHaveLength(1);
        expect(suffixes[0].textContent).toBe("duplicate identifier");
        expect(suffixes[0].closest(".note-link-stub")?.getAttribute("data-note-id")).toBe("noteB");
    });

    it("omits the notes section and the monospace class when neither is provided", () => {
        const el = renderToasts([ { id: "ok", icon: "bx bx-check", message: "done" } ]);

        expect(el.querySelector(".toast-notes")).toBeNull();
        expect(el.querySelector(".toast.no-title .toast-body")?.className).not.toContain("monospace");
    });

    it("applies the monospace class in the no-title layout too", () => {
        const el = renderToasts([ { id: "mono", icon: "bx bx-x", message: "raw error", messageMonospace: true } ]);

        expect(el.querySelector(".toast.no-title .toast-body")?.className).toContain("monospace");
    });

    it("runs its default action on a click outside its buttons, and tells a close apart", () => {
        const onClick = vi.fn(({ dismissToast }: { dismissToast: () => void }) => dismissToast());
        const onDismiss = vi.fn();
        const onRemove = vi.fn();
        const button = vi.fn();
        const el = renderToasts([ {
            id: "alert", icon: "bx bx-bell", title: "Reminder", message: "Dentist",
            onClick, onDismiss, onRemove, buttons: [ { text: "Snooze", onClick: button } ]
        } ]);
        const toast = el.querySelector<HTMLElement>(".toast");
        expect(toast?.classList).toContain("clickable");
        expect(toast?.tabIndex).toBe(0);

        el.querySelector<HTMLButtonElement>(".toast-buttons button")?.click();
        expect(button).toHaveBeenCalledOnce();
        expect(onClick).not.toHaveBeenCalled();

        toast?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(onClick).toHaveBeenCalledOnce();
        expect(onRemove).toHaveBeenCalledOnce();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it("calls onDismiss for its close button alone", () => {
        const onDismiss = vi.fn();
        const el = renderToasts([
            { id: "closed", icon: "bx bx-bell", message: "Closed", onDismiss },
            { id: "plain", icon: "bx bx-bell", message: "Plain" }
        ]);
        const [ closed, plain ] = el.querySelectorAll<HTMLElement>(".toast");
        expect(plain.classList).not.toContain("clickable");
        expect(plain.getAttribute("tabindex")).toBeNull();

        // A click on a toast without a default action does nothing.
        plain.querySelector<HTMLElement>(".toast-body")?.click();
        closed.querySelector<HTMLButtonElement>(".btn-close")?.click();
        expect(onDismiss).toHaveBeenCalledOnce();
        expect(toasts.value.map(({ id }) => id)).toEqual([ "plain" ]);
    });
});
