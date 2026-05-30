import { describe, expect, it } from "vitest";

import { isInternalElectronRequest, markAsInternalElectronRequest } from "./electron_request.js";

describe("electron_request markers", () => {
    it("marks a request as internal and detects it", () => {
        const req = {};
        expect(isInternalElectronRequest(req)).toBe(false);

        markAsInternalElectronRequest(req);
        expect(isInternalElectronRequest(req)).toBe(true);
    });

    it("reports unmarked / foreign-keyed objects as not internal", () => {
        expect(isInternalElectronRequest({})).toBe(false);
        // A plain string key cannot collide with the internal symbol.
        expect(isInternalElectronRequest({ "trilium-electron-internal-request": true })).toBe(false);
    });
});
