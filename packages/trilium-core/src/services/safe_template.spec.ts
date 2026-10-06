import { describe, expect, it, vi } from "vitest";

import { getLog } from "./log.js";
import { evaluateTemplateSafe } from "./safe_template.js";

describe("safe_template - evaluateTemplateSafe", () => {
    it("returns the interpolated value on success", () => {
        const note = { title: "My Note" };
        expect(
            evaluateTemplateSafe("${note.title}", { note }, "fallback", "test")
        ).toBe("My Note");
    });

    it("returns the fallback and logs when evaluation throws", () => {
        const errorSpy = vi
            .spyOn(getLog(), "error")
            .mockImplementation(() => {});
        try {
            const result = evaluateTemplateSafe(
                "${missing.title}",
                {},
                "the-fallback",
                "my context"
            );
            expect(result).toBe("the-fallback");
            expect(errorSpy).toHaveBeenCalledOnce();
            expect(errorSpy.mock.calls[0]?.[0]).toContain("my context");
        } finally {
            errorSpy.mockRestore();
        }
    });
});
