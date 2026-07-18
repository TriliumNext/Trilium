import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getLog } from "../../services/log";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core backend-log route through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

describe("Backend log API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the backend log contents as text", async () => {
        const res = await api.get<string>("/api/backend-log");
        expect(res.status).toBe(200);
        // The handler returns a plain string (the log contents, or a fallback
        // message when no log file is available); never assert on the exact text.
        expect(typeof res.body).toBe("string");
    });

    it("returns the log contents verbatim when a log file is available", async () => {
        // On the standalone (WASM) runtime getLogContents() can be null by
        // default, so force a non-null value to exercise the success branch.
        vi.spyOn(getLog(), "getLogContents").mockReturnValue("line one\nline two");

        const res = await api.get<string>("/api/backend-log");
        expect(res.status).toBe(200);
        expect(res.body).toBe("line one\nline two");
    });

    it("returns a fallback message when no log file is available", async () => {
        // Force the `contents === null` branch (the i18n fallback). The fallback
        // text is translated, so assert only on structure, not the English string.
        vi.spyOn(getLog(), "getLogContents").mockReturnValue(null);

        const res = await api.get<string>("/api/backend-log");
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe("string");
        expect(res.body.length).toBeGreaterThan(0);
    });
});
