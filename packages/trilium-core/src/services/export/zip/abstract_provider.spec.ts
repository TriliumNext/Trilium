import { describe, expect, it, vi } from "vitest";

import type { NoteMeta, NoteMetaFile } from "../../../meta.js";
import type { ZipArchive } from "../../zip_provider.js";
import { ZipExportProvider, ZipExportProviderData } from "./abstract_provider.js";

/**
 * The module under test only exposes an abstract class, so we exercise it
 * through a minimal concrete subclass whose abstract methods are inert. All the
 * runtime behaviour worth covering lives in the constructor and `mapExtension`.
 */
class TestProvider extends ZipExportProvider {
    prepareMeta(_metaFile: NoteMetaFile): void {
        // no-op
    }
    prepareContent(_title: string, content: string | Uint8Array): string | Uint8Array {
        return content;
    }
    afterDone(_rootMeta: NoteMeta): void {
        // no-op
    }
}

function buildArchive(): ZipArchive {
    return {
        append: vi.fn(),
        pipe: vi.fn(),
        finalize: vi.fn()
    };
}

function buildProvider(overrides: Partial<ZipExportProviderData> = {}) {
    const data: ZipExportProviderData = {
        branch: overrides.branch ?? ({} as ZipExportProviderData["branch"]),
        getNoteTargetUrl: overrides.getNoteTargetUrl ?? ((targetNoteId) => `${targetNoteId}.html`),
        archive: overrides.archive ?? buildArchive(),
        zipExportOptions: overrides.zipExportOptions,
        rewriteFn: overrides.rewriteFn ?? ((content) => content)
    };
    return new TestProvider(data);
}

describe("ZipExportProvider", () => {
    describe("constructor", () => {
        it("assigns every field from the provided data", () => {
            const archive = buildArchive();
            const getNoteTargetUrl = vi.fn(() => null);
            const rewriteFn = vi.fn((content: string) => content);
            const zipExportOptions = { skipHtmlTemplate: true };
            const branch = { branchId: "abc" } as unknown as ZipExportProviderData["branch"];

            const provider = buildProvider({
                branch,
                getNoteTargetUrl,
                archive,
                zipExportOptions,
                rewriteFn
            });

            expect(provider.branch).toBe(branch);
            expect(provider.getNoteTargetUrl).toBe(getNoteTargetUrl);
            expect(provider.archive).toBe(archive);
            expect(provider.zipExportOptions).toBe(zipExportOptions);
            expect(provider.rewriteFn).toBe(rewriteFn);
        });

        it("leaves zipExportOptions undefined when none are passed", () => {
            const provider = buildProvider({ zipExportOptions: undefined });
            expect(provider.zipExportOptions).toBeUndefined();
        });
    });

    describe("mapExtension", () => {
        const provider = buildProvider();

        it("forces md/html for text notes based on the requested format", () => {
            // These two win over any existing extension or mime detection.
            expect(provider.mapExtension("text", "text/html", ".bak", "markdown")).toBe("md");
            expect(provider.mapExtension("text", "anything", ".bak", "html")).toBe("html");
        });

        it("maps javascript mimes to js regardless of note type", () => {
            expect(provider.mapExtension("code", "application/x-javascript", "", "html")).toBe("js");
            expect(provider.mapExtension("code", "text/javascript", "", "html")).toBe("js");
        });

        it("maps canvas notes and json mimes to json", () => {
            expect(provider.mapExtension("canvas", "application/octet-stream", "", "html")).toBe("json");
            expect(provider.mapExtension("file", "application/json", "", "html")).toBe("json");
        });

        it("preserves an existing extension (returns null) ahead of mermaid/fallback handling", () => {
            // existingExtension is checked before the mermaid special case, so a set extension
            // short-circuits even for that mime.
            expect(provider.mapExtension("image", "image/png", ".png", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/jpg", ".jpeg", "html")).toBeNull();
            expect(provider.mapExtension("code", "text/mermaid", ".mmd", "html")).toBeNull();
        });

        it("names an image from its mime where the existing extension contradicts it", () => {
            // An image converted on upload keeps the title it arrived under — attachments are
            // deliberately never renamed, since a canvas addresses its images by title — while
            // its mime follows the bytes. The file name is the only thing left that can still
            // describe them, so where the two disagree the mime is the one that saw the bytes.
            //
            // Trusting the title instead is what put 51 JPEGs under a .png name in
            // docs/User Guide, every one of them recorded as image/jpg in !!!meta.json.
            expect(provider.mapExtension("image", "image/jpeg", ".png", "markdown")).toBe("jpg");
            expect(provider.mapExtension("image", "image/jpg", ".png", "markdown")).toBe("jpg");
            expect(provider.mapExtension("image", "image/png", ".jpg", "html")).toBe("png");
            expect(provider.mapExtension("image", "image/webp", ".png", "html")).toBe("webp");
            expect(provider.mapExtension("image", "image/gif", ".PNG", "html")).toBe("gif");
        });

        it("keeps an extension that already names the mime's format, whatever its spelling", () => {
            // Only a genuine disagreement is worth renaming over: correcting ".jpeg" to ".jpg"
            // churns file names across an export for no gain, and the case of an extension
            // carries no meaning at all.
            expect(provider.mapExtension("image", "image/jpeg", ".jpg", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/jpg", ".jpeg", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/png", ".PNG", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/svg+xml", ".svg", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/x-icon", ".ico", "html")).toBeNull();
        });

        it("leaves a non-image extension alone, having nothing better to offer than the title", () => {
            // The correction is scoped to pictures, where the mime is authoritative about the
            // encoding. Elsewhere the title is usually the more informative of the two: a
            // mermaid source is better named .mmd than the .txt its mime maps to.
            expect(provider.mapExtension("code", "text/mermaid", ".mmd", "html")).toBeNull();
            expect(provider.mapExtension("file", "application/pdf", ".bak", "html")).toBeNull();
            expect(provider.mapExtension("file", "application/totally-unknown", ".bin", "html")).toBeNull();
        });

        it("reads a media type however it was written when no extension exists", () => {
            expect(provider.mapExtension("image", "image/jpg", "", "html")).toBe("jpg");
            expect(provider.mapExtension("image", "  IMAGE/JPG  ", "", "html")).toBe("jpg");
            expect(provider.mapExtension("code", "text/mermaid", "", "html")).toBe("txt");
            expect(provider.mapExtension("code", " Text/Mermaid ", "", "html")).toBe("txt");
        });

        it("falls back to the custom code-mime map for markdown mimes", () => {
            for (const mime of ["text/x-markdown", "text/markdown", "text/x-gfm"]) {
                expect(provider.mapExtension("code", mime, "", "html")).toBe("md");
            }
        });

        it("falls back to the mime-types lookup for recognised mimes", () => {
            expect(provider.mapExtension("image", "image/png", "", "html")).toBe("png");
            expect(provider.mapExtension("code", "text/css", "", "html")).toBe("css");
        });

        it("uses the 'dat' fallback when nothing else resolves", () => {
            expect(provider.mapExtension("file", "application/totally-unknown", "", "html")).toBe("dat");
            expect(provider.mapExtension(null, "", "", "html")).toBe("dat");
        });
    });
});
