import clsHooked from "cls-hooked";
import { afterEach, describe, expect, it, vi } from "vitest";

import ClsHookedExecutionContext from "./cls_provider.js";

afterEach(() => vi.restoreAllMocks());

describe("ClsHookedExecutionContext", () => {
    it("stores and retrieves values within an init() context", () => {
        const ctx = new ClsHookedExecutionContext();
        const result = ctx.init(() => {
            ctx.set("alpha", 42);
            return ctx.get<number>("alpha");
        });
        expect(result).toBe(42);
    });

    it("returns undefined for keys outside any active context", () => {
        const ctx = new ClsHookedExecutionContext();
        expect(ctx.get("never-set")).toBeUndefined();
    });

    it("delegates reset() to cls-hooked", () => {
        const resetSpy = vi.spyOn(clsHooked, "reset").mockImplementation(() => {});
        new ClsHookedExecutionContext().reset();
        expect(resetSpy).toHaveBeenCalled();
    });
});
