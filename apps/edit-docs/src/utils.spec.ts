import { describe, expect, it, vi } from "vitest";

import { rewriteHelpLinks } from "./utils.js";

// utils.ts bootstraps Electron at module load (registers the `trilium-app://` scheme and
// pulls in the desktop window service, whose resource_dir lookup calls process.exit in a
// non-Electron test runner). Stub those side-effectful imports so the pure helpers below
// (rewriteHelpLinks) can be imported in isolation.
vi.mock("electron", () => ({ default: { app: {}, protocol: { registerSchemesAsPrivileged: () => {} } } }));
vi.mock("@triliumnext/desktop/src/protocol.js", () => ({ registerTriliumAppScheme: () => {}, setupTriliumAppProtocol: () => {} }));
vi.mock("@triliumnext/desktop/src/services/window.js", () => ({ default: {}, setupWindowing: () => {} }));

describe("rewriteHelpLinks", () => {
    it("prefixes plain help-note links with _help_", () => {
        const input = `<a class="reference-link" href="#root/iPIMuisry3hd">Text</a>`;
        expect(rewriteHelpLinks(input)).toBe(`<a class="reference-link" href="#root/_help_iPIMuisry3hd">Text</a>`);
    });

    it("does not prefix canonical hidden-subtree notes that already start with an underscore", () => {
        // `_optionsTextNotes` keeps its canonical ID in production; prefixing it would produce the
        // broken `_help__optionsTextNotes` link reported in issue #9646.
        const input = `<a href="#root/_hidden/_options/_optionsTextNotes">Text Notes</a>`;
        expect(rewriteHelpLinks(input)).toBe(input);
    });

    it("leaves both options links untouched while still prefixing a sibling help link", () => {
        const input = [
            `<a href="#root/_help_4TIF1oA4VQRO">Options</a>`,
            `<a href="#root/_hidden/_options/_optionsTextNotes">Text Notes</a>`,
            `<a href="#root/_hidden/_options/_optionsCodeNotes">Code Notes</a>`
        ].join(" ");
        const result = rewriteHelpLinks(input);

        expect(result).not.toContain("_help__");
        expect(result).toContain("#root/_hidden/_options/_optionsTextNotes");
        expect(result).toContain("#root/_hidden/_options/_optionsCodeNotes");
    });

    it("is idempotent for already-prefixed help links", () => {
        const input = `<a href="#root/_help_iPIMuisry3hd">Text</a>`;
        expect(rewriteHelpLinks(input)).toBe(input);
    });
});
