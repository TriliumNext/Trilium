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

    it("reduces the note path the editor writes to the target ID alone", () => {
        // What a link created in the editor looks like: a full path whose intermediate IDs exist
        // only in the docs instance. An import rewrites the same link to `#root/<noteId>`, so
        // without this the exported HTML alternated between the two forms.
        const input = [
            `<a class="reference-link" href="#root/pOsGYCXsbNQG/tC7s2alapj8V/R9pX4DGra2Vt">Sharing</a>`,
            `<a class="reference-link" href="#root/jdjRLhLV3TtI/YjerxU7Aii8X">Troubleshooting</a>`
        ].join(" ");
        const expected = [
            `<a class="reference-link" href="#root/_help_R9pX4DGra2Vt">Sharing</a>`,
            `<a class="reference-link" href="#root/_help_YjerxU7Aii8X">Troubleshooting</a>`
        ].join(" ");
        expect(rewriteHelpLinks(input)).toBe(expected);
    });

    it("reduces a path whose target is already prefixed, as a previously exported link is", () => {
        const input = `<a href="#root/pOsGYCXsbNQG/KSZ04uQ2D1St/_help_hrZ1D00cLbal">Internal links</a>`;
        expect(rewriteHelpLinks(input)).toBe(`<a href="#root/_help_hrZ1D00cLbal">Internal links</a>`);
    });

    it("keeps a query suffix on the link it rewrites", () => {
        const input = `<a href="#root/pOsGYCXsbNQG/R9pX4DGra2Vt?viewMode=source">Sharing</a>`;
        expect(rewriteHelpLinks(input)).toBe(`<a href="#root/_help_R9pX4DGra2Vt?viewMode=source">Sharing</a>`);
    });

    it("is idempotent for already-prefixed help links", () => {
        const input = `<a href="#root/_help_iPIMuisry3hd">Text</a>`;
        expect(rewriteHelpLinks(input)).toBe(input);
    });
});
