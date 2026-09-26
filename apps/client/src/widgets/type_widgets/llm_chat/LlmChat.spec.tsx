import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type Component from "../../../components/component";
import { ParentComponent } from "../../react/react_utils";
import { useFocusInputOnDetail } from "./LlmChat";

describe("useFocusInputOnDetail", () => {
    const container = document.createElement("div");
    const focusInput = vi.fn();
    const handlers = new Map<string, (data: unknown) => void>();
    const parent = {
        registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
        removeHandler: () => {}
    } as unknown as Component;

    function Harness({ isVisible }: { isVisible?: boolean }) {
        useFocusInputOnDetail(focusInput, "ntx-1", isVisible);
        return null;
    }
    function renderHarness(isVisible?: boolean) {
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <Harness isVisible={isVisible} />
            </ParentComponent.Provider>,
            container
        ));
    }
    const focusOnDetail = (ntxId: string) => handlers.get("focusOnDetail")?.({ ntxId });

    afterEach(() => {
        render(null, container);
        focusInput.mockReset();
    });

    it("focuses the input of the shown chat in the requested context only", () => {
        renderHarness(true);
        expect(handlers.has("focusOnDetail")).toBe(true);
        focusOnDetail("ntx-2");
        expect(focusInput).not.toHaveBeenCalled();
        focusOnDetail("ntx-1");
        expect(focusInput).toHaveBeenCalledOnce();

        // A chat kept mounted but hidden after its note's type changed leaves the focus to the shown widget.
        renderHarness(false);
        focusOnDetail("ntx-1");
        expect(focusInput).toHaveBeenCalledOnce();
    });
});
