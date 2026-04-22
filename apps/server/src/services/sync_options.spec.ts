import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dependencies before importing the module
vi.mock("./config.js", () => ({ default: { Sync: {} } }));
vi.mock("./options.js", () => ({ default: { getOption: vi.fn() } }));

import config from "./config.js";
import optionService from "./options.js";
import syncOptions from "./sync_options.js";

describe("syncOptions.getSyncTimeout", () => {
    beforeEach(() => {
        (config as any).Sync = {};
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("converts database value from seconds to milliseconds", () => {
        // TimeSelector stores value in seconds (displayed value × scale)
        // Scale is UI-only, not used in backend calculation
        vi.mocked(optionService.getOption).mockReturnValue("120"); // 120 seconds = 2 minutes
        expect(syncOptions.getSyncTimeout()).toBe(120000);

        vi.mocked(optionService.getOption).mockReturnValue("30"); // 30 seconds
        expect(syncOptions.getSyncTimeout()).toBe(30000);

        vi.mocked(optionService.getOption).mockReturnValue("3600"); // 3600 seconds = 1 hour
        expect(syncOptions.getSyncTimeout()).toBe(3600000);
    });

    it("treats config override as raw milliseconds for backward compatibility", () => {
        (config as any).Sync = { syncServerTimeout: "60000" }; // 60 seconds in ms

        // Config value takes precedence, db value is ignored
        vi.mocked(optionService.getOption).mockReturnValue("9999");
        expect(syncOptions.getSyncTimeout()).toBe(60000);
    });

    it("uses safe defaults for invalid values", () => {
        vi.mocked(optionService.getOption).mockReturnValue("");
        expect(syncOptions.getSyncTimeout()).toBe(120000); // default 120 seconds

        (config as any).Sync = { syncServerTimeout: "invalid" };
        expect(syncOptions.getSyncTimeout()).toBe(120000); // fallback for invalid config
    });
});
