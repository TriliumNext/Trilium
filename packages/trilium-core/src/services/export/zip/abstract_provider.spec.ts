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

        it("preserves an existing extension (returns null) ahead of jpg/mermaid/fallback handling", () => {
            // existingExtension is checked before the jpg/mermaid special cases,
            // so a set extension short-circuits even for those mimes.
            expect(provider.mapExtension("image", "image/png", ".png", "html")).toBeNull();
            expect(provider.mapExtension("image", "image/jpg", ".jpeg", "html")).toBeNull();
            expect(provider.mapExtension("code", "text/mermaid", ".mmd", "html")).toBeNull();
        });

        it("normalises image/jpg and text/mermaid special cases when no extension exists", () => {
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
