import { describe, expect, it } from "vitest";

import { isValidDocName } from "./doc_renderer.js";

describe("isValidDocName", () => {
    it("accepts valid docNames", () => {
        expect(isValidDocName("launchbar_intro")).toBe(true);
        expect(isValidDocName("User Guide/Quick Start")).toBe(true);
        expect(isValidDocName("User Guide/User Guide/Quick Start")).toBe(true);
        expect(isValidDocName("Quick Start Guide")).toBe(true);
        expect(isValidDocName("quick_start_guide")).toBe(true);
        expect(isValidDocName("quick-start-guide")).toBe(true);
    });

    it("rejects path traversal attacks", () => {
        expect(isValidDocName("..")).toBe(false);
        expect(isValidDocName("../etc/passwd")).toBe(false);
        expect(isValidDocName("foo/../bar")).toBe(false);
        expect(isValidDocName("../../../../api/notes/_malicious/open")).toBe(false);
        expect(isValidDocName("..\\etc\\passwd")).toBe(false);
        expect(isValidDocName("foo\\bar")).toBe(false);
    });

    it("rejects URL manipulation attacks", () => {
        expect(isValidDocName("../../../../api/notes/_malicious/open?x=")).toBe(false);
        expect(isValidDocName("foo#bar")).toBe(false);
        expect(isValidDocName("%2e%2e")).toBe(false);
        expect(isValidDocName("%2e%2e%2f%2e%2e%2fapi")).toBe(false);
    });
});
