import { describe, expect, it } from "vitest";

/** The package's sources as text, keyed `./index.ts`, `./plugins/…`. */
const sources = import.meta.glob<string>("./**/*.ts", { query: "?raw", import: "default", eager: true });

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm;

describe("styles.ts", () => {
    it("lists every stylesheet the editor's modules import, in the order they load them", () => {
        // What the editor's own modules reach, as if `styles.ts` did not exist. The stylesheets
        // only `styles.ts` imports, such as CKEditor's own, are not among them.
        const loaded = collectStylesheets("./index.ts", new Set([ "./styles.ts" ]));
        const listed = collectStylesheets("./styles.ts", new Set());

        expect(loaded.length).toBeGreaterThan(20);
        expect(listed.filter((stylesheet) => loaded.includes(stylesheet))).toEqual(loaded);
    });
});

/**
 * The stylesheets a module's static imports reach, in the order a bundle loads them: depth first,
 * each stylesheet where it is first reached.
 */
function collectStylesheets(entry: string, skip: Set<string>) {
    const stylesheets: string[] = [];
    const visited = new Set(skip);

    function visit(file: string) {
        visited.add(file);
        for (const [ , specifier ] of (sources[file] ?? "").matchAll(STATIC_IMPORT)) {
            if (specifier.endsWith(".css")) {
                const stylesheet = specifier.startsWith(".") ? resolve(file, specifier) : specifier;
                if (!stylesheets.includes(stylesheet)) {
                    stylesheets.push(stylesheet);
                }
                continue;
            }

            if (specifier.startsWith(".")) {
                const base = resolve(file, specifier.replace(/\.js$/, ""));
                const module = [ `${base}.ts`, `${base}/index.ts` ].find((candidate) => candidate in sources);
                if (module && !visited.has(module)) {
                    visit(module);
                }
            }
        }
    }

    visit(entry);
    return stylesheets;
}

/** Resolves a relative specifier against the file importing it, in the `./a/b` form of the keys. */
function resolve(from: string, specifier: string) {
    const segments = from.split("/").slice(0, -1);
    for (const segment of specifier.split("/")) {
        if (segment === "..") {
            segments.pop();
        } else if (segment !== ".") {
            segments.push(segment);
        }
    }
    return segments.join("/");
}
