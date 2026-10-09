/// <reference types="node" />
import ejs from "ejs";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("boot_script.ejs", () => {
    it("applies the stored theme without leaving global names behind", () => {
        const { context, classes } = runBootScript({
            "theme": "dark"
        });

        expect([ ...classes ]).toStrictEqual([ "theme-dark" ]);
        expect(context.glob).toEqual({ isStatic: true, theme: "dark" });
        expect(() => runInContext(`const el = 1; let theme = 2; let root = 3;`, context)).not.toThrow();
    });

    it("follows the system theme when storage holds none or cannot be read", () => {
        expect([ ...runBootScript({}, true).classes ]).toStrictEqual([ "theme-dark" ]);
        expect([ ...runBootScript(null, false).classes ]).toStrictEqual([ "theme-light" ]);
    });

    it("leaves no inline script in the page template besides the boot script", () => {
        const page = readFileSync(new URL("page.ejs", import.meta.url), "utf8");
        expect(page.match(/<script>/g)).toBeNull();
    });
});

/**
 * Runs the rendered boot script in a sandbox, with `stored` as the local storage (`null` for
 * storage that throws) and `prefersDark` as the system theme.
 */
function runBootScript(stored: Record<string, string> | null, prefersDark = false) {
    const classes = new Set<string>();
    const context = createContext({
        localStorage: {
            getItem(key: string) {
                if (!stored) {
                    throw new Error("Storage is blocked.");
                }
                return stored[key] ?? null;
            }
        },
        matchMedia: () => ({ matches: prefersDark }),
        document: { documentElement: { classList: { add: (name: string) => classes.add(name) } } }
    });
    context.window = context;

    const html = ejs.render(readFileSync(new URL("boot_script.ejs", import.meta.url), "utf8"),
        { isStatic: true });
    runInContext(html.replace(/<\/?script>/g, ""), context);
    return { context, classes };
}
