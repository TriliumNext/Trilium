import { afterEach, describe, expect, it } from "vitest";

import {
    getVirtualNoteContent,
    getVirtualNoteProvider,
    getVirtualNoteProviders,
    registerVirtualNoteProvider,
    unregisterVirtualNoteProvider,
    type VirtualNoteProvider
} from "./virtual_notes.js";

function makeProvider(namespace: string, overrides: Partial<VirtualNoteProvider> = {}): VirtualNoteProvider {
    return {
        namespace,
        parentNoteId: "_hidden",
        getSubtree: () => [],
        ...overrides
    };
}

const TEST_NAMESPACES = ["_vnreg", "_vnother"];

describe("virtual_notes registry", () => {
    afterEach(() => {
        for (const namespace of TEST_NAMESPACES) {
            unregisterVirtualNoteProvider(namespace);
        }
    });

    it("registers, looks up by note-ID prefix, and unregisters providers", () => {
        const provider = makeProvider("_vnreg");
        registerVirtualNoteProvider(provider);

        expect(getVirtualNoteProviders()).toContain(provider);
        expect(getVirtualNoteProvider("_vnregSomeNote")).toBe(provider);
        expect(getVirtualNoteProvider("_unrelated")).toBeNull();

        unregisterVirtualNoteProvider("_vnreg");
        expect(getVirtualNoteProvider("_vnregSomeNote")).toBeNull();
    });

    it("rejects namespaces not starting with an underscore", () => {
        expect(() => registerVirtualNoteProvider(makeProvider("vnreg"))).toThrow(/must start with '_'/);
    });

    it("rejects overlapping namespaces but allows re-registering the same one", () => {
        registerVirtualNoteProvider(makeProvider("_vnreg"));

        // one namespace being a prefix of another would make provider lookup ambiguous
        expect(() => registerVirtualNoteProvider(makeProvider("_vnregSub"))).toThrow(/overlaps/);
        expect(() => registerVirtualNoteProvider(makeProvider("_vn"))).toThrow(/overlaps/);

        // disjoint namespace is fine
        expect(() => registerVirtualNoteProvider(makeProvider("_vnother"))).not.toThrow();

        // same namespace replaces the previous registration (idempotent re-initialization)
        const replacement = makeProvider("_vnreg");
        registerVirtualNoteProvider(replacement);
        expect(getVirtualNoteProvider("_vnreg")).toBe(replacement);
        expect(getVirtualNoteProviders().filter((p) => p.namespace === "_vnreg")).toHaveLength(1);
    });

    it("delegates content to the provider and falls back to an empty string", () => {
        registerVirtualNoteProvider(makeProvider("_vnreg", {
            getContent: (noteId) => (noteId === "_vnregPage" ? "<p>hello</p>" : null)
        }));

        expect(getVirtualNoteContent("_vnregPage")).toBe("<p>hello</p>");
        // provider returns null → empty content
        expect(getVirtualNoteContent("_vnregOther")).toBe("");
        // no provider at all → empty content
        expect(getVirtualNoteContent("_nowhere")).toBe("");

        // provider without getContent → empty content
        registerVirtualNoteProvider(makeProvider("_vnother"));
        expect(getVirtualNoteContent("_vnotherPage")).toBe("");
    });
});
