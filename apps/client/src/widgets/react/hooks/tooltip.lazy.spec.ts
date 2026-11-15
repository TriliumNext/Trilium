import { describe, expect, it, vi } from "vitest";

describe("useStaticTooltip", () => {
    it("loads Bootstrap once the pointer enters its element, and attaches the tooltip then", async () => {
        // `test/setup.ts` loads the tooltips for every spec, so this one starts from fresh modules.
        vi.resetModules();
        const loaded = { bootstrap: false };
        vi.doMock("bootstrap", async (importOriginal) => {
            loaded.bootstrap = true;
            return await importOriginal();
        });
        const { h, render } = await import("preact");
        const { useRef } = await import("preact/hooks");
        const { act } = await import("preact/test-utils");
        const { getTooltipInstance, useStaticTooltip } = await import("./tooltip");

        function Button() {
            const ref = useRef<HTMLButtonElement>(null);
            useStaticTooltip(ref, { title: "Hello" });
            return h("button", { ref, type: "button" });
        }

        const container = document.createElement("div");
        document.body.append(container);
        act(() => render(h(Button, null), container));
        const button = container.querySelector("button");
        if (!button) throw new Error("expected the button to render");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(loaded.bootstrap).toBe(false);
        expect(getTooltipInstance(button)).toBeNull();

        button.dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(getTooltipInstance(button)).not.toBeNull());
        expect(loaded.bootstrap).toBe(true);

        act(() => render(null, container));
        container.remove();
    });
});

describe("attachTooltip", () => {
    it("waits for a hover like the hooks, and attaches nothing once detached", async () => {
        vi.resetModules();
        const { attachTooltip, getTooltipInstance, loadTooltips } = await import("./tooltip");
        const kept = document.createElement("button");
        const removed = document.createElement("button");
        document.body.append(kept, removed);

        attachTooltip(kept, { title: "Kept" });
        const detach = attachTooltip(removed, { title: "Removed" });
        expect(getTooltipInstance(kept)).toBeNull();

        detach();
        kept.dispatchEvent(new PointerEvent("pointerenter"));
        await loadTooltips();
        expect(getTooltipInstance(kept)).not.toBeNull();
        expect(getTooltipInstance(removed)).toBeNull();

        kept.remove();
        removed.remove();
    });
});
