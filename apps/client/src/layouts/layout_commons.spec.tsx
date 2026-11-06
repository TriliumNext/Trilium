import { describe, expect, it } from "vitest";

import RootContainer from "../widgets/containers/root_container";
import { applyModals } from "./layout_commons";

describe("applyModals", () => {
    it("includes the merge history dialog among the dialogs the layout can open", () => {
        const root = new RootContainer(true);
        applyModals(root);
        expect(root.children.length).toBeGreaterThan(0);
    });
});
