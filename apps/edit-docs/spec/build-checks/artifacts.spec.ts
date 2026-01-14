import { globSync } from "fs";
import { join } from "path";
import { it, describe, expect } from "vitest";

describe("Check artifacts are present", () => {
    const distPath = join(__dirname, "../../dist");

    it("has the necessary node modules", async () => {
        const paths = [
            "node_modules/better-sqlite3",
            "node_modules/bindings",
            "node_modules/file-uri-to-path",
            "node_modules/@electron/remote"
        ];

        ensurePathsExist(paths);
    });

    it("includes the client", async () => {
        const paths = [
            "public/assets",
            "public/fonts",
            "public/node_modules",
            "public/src",
            "public/stylesheets",
            "public/translations"
        ];

        ensurePathsExist(paths);
    });

    it("includes necessary assets", async () => {
        const paths = [
            "assets",
            "share-theme",
            "ckeditor5-content.css"
        ];

        ensurePathsExist(paths);
    });

    function ensurePathsExist(paths: string[]) {
        for (const path of paths) {
            const result = globSync(join(distPath, path, "**"));
            expect(result, path).not.toHaveLength(0);
        }
    }
});
