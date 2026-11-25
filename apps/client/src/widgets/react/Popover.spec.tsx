import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const { restoreFocusTraps, suspendModalFocusTraps } = vi.hoisted(() => {
    const restoreFocusTraps = vi.fn();
    return { restoreFocusTraps, suspendModalFocusTraps: vi.fn(() => restoreFocusTraps) };
});
vi.mock("./modal_focustrap", () => ({ suspendModalFocusTraps }));

import Popover from "./Popover";

describe("Popover", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    async function mount(container: HTMLElement) {
        await act(async () => {
            render(<Popover getAnchorRect={() => new DOMRect(100, 100, 50, 20)}>content</Popover>, container);
            await Promise.resolve();
        });
    }

    it("stands over a modal open as it opens, and frees its fields from the modal's focus trap", async () => {
        const modal = document.createElement("div");
        modal.className = "modal show";
        const container = document.createElement("div");
        modal.append(container);
        document.body.append(modal);

        await mount(container);
        expect(document.querySelector(".tn-popover")?.classList.contains("over-modal")).toBe(true);
        expect(suspendModalFocusTraps).toHaveBeenCalledOnce();

        await act(async () => render(null, container));
        expect(restoreFocusTraps).toHaveBeenCalledOnce();
    });

    it("keeps its own layer with no modal open", async () => {
        const container = document.createElement("div");
        document.body.append(container);

        await mount(container);
        expect(document.querySelector(".tn-popover")?.classList.contains("over-modal")).toBe(false);
        expect(suspendModalFocusTraps).not.toHaveBeenCalled();
    });
});
