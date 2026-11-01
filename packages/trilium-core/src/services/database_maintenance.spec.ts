import { describe, expect, it, vi } from "vitest";

import { checkIntegrity } from "./database_maintenance.js";
import { getLog } from "./log.js";

describe("checking the database's integrity", () => {
    it("asks the engine about itself, and writes down what it answered", () => {
        const logged = vi.spyOn(getLog(), "info");
        const { results } = checkIntegrity();

        // Runs against better-sqlite3 under the server suite and against the WASM build under the
        // standalone one: the whole point of asking the engine rather than reading a file is that
        // both can answer.
        expect(results).toEqual([ { integrity_check: "ok" } ]);

        // The reply to a check that failed is of no use once the message carrying it is gone.
        expect(logged).toHaveBeenCalledWith(`Integrity check result: ${JSON.stringify(results)}`);
        logged.mockRestore();
    });
});
