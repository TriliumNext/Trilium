import { describe, expect, it } from "vitest";
import {
    TRILIUM_PROTOCOL,
    buildAppLinkForNote,
    extractNoteIdFromArgs,
    extractNoteIdFromUrl,
} from "./protocol_handler";

describe("protocol_handler", () => {
    describe("extractNoteIdFromUrl", () => {
        it("extracts the note ID from a canonical trilium://note/<id> URL", () => {
            expect(extractNoteIdFromUrl("trilium://note/abc123def456")).toBe("abc123def456");
        });

        it("accepts the empty-host form trilium:///note/<id>", () => {
            expect(extractNoteIdFromUrl("trilium:///note/abc123def456")).toBe("abc123def456");
        });

        it("accepts the well-known root note ID", () => {
            expect(extractNoteIdFromUrl("trilium://note/root")).toBe("root");
        });

        it("accepts underscore-prefixed system note IDs (e.g. _hidden)", () => {
            expect(extractNoteIdFromUrl("trilium://note/_hidden")).toBe("_hidden");
        });

        it("URI-decodes the path segment", () => {
            expect(extractNoteIdFromUrl("trilium://note/abc%5F123")).toBe("abc_123");
        });

        it("preserves the case of mixed-case note IDs", () => {
            // Trilium IDs from `utils.randomString(12)` are case-sensitive.
            // The URL constructor lowercases the hostname, but our IDs live
            // in the path component, which is preserved verbatim.
            expect(extractNoteIdFromUrl("trilium://note/AbC123def456")).toBe("AbC123def456");
            expect(extractNoteIdFromUrl("trilium:///note/AbC123def456")).toBe("AbC123def456");
        });

        it("returns null when the path prefix is missing (legacy trilium://<id> not supported)", () => {
            expect(extractNoteIdFromUrl("trilium://abc123def456")).toBeNull();
        });

        it("returns null for non-trilium URLs", () => {
            expect(extractNoteIdFromUrl("https://example.com/foo")).toBeNull();
            expect(extractNoteIdFromUrl("trilium-other://note/abc123")).toBeNull();
        });

        it("returns null for unparseable strings", () => {
            expect(extractNoteIdFromUrl("not a url")).toBeNull();
            expect(extractNoteIdFromUrl("")).toBeNull();
        });

        it("rejects note IDs with invalid characters (XSS / path traversal guard)", () => {
            expect(extractNoteIdFromUrl("trilium://note/../etc/passwd")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note/<script>")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note/id with spaces")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note/id;rm -rf /")).toBeNull();
        });

        it("rejects pathological lengths", () => {
            const tooLong = "a".repeat(200);
            expect(extractNoteIdFromUrl(`trilium://note/${tooLong}`)).toBeNull();
        });

        it("rejects empty note IDs", () => {
            expect(extractNoteIdFromUrl("trilium://note/")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note")).toBeNull();
            expect(extractNoteIdFromUrl("trilium:///note/")).toBeNull();
        });

        it("rejects malformed percent-encoding", () => {
            expect(extractNoteIdFromUrl("trilium://note/abc%2")).toBeNull();
        });

        it("rejects non-string inputs", () => {
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(null)).toBeNull();
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(undefined)).toBeNull();
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(42)).toBeNull();
        });

        it("ignores trailing path segments after the note ID", () => {
            expect(extractNoteIdFromUrl("trilium://note/abc123/extra/ignored")).toBe("abc123");
        });
    });

    describe("extractNoteIdFromArgs", () => {
        it("finds the note ID inside a typical Windows argv", () => {
            const argv = [
                "C:\\Program Files\\Trilium\\trilium.exe",
                "trilium://note/abc123",
            ];
            expect(extractNoteIdFromArgs(argv)).toBe("abc123");
        });

        it("finds the note ID alongside --new-window", () => {
            const argv = ["/path/to/trilium", "--new-window", "trilium://note/xyz789"];
            expect(extractNoteIdFromArgs(argv)).toBe("xyz789");
        });

        it("returns null when no protocol arg is present", () => {
            expect(extractNoteIdFromArgs(["/usr/bin/trilium", "--new-window"])).toBeNull();
            expect(extractNoteIdFromArgs([])).toBeNull();
        });

        it("returns the first valid trilium:// URL when several are passed", () => {
            const argv = ["trilium", "trilium://note/first", "trilium://note/second"];
            expect(extractNoteIdFromArgs(argv)).toBe("first");
        });

        it("skips invalid trilium:// URLs and returns the next valid one", () => {
            const argv = ["trilium", "trilium://note/<bad>", "trilium://note/valid_id"];
            expect(extractNoteIdFromArgs(argv)).toBe("valid_id");
        });
    });

    describe("buildAppLinkForNote", () => {
        it("produces the canonical app link form", () => {
            expect(buildAppLinkForNote("abc123def456")).toBe("trilium://note/abc123def456");
        });

        it("percent-encodes special characters (defense-in-depth — Trilium IDs are alphanumeric)", () => {
            expect(buildAppLinkForNote("foo bar")).toBe("trilium://note/foo%20bar");
        });

        it("round-trips through the extractor", () => {
            const id = "abc_DEF_123";
            expect(extractNoteIdFromUrl(buildAppLinkForNote(id))).toBe(id);
        });
    });

    it("exposes the protocol name as a constant", () => {
        expect(TRILIUM_PROTOCOL).toBe("trilium");
    });
});
