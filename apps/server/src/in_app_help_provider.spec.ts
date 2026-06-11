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

    describe("getDocContent", () => {
        it("reads the raw HTML of a User Guide doc note", () => {
            vi.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("<p>help</p>") as never);

            const provider = new NodejsInAppHelpProvider();
            expect(provider.getDocContent("User Guide/Quick Start")).toBe("<p>help</p>");
        });

        it("rejects empty or path-traversal doc names without touching the filesystem", () => {
            const readSpy = vi.spyOn(fs, "readFileSync");

            const provider = new NodejsInAppHelpProvider();
            expect(provider.getDocContent("")).toBeNull();
            expect(provider.getDocContent("../secret")).toBeNull();
            expect(provider.getDocContent("foo/../../etc/passwd")).toBeNull();
            expect(readSpy).not.toHaveBeenCalled();
        });

        it("returns null when the doc file cannot be read", () => {
            vi.spyOn(fs, "readFileSync").mockImplementation(() => {
                throw new Error("ENOENT");
            });

            const provider = new NodejsInAppHelpProvider();
            expect(provider.getDocContent("User Guide/Missing")).toBeNull();
        });
    });
});
