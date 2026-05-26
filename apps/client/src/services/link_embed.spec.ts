import { describe, expect, it } from "vitest";
import { detectEmbedType, safeHostname } from "./link_embed.js";

describe("detectEmbedType", () => {
    it("detects YouTube URLs", () => {
        expect(detectEmbedType("https://youtu.be/fV16ck4Bgc0")).toBe("youtube");
        expect(detectEmbedType("https://www.youtube.com/watch?v=abc12345678")).toBe("youtube");
    });

    it("returns opengraph for non-YouTube URLs", () => {
        expect(detectEmbedType("https://example.com")).toBe("opengraph");
        expect(detectEmbedType("https://github.com/TriliumNext/Notes")).toBe("opengraph");
    });
});

describe("safeHostname", () => {
    it("extracts hostname from valid URL", () => {
        expect(safeHostname("https://www.example.com/page")).toBe("www.example.com");
    });

    it("returns raw string for invalid URL", () => {
        expect(safeHostname("not-a-url")).toBe("not-a-url");
    });

    it("handles URLs with ports", () => {
        expect(safeHostname("http://localhost:8080/api")).toBe("localhost");
    });
});
