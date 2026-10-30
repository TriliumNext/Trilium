import { render } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import ShadowDom from "./ShadowDom";

describe("ShadowDom", () => {
    it("unmounts the tree in its shadow root along with itself", () => {
        const cleanup = vi.fn();
        function Child() {
            useEffect(() => cleanup, []);
            return <p>Inside</p>;
        }
        const container = document.createElement("div");
        document.body.append(container);

        act(() => render(<ShadowDom><Child /></ShadowDom>, container));
        expect(container.firstElementChild?.shadowRoot?.textContent).toBe("Inside");

        act(() => render(null, container));
        expect(cleanup).toHaveBeenCalledOnce();
        container.remove();
    });
});
