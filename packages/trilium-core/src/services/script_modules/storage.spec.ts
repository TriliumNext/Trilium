import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import { getContext } from "../context.js";
import hiddenSubtreeService, { SCRIPT_MODULES_ROOT } from "../hidden_subtree.js";
import noteService from "../notes.js";
import type { ScriptModuleArtifact } from "./provider.js";
import {
    deleteScriptModule,
    findScriptModule,
    findScriptModuleByNoteId,
    formatPackageSpec,
    listScriptModules,
    MODULE_FILE_ROLE,
    MODULE_TYPES_ROLE,
    openScriptModuleSources,
    parseManifest,
    readScriptModuleTypes,
    scriptModuleNoteId,
    storeScriptModule
} from "./storage.js";

const ENTRY_SOURCE = `export * from "./dep.mjs";`;
const DEP_SOURCE = "export const dep = 1;";

type SourceFile = { name: string; source: string };

function artifact(spec: string, files: SourceFile[], entry?: string): ScriptModuleArtifact {
    const [name, version] = spec.split("@");
    return {
        providerId: "esm.sh",
        spec: { name, version, target: "portable" },
        entry: entry ?? files[0].name,
        files: files.map((file) => ({ ...file, url: `https://esm.sh/${file.name}` }))
    };
}

function store(spec: string, files: SourceFile[], entry?: string) {
    return getContext().init(() => storeScriptModule(artifact(spec, files, entry)));
}

describe("script module storage (real DB)", () => {
    beforeAll(() => {
        getContext().init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    it("puts the module container in the hidden subtree", () => {
        const root = becca.notes[SCRIPT_MODULES_ROOT];

        expect(root).toBeDefined();
        expect(root.type).toBe("doc");
        expect(root.getParentBranches().some((b) => b.parentNoteId === "_hidden")).toBe(true);
    });

    it("derives a stable note id from the package alone", () => {
        const cheerio = { name: "cheerio", version: "1.1.2", target: "portable" as const };

        expect(scriptModuleNoteId(cheerio)).toBe(scriptModuleNoteId({ ...cheerio }));
        expect(scriptModuleNoteId(cheerio)).toMatch(/^sm[a-zA-Z0-9]{10}$/);
        const other = { name: "cheerio", version: "1.1.3", target: "portable" as const };
        expect(scriptModuleNoteId(cheerio)).not.toBe(scriptModuleNoteId(other));
        expect(scriptModuleNoteId(cheerio)).not.toBe(scriptModuleNoteId({ name: "cheerio", target: "portable" as const }));

        expect(formatPackageSpec(cheerio)).toBe("cheerio@1.1.2");
        const scoped = { name: "@scope/pkg", version: "2.0.0", subpath: "/sub", target: "portable" as const };
        expect(formatPackageSpec(scoped)).toBe("@scope/pkg@2.0.0/sub");
        expect(formatPackageSpec({ name: "cheerio", target: "portable" as const })).toBe("cheerio");
    });

    it("stores an artifact and reads it back whole", () => {
        const stored = store("alpha@1.0.0", [
            { name: "entry.mjs", source: ENTRY_SOURCE },
            { name: "dep.mjs", source: DEP_SOURCE }
        ]);

        expect(stored.noteId).toBe(scriptModuleNoteId({ name: "alpha", version: "1.0.0", target: "portable" as const }));
        expect(stored.providerId).toBe("esm.sh");
        expect(stored.entry).toBe("entry.mjs");
        expect(stored.size).toBe(ENTRY_SOURCE.length + DEP_SOURCE.length);
        expect(stored.dateModified).not.toBe("");

        const note = becca.notes[stored.noteId];
        expect(note.title).toBe("alpha@1.0.0");
        expect(note.type).toBe("code");
        expect(note.mime).toBe("application/json");
        const parents = note.getParentBranches().map((b) => b.parentNoteId);
        expect(parents).toContain(SCRIPT_MODULES_ROOT);
        // Sources are attachments; the note itself holds only the manifest.
        expect(note.getAttachmentsByRole(MODULE_FILE_ROLE).map((a) => a.title).sort())
            .toEqual(["dep.mjs", "entry.mjs"]);

        const read = findScriptModule({ name: "alpha", version: "1.0.0", target: "portable" as const });
        expect(read?.files).toEqual([
            {
                name: "entry.mjs",
                url: "https://esm.sh/entry.mjs",
                size: ENTRY_SOURCE.length,
                blobId: expect.any(String)
            },
            {
                name: "dep.mjs",
                url: "https://esm.sh/dep.mjs",
                size: DEP_SOURCE.length,
                blobId: expect.any(String)
            }
        ]);
    });

    it("answers undefined for a package that was never installed", () => {
        expect(findScriptModule({ name: "never-installed", version: "9.9.9", target: "portable" as const })).toBeUndefined();
    });

    it("replaces a package in place, dropping files the rebuild no longer names", () => {
        store("beta@1.0.0", [
            { name: "entry.mjs", source: "export const v = 1;" },
            { name: "old.mjs", source: "export const old = 1;" }
        ]);
        const noteId = scriptModuleNoteId({ name: "beta", version: "1.0.0", target: "portable" as const });

        const restored = store("beta@1.0.0", [{ name: "entry.mjs", source: "export const v=2;" }]);

        // The same note, so a re-install does not leave two copies behind to sync.
        expect(restored.noteId).toBe(noteId);
        expect(becca.notes[noteId].getAttachmentsByRole(MODULE_FILE_ROLE).map((a) => a.title))
            .toEqual(["entry.mjs"]);
        expect(findScriptModule({ name: "beta", version: "1.0.0", target: "portable" as const })?.files).toEqual([
            {
                name: "entry.mjs",
                url: "https://esm.sh/entry.mjs",
                size: "export const v=2;".length,
                blobId: expect.any(String)
            }
        ]);
    });

    it("lists what is installed and skips notes that are not modules", () => {
        store("gamma@2.0.0", [{ name: "entry.mjs", source: "export const g = 1;" }]);
        store("delta@1.0.0", [{ name: "entry.mjs", source: "export const d = 1;" }]);
        getContext().init(() => noteService.createNewNote({
            title: "stray note",
            parentNoteId: SCRIPT_MODULES_ROOT,
            type: "text",
            content: "not a manifest",
            ignoreForbiddenParents: true
        }));

        const listed = listScriptModules().map((module) => formatPackageSpec(module.spec));

        expect(listed).toContain("delta@1.0.0");
        expect(listed).toContain("gamma@2.0.0");
        expect(listed.indexOf("delta@1.0.0")).toBeLessThan(listed.indexOf("gamma@2.0.0"));
        expect(listed).not.toContain("stray note");
    });

    it("does not read back a module whose files did not all survive", () => {
        const stored = store("epsilon@1.0.0", [
            { name: "entry.mjs", source: "export const e = 1;" },
            { name: "dep.mjs", source: "export const d = 1;" }
        ]);

        const attachment = becca.notes[stored.noteId].getAttachmentByTitle("dep.mjs");
        getContext().init(() => attachment?.markAsDeleted());

        expect(findScriptModule({ name: "epsilon", version: "1.0.0", target: "portable" as const })).toBeUndefined();
    });

    it("reads a file's source only when it is asked for", () => {
        const stored = store("theta@1.0.0", [
            { name: "entry.mjs", source: ENTRY_SOURCE },
            { name: "dep.mjs", source: DEP_SOURCE }
        ]);

        // The record describes the files; it never carries what is in them.
        expect(Object.keys(stored.files[0]).sort()).toEqual(["blobId", "name", "size", "url"]);

        const readSource = openScriptModuleSources(becca.notes[stored.noteId]);
        expect(readSource("entry.mjs")).toBe(ENTRY_SOURCE);
        expect(readSource("dep.mjs")).toBe(DEP_SOURCE);
        expect(readSource("never-stored.mjs")).toBeUndefined();
    });

    it("finds an install by note id, and refuses a note that is not one", () => {
        const stored = store("iota@1.0.0", [{ name: "entry.mjs", source: "export const i = 1;" }]);

        expect(findScriptModuleByNoteId(stored.noteId)?.spec.name).toBe("iota");
        expect(findScriptModuleByNoteId("no-such-note")).toBeUndefined();

        // A manifest outside the container is not an install, whatever its content says.
        const { note } = getContext().init(() => noteService.createNewNote({
            title: "impostor",
            parentNoteId: "root",
            type: "code",
            mime: "application/json",
            content: JSON.stringify({
                spec: { name: "impostor" },
                providerId: "esm.sh",
                entry: "entry.mjs",
                files: [{ name: "entry.mjs", url: "https://esm.sh/entry.mjs" }]
            })
        }));
        expect(findScriptModuleByNoteId(note.noteId)).toBeUndefined();
    });

    it("removes an installed package, and says when there was none", () => {
        store("zeta@1.0.0", [{ name: "entry.mjs", source: "export const z = 1;" }]);

        const zeta = { name: "zeta", version: "1.0.0", target: "portable" as const };
        expect(getContext().init(() => deleteScriptModule(zeta))).toBe(true);
        expect(findScriptModule(zeta)).toBeUndefined();
        expect(getContext().init(() => deleteScriptModule(zeta))).toBe(false);
    });
});

describe("parseManifest", () => {
    const valid = {
        spec: { name: "cheerio", version: "1.1.2", target: "portable" as const },
        providerId: "esm.sh",
        entry: "entry.mjs",
        files: [{ name: "entry.mjs", url: "https://esm.sh/entry.mjs" }]
    };

    it("reads a manifest it wrote", () => {
        expect(parseManifest(JSON.stringify(valid))).toEqual(valid);
    });

    it("refuses anything that is not one", () => {
        const cases: Record<string, unknown> = {
            "not json": undefined,
            "no provider": { ...valid, providerId: 1 },
            "no entry": { ...valid, entry: undefined },
            "entry not among the files": { ...valid, entry: "missing.mjs" },
            "files not a list": { ...valid, files: "entry.mjs" },
            "file without a url": { ...valid, files: [{ name: "entry.mjs" }] },
            "spec without a name": { ...valid, spec: { version: "1.0.0" } }
        };

        expect(parseManifest("not json at all")).toBeUndefined();
        for (const [label, value] of Object.entries(cases)) {
            expect(parseManifest(JSON.stringify(value)), label).toBeUndefined();
        }
    });
});

describe("stored declarations", () => {
    const TYPES: SourceFile[] = [
        { name: "pkg_index.d.ts", source: 'export * from "./pkg_other.d.ts";' },
        { name: "pkg_other.d.ts", source: "export interface Thing {}" }
    ];

    function storeTyped(spec: string, types: SourceFile[] | undefined) {
        const base = artifact(spec, [ { name: "entry.mjs", source: ENTRY_SOURCE } ]);
        const withTypes: ScriptModuleArtifact = types
            ? { ...base, types: { entry: types[0].name, files: types.map((f) => ({ ...f, url: `https://esm.sh/${f.name}` })) } }
            : base;

        return getContext().init(() => storeScriptModule(withTypes));
    }

    it("stores the declarations apart from the sources and reads them back", () => {
        const stored = storeTyped("typed@1.0.0", TYPES);

        expect(stored.types?.entry).toBe("pkg_index.d.ts");
        expect(stored.types?.files.map((f) => f.name)).toEqual([ "pkg_index.d.ts", "pkg_other.d.ts" ]);
        expect(readScriptModuleTypes(stored)?.map((f) => f.content))
            .toEqual(TYPES.map((f) => f.source));

        // The loader lists the sources alone, so a declaration is never evaluated as a module.
        const note = becca.getNoteOrThrow(stored.noteId);
        const roles = note.getAttachments().map((a) => a.role);
        expect(roles.filter((role) => role === MODULE_TYPES_ROLE)).toHaveLength(2);
        expect(openScriptModuleSources(note)("pkg_index.d.ts")).toBeUndefined();
        expect(openScriptModuleSources(note)("entry.mjs")).toBe(ENTRY_SOURCE);

        // A package's size is what it runs as; its declarations are the editor's business.
        expect(stored.size).toBe(ENTRY_SOURCE.length);
    });

    it("drops the declarations a reinstall no longer names", () => {
        storeTyped("shrinking@1.0.0", TYPES);
        const stored = storeTyped("shrinking@1.0.0", [ TYPES[0] ]);

        expect(stored.types?.files.map((f) => f.name)).toEqual([ "pkg_index.d.ts" ]);
        const kept = becca.getNoteOrThrow(stored.noteId).getAttachments()
            .filter((a) => a.role === MODULE_TYPES_ROLE);
        expect(kept.map((a) => a.title)).toEqual([ "pkg_index.d.ts" ]);
    });

    it("reads back a package that was installed without declarations", () => {
        const stored = storeTyped("untyped@1.0.0", undefined);

        expect(stored.types).toBeUndefined();
        expect(readScriptModuleTypes(stored)).toBeUndefined();
    });

    it("refuses a manifest whose declarations name an entry that is not among them", () => {
        const manifest = {
            spec: { name: "pkg", target: "portable" },
            providerId: "esm.sh",
            entry: "entry.mjs",
            files: [ { name: "entry.mjs", url: "https://esm.sh/entry.mjs" } ]
        };

        expect(parseManifest(JSON.stringify(manifest))?.types).toBeUndefined();
        expect(parseManifest(JSON.stringify({
            ...manifest,
            types: { entry: "missing.d.ts", files: [ { name: "index.d.ts", url: "https://esm.sh/index.d.ts" } ] }
        }))?.types).toBeUndefined();
        expect(parseManifest(JSON.stringify({
            ...manifest,
            types: { entry: "index.d.ts", files: [ { name: "index.d.ts", url: "https://esm.sh/index.d.ts" } ] }
        }))?.types?.entry).toBe("index.d.ts");
    });
});
