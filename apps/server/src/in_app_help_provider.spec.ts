import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// in_app_help_provider is loaded during boot (setup.ts), so vi.mock can't
// intercept "fs" — spy on the real (shared) fs.readFileSync instead.
import NodejsInAppHelpProvider, { getHelpAssetDir } from "./in_app_help_provider.js";

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

    it("reads a help asset by its path, and nothing outside the asset directory", async () => {
        const provider = new NodejsInAppHelpProvider();
        const inside = path.join(getHelpAssetDir(), "User Guide", "pic.png");
        const readFile = vi.spyOn(fs.promises, "readFile").mockResolvedValue(Buffer.from([ 1, 2 ]));

        expect(await provider.getHelpAsset("User Guide/pic.png")).toEqual(Buffer.from([ 1, 2 ]));
        expect(path.resolve(String(readFile.mock.calls[0][0]))).toBe(path.resolve(inside));

        expect(await provider.getHelpAsset("../../secret.txt")).toBeNull();
        expect(readFile).toHaveBeenCalledTimes(1);

        readFile.mockRejectedValue(new Error("ENOENT"));
        expect(await provider.getHelpAsset("User Guide/missing.png")).toBeNull();
    });
});
