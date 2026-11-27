import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { tmpdir } from "os";
import { join } from "path";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { describe, expect, it, vi } from "vitest";

import { type Catalogue, mergeCatalogue, translationCatalogues } from "./translation-catalogues.mjs";

describe("mergeCatalogue", () => {
    it("fills the keys the locale lacks from English, at any depth, and keeps its own", () => {
        const english = {
            save: "Save",
            dialog: { title: "Title", close: "Close" },
            menu: { file: { open: "Open" } }
        };
        const german = { save: "Speichern", dialog: { title: "Titel" } };

        expect(mergeCatalogue(english, german, "de")).toEqual({
            save: "Speichern",
            dialog: { title: "Titel", close: "Close" },
            menu: { file: { open: "Open" } }
        });
    });

    it("gives a missing plural every form the locale uses", () => {
        const english = { notes_one: "{{count}} note", notes_other: "{{count}} notes" };

        expect(mergeCatalogue(english, {}, "ru")).toEqual({
            notes_one: "{{count}} note",
            notes_few: "{{count}} notes",
            notes_many: "{{count}} notes",
            notes_other: "{{count}} notes"
        });
        // A locale code with an underscore, as the catalogue folders name some, is read as a tag.
        expect(mergeCatalogue(english, {}, "pt_br")).toEqual({
            notes_one: "{{count}} note",
            notes_many: "{{count}} notes",
            notes_other: "{{count}} notes"
        });
    });

    it("leaves a plural the locale translated alone", () => {
        const english = { notes_one: "{{count}} note", notes_other: "{{count}} notes" };
        const romanian = { notes_one: "o notiță", notes_few: "{{count}} notițe", notes_other: "{{count}} de notițe" };

        expect(mergeCatalogue(english, romanian, "ro")).toEqual(romanian);
    });

    it("fills the forms of a plural the locale left empty or missing, keeping the ones it translated", () => {
        const english = { notes_one: "{{count}} note", notes_other: "{{count}} notes" };
        const polish = { notes_one: "{{count}} notatka", notes_few: "", notes_many: "" };

        expect(mergeCatalogue(english, polish, "pl")).toEqual({
            notes_one: "{{count}} notatka",
            notes_few: "{{count}} notes",
            notes_many: "{{count}} notes",
            notes_other: "{{count}} notes"
        });
    });
});

describe("translationCatalogues", () => {
    function setUp() {
        const dir = mkdtempSync(join(tmpdir(), "catalogues-"));
        const write = (lng: string, ns: string, catalogue: Catalogue) => {
            mkdirSync(join(dir, lng), { recursive: true });
            writeFileSync(join(dir, lng, `${ns}.json`), JSON.stringify(catalogue));
        };
        write("en", "translation", { save: "Save", close: "Close" });
        write("en", "entry", { login: "Log in" });
        write("de", "translation", { save: "Speichern" });
        write("de", "entry", {});
        return { dir, plugin: translationCatalogues(dir) };
    }

    /** Sends `url` through the plugin's dev middleware and returns what it answered. */
    async function request(plugin: Plugin, url: string) {
        let middleware: Connect.NextHandleFunction | undefined;
        const server = { middlewares: { use: (fn: Connect.NextHandleFunction) => { middleware = fn; } } };
        const hook = plugin.configureServer;
        const configure = typeof hook === "function" ? hook : hook?.handler;
        await configure?.call({} as never, server as unknown as ViteDevServer);
        if (!middleware) throw new Error("The plugin added no middleware.");

        const headers: Record<string, string> = {};
        let body: string | undefined;
        const next = vi.fn();
        await new Promise<void>((resolve) => {
            const res = {
                setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
                end: (chunk: string) => { body = chunk; resolve(); }
            };
            middleware?.({ url } as IncomingMessage, res as unknown as ServerResponse, () => { next(); resolve(); });
        });
        return { headers, body, next };
    }

    it("answers a catalogue request in dev with the merged catalogue of that language only", async () => {
        const { plugin } = setUp();

        const german = await request(plugin, "/src/translations/de/translation.json");
        expect(german.headers["content-type"]).toMatch(/^application\/json/);
        expect(JSON.parse(german.body ?? "")).toEqual({ save: "Speichern", close: "Close" });

        const english = await request(plugin, "/translations/en/entry.json?v=1");
        expect(JSON.parse(english.body ?? "")).toEqual({ login: "Log in" });

        const other = await request(plugin, "/src/stylesheets/style.css");
        expect(other.next).toHaveBeenCalledOnce();
        expect(other.body).toBeUndefined();
    });

    it("writes every catalogue of every language, merged, beside the build, outside its bundle", async () => {
        const { plugin } = setUp();
        // The bundle is what the Codecov plugin measures, as `viteStaticCopy` left the catalogues out of it.
        expect(plugin.generateBundle).toBeUndefined();

        const outDir = mkdtempSync(join(tmpdir(), "catalogues-out-"));
        const hook = plugin.writeBundle;
        const write = typeof hook === "function" ? hook : hook?.handler;
        expect(write).toBeDefined();
        await write?.call({} as never, { dir: outDir } as never, {});

        const read = (path: string) => JSON.parse(readFileSync(join(outDir, path), "utf8"));
        expect(read("translations/en/translation.json")).toEqual({ save: "Save", close: "Close" });
        expect(read("translations/en/entry.json")).toEqual({ login: "Log in" });
        expect(read("translations/de/translation.json")).toEqual({ save: "Speichern", close: "Close" });
        expect(read("translations/de/entry.json")).toEqual({ login: "Log in" });
    });
});
