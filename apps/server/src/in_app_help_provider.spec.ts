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

    // Every becca load asks for the tree, and there are several in a session.
    it("reads each file once, however often it is asked", () => {
        const readFileSync = vi.spyOn(fs, "readFileSync")
            .mockReturnValue(Buffer.from(JSON.stringify([])) as never);

        const provider = new NodejsInAppHelpProvider();
        for (let i = 0; i < 3; i++) {
            provider.getHelpHiddenSubtreeData();
            provider.getHelpContent();
        }

        expect(readFileSync.mock.calls.map(([ file ]) => String(file).replace(/^.*[\\/]/, "")))
            .toEqual([ "help_meta.json", "help_content.json" ]);
    });

    // A failed read is remembered too, rather than retried on every load: the files ship with the
    // application, so one that is missing now will be missing for the life of the process.
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
