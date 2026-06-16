import { describe, expect, it } from "vitest";

import { PRODUCT_NAME } from "./app-info.js";

describe("app-info", () => {
    it("exposes the Electron product name", () => {
        expect(PRODUCT_NAME).toBe("Trilium Notes");
    });
});
