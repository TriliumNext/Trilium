import { describe, expect, it } from "vitest";
import {
    TRILIUM_PROTOCOL,
    extractNoteIdFromArgs,
    extractNoteIdFromUrl,
} from "./protocol_handler";

describe("protocol_handler", () => {
    describe("extractNoteIdFromUrl", () => {
        it("extracts note ID from a well-formed trilium:// URL", () => {
            expect(extractNoteIdFromUrl("trilium://abc123def456")).toBe("abc123def456");
        });

        it("accepts the triple-slash form some platforms produce", () => {
            expect(extractNoteIdFromUrl("trilium:///abc123def456")).toBe("abc123def456");
        });

        it("accepts the well-known root note ID", () => {
            expect(extractNoteIdFromUrl("trilium://root")).toBe("root");
        });

        it("accepts underscore-prefixed system note IDs (e.g. _hidden)", () => {
            expect(extractNoteIdFromUrl("trilium://_hidden")).toBe("_hidden");
        });

        it("returns null for non-trilium URLs", () => {
            expect(extractNoteIdFromUrl("https://example.com/foo")).toBeNull();
            expect(extractNoteIdFromUrl("trilium-other://abc123")).toBeNull();
        });

        it("returns null for unparseable strings", () => {
            expect(extractNoteIdFromUrl("not a url")).toBeNull();
            expect(extractNoteIdFromUrl("")).toBeNull();
        });

        it("rejects note IDs with invalid characters (XSS / path traversal guard)", () => {
            expect(extractNoteIdFromUrl("trilium://../etc/passwd")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://<script>")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note id with spaces")).toBeNull();
            expect(extractNoteIdFromUrl("trilium://note;rm -rf /")).toBeNull();
        });

        it("rejects pathological lengths", () => {
            const tooLong = "a".repeat(200);
            expect(extractNoteIdFromUrl(`trilium://${tooLong}`)).toBeNull();
        });

        it("rejects empty note IDs", () => {
            expect(extractNoteIdFromUrl("trilium://")).toBeNull();
            expect(extractNoteIdFromUrl("trilium:///")).toBeNull();
        });

        it("rejects non-string inputs", () => {
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(null)).toBeNull();
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(undefined)).toBeNull();
            // @ts-expect-error testing runtime guard against non-string args
            expect(extractNoteIdFromUrl(42)).toBeNull();
        });
    });

    describe("extractNoteIdFromArgs", () => {
        it("finds the note ID inside a typical Windows argv", () => {
            const argv = [
                "C:\\Program Files\\Trilium\\trilium.exe",
                "trilium://abc123",
            ];
            expect(extractNoteIdFromArgs(argv)).toBe("abc123");
        });

        it("finds the note ID alongside --new-window", () => {
            const argv = ["/path/to/trilium", "--new-window", "trilium://xyz789"];
            expect(extractNoteIdFromArgs(argv)).toBe("xyz789");
        });

        it("returns null when no protocol arg is present", () => {
            expect(extractNoteIdFromArgs(["/usr/bin/trilium", "--new-window"])).toBeNull();
            expect(extractNoteIdFromArgs([])).toBeNull();
        });

        it("returns the first valid trilium:// URL when several are passed", () => {
            const argv = ["trilium", "trilium://first", "trilium://second"];
            expect(extractNoteIdFromArgs(argv)).toBe("first");
        });

        it("skips invalid trilium:// URLs and returns the next valid one", () => {
            const argv = ["trilium", "trilium://<bad>", "trilium://valid_id"];
            expect(extractNoteIdFromArgs(argv)).toBe("valid_id");
        });
    });

    it("exposes the protocol name as a constant", () => {
        expect(TRILIUM_PROTOCOL).toBe("trilium");
    });
});
