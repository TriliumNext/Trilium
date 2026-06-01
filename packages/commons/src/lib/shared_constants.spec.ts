import { describe, expect, it } from "vitest";

import {
    ALLOWED_PROTOCOLS,
    SANITIZER_DEFAULT_ALLOWED_TAGS,
    SHELL_OPEN_EXTERNAL_PROTOCOLS
} from "./shared_constants.js";

describe("SANITIZER_DEFAULT_ALLOWED_TAGS", () => {
    it("is a non-empty array containing common formatting tags", () => {
        expect(Array.isArray(SANITIZER_DEFAULT_ALLOWED_TAGS)).toBe(true);
        expect(SANITIZER_DEFAULT_ALLOWED_TAGS.length).toBeGreaterThan(0);
        expect(SANITIZER_DEFAULT_ALLOWED_TAGS).toContain("p");
        expect(SANITIZER_DEFAULT_ALLOWED_TAGS).toContain("img");
        expect(SANITIZER_DEFAULT_ALLOWED_TAGS).toContain("table");
    });
});

describe("ALLOWED_PROTOCOLS", () => {
    it("is a non-empty array including https, mailto and file", () => {
        expect(Array.isArray(ALLOWED_PROTOCOLS)).toBe(true);
        expect(ALLOWED_PROTOCOLS.length).toBeGreaterThan(0);
        expect(ALLOWED_PROTOCOLS).toContain("https");
        expect(ALLOWED_PROTOCOLS).toContain("mailto");
        expect(ALLOWED_PROTOCOLS).toContain("file");
    });
});

describe("SHELL_OPEN_EXTERNAL_PROTOCOLS", () => {
    it("excludes every blocklisted scheme", () => {
        const blocklisted = ["file", "data", "smb", "ldap", "ldaps", "jar", "view-source"];

        for (const scheme of blocklisted) {
            expect(SHELL_OPEN_EXTERNAL_PROTOCOLS).not.toContain(scheme);
        }
    });

    it("includes safe schemes that are not blocklisted", () => {
        expect(SHELL_OPEN_EXTERNAL_PROTOCOLS).toContain("https");
        expect(SHELL_OPEN_EXTERNAL_PROTOCOLS).toContain("tel");
        expect(SHELL_OPEN_EXTERNAL_PROTOCOLS).toContain("ftp");
    });

    it("is derived from ALLOWED_PROTOCOLS (a strict subset)", () => {
        expect(SHELL_OPEN_EXTERNAL_PROTOCOLS.length).toBeGreaterThan(0);
        for (const scheme of SHELL_OPEN_EXTERNAL_PROTOCOLS) {
            expect(ALLOWED_PROTOCOLS).toContain(scheme);
        }
        // It must be a proper subset: the blocklist removes some entries.
        expect(SHELL_OPEN_EXTERNAL_PROTOCOLS.length).toBeLessThan(ALLOWED_PROTOCOLS.length);
    });
});
