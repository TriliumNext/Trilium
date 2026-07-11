import fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// in_app_help_provider is loaded during boot (setup.ts), so vi.mock can't
// intercept "fs" — spy on the real (shared) fs.readFileSync instead.
import NodejsInAppHelpProvider from "./in_app_help_provider.js";

afterEach(() => vi.restoreAllMocks());

describe("NodejsInAppHelpProvider", () => {
    it("parses the help meta JSON when present", () => {
        const data = [{ id: "_help", title: "Help" }];
        vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from(JSON.stringify(data)) as never);

        const provider = new NodejsInAppHelpProvider();
        expect(provider.getHelpHiddenSubtreeData()).toEqual(data);
    });

    it("returns an empty list and warns when the meta file cannot be read", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(fs, "readFileSync").mockImplementation(() => {
            throw new Error("ENOENT");
        });

        const provider = new NodejsInAppHelpProvider();
        expect(provider.getHelpHiddenSubtreeData()).toEqual([]);
        expect(warnSpy).toHaveBeenCalled();
    });
});
