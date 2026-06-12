import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Bootstrap's Modal/Tooltip touch real DOM APIs that happy-dom doesn't fully implement; stub them so
// the dialog body still renders without throwing when `show` flips to true. The shared `bootstrapMock`
// is not used here because the React Modal wrapper relies on `Modal.getOrCreateInstance`.
vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal();
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        show() {}
        hide() {}
        dispose() {}
    }
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// `getAction` resolves per command; default returns a single shortcut so KeyboardShortcut renders a kbd.
// `updateDisplayedShortcuts` is called by `openDialog` when the Modal is shown — stub it to a no-op.
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [ "ctrl+k" ] })),
        updateDisplayedShortcuts: vi.fn()
    }
}));

import appContext from "../../components/app_context";
import type Component from "../../components/component";
import keyboard_actions from "../../services/keyboard_actions";
import { flush, renderComponent } from "../../test/render";
import HelpDialog from "./help";

// --- Render harness -------------------------------------------------------------------------------

let parent: Component;

function renderDialog() {
    const { container, parent: renderedParent } = renderComponent(<HelpDialog />);
    parent = renderedParent;
    return container;
}

function fireEvent(name: string, data: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

beforeEach(() => {
    vi.clearAllMocks();
    (keyboard_actions.getAction as ReturnType<typeof vi.fn>).mockResolvedValue({ effectiveShortcuts: [ "ctrl+k" ] });
});

// --- Tests ----------------------------------------------------------------------------------------

describe("HelpDialog", () => {
    it("renders the hidden modal shell with no body before showCheatsheet fires", () => {
        const root = renderDialog();
        const modal = root.querySelector(".modal.help-dialog");
        expect(modal).not.toBeNull();
        expect(modal?.classList.contains("use-tn-links")).toBe(true);
        // `shown` starts false → Modal renders no .modal-dialog body.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector(".help-cards")).toBeNull();
    });

    it("renders the full cheatsheet body (cards, fixed + command shortcuts, kbd keys) once shown", async () => {
        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();

        // The body and all eight help cards are rendered.
        expect(root.querySelector(".help-cards")).not.toBeNull();
        const cards = root.querySelectorAll(".help-cards .card");
        expect(cards.length).toBe(8);
        // Each card carries a title and a card-text body.
        expect(root.querySelectorAll(".card .card-title").length).toBe(8);
        expect(root.querySelectorAll(".card .card-text").length).toBe(8);

        // FixedKeyboardShortcut renders <kbd> elements directly from its `keys` prop.
        // "Up"/"Down" is the first fixed shortcut → produces 2 kbd among others.
        const kbds = root.querySelectorAll("kbd");
        expect(kbds.length).toBeGreaterThan(2);

        // KeyboardShortcut resolved its async getAction → at least one kbd holds the mocked "ctrl+k".
        expect(keyboard_actions.getAction).toHaveBeenCalled();
        const kbdTexts = Array.from(kbds).map((k) => k.textContent);
        expect(kbdTexts).toContain("ctrl+k");
    });

    it("renders the edit-shortcuts custom title bar button and routes its click", async () => {
        const openContextWithNote = vi.fn();
        Object.assign(appContext, { tabManager: { openContextWithNote } });

        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();

        const editBtn = root.querySelector<HTMLButtonElement>("button.custom-title-bar-button.bxs-pencil");
        expect(editBtn).not.toBeNull();
        act(() => editBtn?.click());
        expect(openContextWithNote).toHaveBeenCalledWith("_optionsShortcuts", { activate: true });
    });

    it("falls back to the not-set placeholder when a command resolves no shortcuts", async () => {
        // No action → KeyboardShortcut pushes the t('help.notSet') fallback into its keys.
        (keyboard_actions.getAction as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();

        const kbds = root.querySelectorAll("kbd");
        // Fixed shortcuts still render their literal keys; the command ones now render a single fallback kbd.
        const kbdTexts = Array.from(kbds).map((k) => k.textContent);
        // The fixed "Up"/"Down" keys are always present regardless of getAction's result.
        expect(kbdTexts).toContain("Up");
        expect(kbdTexts).toContain("Down");
        // No command resolved a real shortcut, so "ctrl+k" must be absent.
        expect(kbdTexts).not.toContain("ctrl+k");
    });

    it("handles a command that returns an action without effectiveShortcuts", async () => {
        // action present but effectiveShortcuts undefined → the ?? [] branch + notSet fallback.
        (keyboard_actions.getAction as ReturnType<typeof vi.fn>).mockResolvedValue({});

        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();

        // Still renders the body without throwing; fixed keys remain.
        const kbdTexts = Array.from(root.querySelectorAll("kbd")).map((k) => k.textContent);
        expect(kbdTexts).toContain("Up");
        expect(keyboard_actions.getAction).toHaveBeenCalled();
    });

    it("hides the body again when the modal emits hidden.bs.modal (onHidden → setShown(false))", async () => {
        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        const modalEl = root.querySelector(".modal.help-dialog");
        // Modal subscribes to hidden.bs.modal via addEventListener; dispatching it runs onHidden().
        act(() => { modalEl?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        await flush();
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("renders separators between multiple keys in a fixed shortcut", async () => {
        const root = renderDialog();
        fireEvent("showCheatsheet", {});
        await flush();

        // The first card's first <li> lists Up + Down with a ", " separator between them.
        const firstLi = root.querySelector(".help-cards .card ul li");
        expect(firstLi?.querySelectorAll("kbd").length).toBe(2);
        expect(firstLi?.textContent).toContain(",");
    });
});
