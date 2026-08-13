import { imageExtensionForMime, imageMimeForExtension } from "@triliumnext/commons";
import { getImageTypeFromBuffer } from "@triliumnext/server/src/services/image_codec.js";
import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, sep } from "path";
import { describe, expect, it } from "vitest";

/**
 * The documentation's pictures, checked against what their bytes actually are.
 *
 * These files are not read by a browser alone. Every build copies `docs/User Guide` into the app
 * (`apps/server/scripts/build.ts`, `apps/desktop/scripts/build.ts`, `apps/standalone/vite.config.mts`)
 * and serves them as the in-app help, where the Content-Type comes from the extension and nothing
 * looks at the bytes. A file whose name disagrees with its contents is therefore served under the
 * wrong media type by all three, and any tooling that sorts these by format — a conversion pass,
 * an optimizer — is misled the same way.
 *
 * They arrive by export from a Trilium instance, so the name comes from `mapExtension` in
 * `packages/trilium-core/src/services/export/zip/abstract_provider.ts` rather than from anyone
 * typing it, and a wrong one here means that rule got it wrong.
 */

const DOCS_ROOT = join(__dirname, "..", "..", "..", "docs");

/** Extensions worth opening. Anything else in the tree is not claiming to be a picture. */
const PICTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg"]);

describe("documentation pictures", () => {
    it("names every picture after the format its bytes are in", async () => {
        const pictures = picturesUnder(DOCS_ROOT);
        const mismatches: string[] = [];

        // A scan that reached nothing would report no mismatch and pass on that alone. The
        // documentation runs to hundreds of pictures, so anything near zero means the walk went
        // somewhere else rather than that the tree came out clean.
        expect(pictures.length).toBeGreaterThan(100);

        for (const file of pictures) {
            const detected = await getImageTypeFromBuffer(readFileSync(file));
            const path = relative(DOCS_ROOT, file).split(sep).join("/");

            if (!detected) {
                mismatches.push(`${path}: not a picture in any format that can be recognised`);
                continue;
            }

            // Compared the way the export compares them, so this agrees with the rule that
            // produced the name: both sides through the media type, which settles `.jpeg` against
            // `.jpg` and the case of an extension along with it.
            const claimed = imageExtensionForMime(imageMimeForExtension(extname(file)));
            const actual = imageExtensionForMime(detected.mime);

            if (claimed !== actual) {
                mismatches.push(`${path}: named .${claimed}, actually ${actual.toUpperCase()} (${detected.mime})`);
            }
        }

        expect(mismatches).toEqual([]);
    });
});

/** Every file under a directory whose extension claims it is a picture. */
function picturesUnder(directory: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);

        if (statSync(path).isDirectory()) {
            found.push(...picturesUnder(path));
        } else if (PICTURE_EXTENSIONS.has(extname(entry).toLowerCase())) {
            found.push(path);
        }
    }

    return found;
}
