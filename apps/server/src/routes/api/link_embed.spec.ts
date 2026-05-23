import { describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import { extractYouTubeVideoId } from "@triliumnext/commons";
import { validateHostResolution, validateUrl } from "./link_embed.js";

vi.mock("../../services/log.js", () => ({
    default: { info: vi.fn(), error: vi.fn() }
}));

describe("validateUrl", () => {
    it("accepts http URLs", () => {
        const result = validateUrl("http://example.com");
        expect(result.hostname).toBe("example.com");
    });

    it("accepts https URLs", () => {
        const result = validateUrl("https://example.com/path?q=1");
        expect(result.hostname).toBe("example.com");
    });

    it("rejects non-http protocols", () => {
        expect(() => validateUrl("ftp://example.com")).toThrow("Only http and https");
        expect(() => validateUrl("file:///etc/passwd")).toThrow("Only http and https");
        expect(() => validateUrl("javascript:alert(1)")).toThrow("Only http and https");
    });

    it("rejects invalid URLs", () => {
        expect(() => validateUrl("not-a-url")).toThrow("Invalid URL");
        expect(() => validateUrl("")).toThrow("Invalid URL");
    });
});

describe("validateHostResolution", () => {
    it("rejects private IPv4 literals", async () => {
        await expect(validateHostResolution("127.0.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("10.0.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("192.168.1.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("172.16.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("169.254.1.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("0.0.0.0")).rejects.toThrow("private/internal");
    });

    it("rejects private IPv6 literals", async () => {
        await expect(validateHostResolution("::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fc00::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fd12::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fe80::1")).rejects.toThrow("private/internal");
    });

    it("allows public IP literals", async () => {
        await expect(validateHostResolution("8.8.8.8")).resolves.toBeUndefined();
        await expect(validateHostResolution("1.1.1.1")).resolves.toBeUndefined();
    });

    it("rejects hostnames that resolve to private IPs (DNS rebinding)", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "127.0.0.1", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("evil.example.com")).rejects.toThrow("private/internal");
    });

    it("rejects hostnames where any resolved address is private", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.1", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("dual.example.com")).rejects.toThrow("private/internal");
    });

    it("allows hostnames that resolve to public IPs", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "93.184.216.34", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("example.com")).resolves.toBeUndefined();
    });

    it("rejects hostnames that fail to resolve", async () => {
        vi.spyOn(dns.promises, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));

        await expect(validateHostResolution("nonexistent.invalid")).rejects.toThrow("Could not resolve hostname");
    });
});

describe("extractYouTubeVideoId", () => {
    it("extracts ID from standard watch URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from short URL", () => {
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from embed URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts ID from shorts URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("returns null for non-YouTube URLs", () => {
        expect(extractYouTubeVideoId("https://example.com")).toBeNull();
        expect(extractYouTubeVideoId("https://vimeo.com/12345")).toBeNull();
    });
});
