import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Plugin } from "vite";

export type Catalogue = { [key: string]: string | Catalogue };

/** The language the catalogues are written in, which every other one is completed from. */
const SOURCE_LANGUAGE = "en";

/** The catalogues of each language: `translation` for the app, `entry` for setup and login. */
const NAMESPACES = [ "translation", "entry" ];

/** The suffixes i18next gives the forms of a plural key, one per `Intl.PluralRules` category. */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Matches the request of a catalogue, in the client's dev server and in standalone's. */
const CATALOGUE_URL = /\/translations\/([^/]+)\/([^/]+)\.json$/;

/**
 * Serves each catalogue completed with the English strings its language lacks, so the client loads
 * one catalogue and needs no English fallback. The files under `translationsDir` are Weblate's and
 * are never changed.
 *
 * A build writes the merged catalogues of every language into `translations/` of its output, once
 * the bundle is written: like the static copy they replace, they are no part of the bundle, which
 * the Codecov plugin measures. The dev server merges a catalogue when it is requested, so only the
 * language in use is processed, and an edit to a source catalogue shows on the next reload.
 */
export function translationCatalogues(translationsDir: string): Plugin {
    return {
        name: "trilium-translation-catalogues",

        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const match = CATALOGUE_URL.exec(req.url?.split("?")[0] ?? "");
                if (!match || !NAMESPACES.includes(match[2])) {
                    next();
                    return;
                }

                const [ , lng, ns ] = match;
                readMergedCatalogue(translationsDir, lng, ns).then((catalogue) => {
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.setHeader("Cache-Control", "no-cache");
                    res.end(JSON.stringify(catalogue));
                }, () => next());
            });
        },

        async writeBundle({ dir }) {
            if (!dir) return;
            const languages = readdirSync(translationsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name);

            for (const lng of languages) {
                const outDir = join(dir, "translations", lng);
                await mkdir(outDir, { recursive: true });
                for (const ns of NAMESPACES) {
                    const catalogue = await readMergedCatalogue(translationsDir, lng, ns);
                    await writeFile(join(outDir, `${ns}.json`), JSON.stringify(catalogue));
                }
            }
        }
    };
}

/**
 * Returns `locale` with every key of `english` it lacks, at any depth. Each form `lng` uses of a
 * plural key that the locale lacks or left empty gets the English text of that form, or its
 * `_other` text. A key the locale translated, a plural form included, is kept as it is.
 */
export function mergeCatalogue(english: Catalogue, locale: Catalogue, lng: string): Catalogue {
    const merged: Catalogue = { ...locale };
    const pluralCategories = getPluralCategories(lng);

    for (const [ key, value ] of Object.entries(english)) {
        if (typeof value !== "string") {
            const own = locale[key];
            merged[key] = mergeCatalogue(value, typeof own === "object" ? own : {}, lng);
            continue;
        }

        const pluralBase = key.replace(PLURAL_SUFFIX, "");
        if (pluralBase === key) {
            merged[key] ??= value;
            continue;
        }

        const otherForm = english[`${pluralBase}_other`];
        for (const category of pluralCategories) {
            const form = `${pluralBase}_${category}`;
            const englishForm = english[form] ?? otherForm;
            if (typeof englishForm === "string" && !merged[form]) {
                merged[form] = englishForm;
            }
        }
    }

    return merged;
}

async function readMergedCatalogue(translationsDir: string, lng: string, ns: string) {
    const english = await readCatalogue(translationsDir, SOURCE_LANGUAGE, ns);
    if (lng === SOURCE_LANGUAGE) return english;
    return mergeCatalogue(english, await readCatalogue(translationsDir, lng, ns), lng);
}

async function readCatalogue(translationsDir: string, lng: string, ns: string): Promise<Catalogue> {
    if (!/^[\w-]+$/.test(lng)) throw new Error(`Not a language: ${lng}`);
    return JSON.parse(await readFile(join(translationsDir, lng, `${ns}.json`), "utf8"));
}

/**
 * The plural forms of `lng`, as i18next picks them at runtime: it reads the folder name as a
 * language tag, with `_` as `-`. A name that is no tag gets the English forms.
 */
function getPluralCategories(lng: string) {
    try {
        return new Intl.PluralRules(lng.replace("_", "-")).resolvedOptions().pluralCategories;
    } catch {
        return new Intl.PluralRules(SOURCE_LANGUAGE).resolvedOptions().pluralCategories;
    }
}
