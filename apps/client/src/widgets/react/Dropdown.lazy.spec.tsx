import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Dropdown, { preloadDropdownPopups } from "./Dropdown";

const h = vi.hoisted(() => ({ popupsLoaded: false }));
vi.mock("./DropdownPopups", async (importOriginal) => {
    h.popupsLoaded = true;
    return await importOriginal<typeof import("./DropdownPopups")>();
});

const host = document.createElement("div");
document.body.append(host);

afterEach(() => {
    act(() => render(null, host));
});

describe("Dropdown", () => {
    it("loads its popup once a toggle is about to be pressed, and draws it at once from then on", async () => {
        act(() => render(
            <>
                <Dropdown text="First"><li className="dropdown-item">First item</li></Dropdown>
                <Dropdown text="Second"><li className="dropdown-item">Second item</li></Dropdown>
            </>, host));
        const [ first, second ] = host.querySelectorAll<HTMLButtonElement>("button");
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
        expect(h.popupsLoaded).toBe(false);

        act(() => {
            first.dispatchEvent(new PointerEvent("pointerenter"));
        });
        await vi.waitFor(() => expect(h.popupsLoaded).toBe(true));
        // The load the pointer started, which a later call returns rather than starting another.
        await act(async () => {
            await preloadDropdownPopups();
        });

        act(() => second.click());
        expect(document.body.textContent).toContain("Second item");
    });

    it("draws a popup opened before its module has loaded once it has", async () => {
        act(() => render(<Dropdown text="Third"><li className="dropdown-item">Third item</li></Dropdown>, host));
        act(() => host.querySelector("button")?.click());
        await vi.waitFor(() => expect(document.body.textContent).toContain("Third item"));
    });
});
