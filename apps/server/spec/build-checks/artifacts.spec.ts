import { globSync } from "fs";
import { join } from "path";
import { describe, expect,it } from "vitest";

describe("Check artifacts are present", () => {
    const distPath = join(__dirname, "../../dist");

    it("has the necessary node modules", async () => {
        const paths = [
            "node_modules/better-sqlite3"
        ];

        ensurePathsExist(paths);
    });

    it("includes native binaries for Docker architectures", async () => {
        ensurePathsExist([
            "node_modules/better-sqlite3/prebuilds/linux-x64.node",
            "node_modules/better-sqlite3/prebuilds/linux-arm64.node",
            "node_modules/better-sqlite3/prebuilds/linuxmusl-x64.node",
            "node_modules/better-sqlite3/prebuilds/linuxmusl-arm64.node"
        ]);
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
            "share-theme"
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
