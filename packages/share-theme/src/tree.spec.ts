import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    setupTreeState: vi.fn(),
    whenActivated: vi.fn()
}));

vi.mock("./page/tree_state.js", () => ({ default: mocks.setupTreeState }));
vi.mock("./page/speculation.js", () => ({ whenActivated: mocks.whenActivated }));

it("restores the tree once the page is shown", async () => {
    await import("./tree.js");
    expect(mocks.whenActivated).toHaveBeenCalledWith(mocks.setupTreeState);
});
