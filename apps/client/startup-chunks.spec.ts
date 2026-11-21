import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
    assignStartupChunks, type ModuleLinks, STARTUP_AREAS, STARTUP_PAGES, startupChunkGroup
} from "./startup-chunks.mjs";

/** A build described by what each module imports statically (`imports`) and with `import()` (`lazy`). */
function buildGraph(spec: Record<string, { imports?: string[], lazy?: string[], isEntry?: boolean }>) {
    const modules = new Map<string, ModuleLinks & { importers: string[], dynamicImporters: string[] }>();
    for (const [ id, { imports = [], lazy = [], isEntry = false } ] of Object.entries(spec)) {
        modules.set(id, { importedIds: imports, dynamicallyImportedIds: lazy, importers: [], dynamicImporters: [], isEntry });
    }
    for (const [ id, module ] of modules) {
        for (const imported of module.importedIds) {
            modules.get(imported)?.importers.push(id);
        }
        for (const imported of module.dynamicallyImportedIds) {
            modules.get(imported)?.dynamicImporters.push(id);
        }
    }
    return (id: string) => modules.get(id);
}

describe("assignStartupChunks", () => {
    const getModule = buildGraph({
        "index.html": { imports: [ "index.ts" ], isEntry: true },
        "index.ts": { imports: [ "splash.ts" ], lazy: [ "desktop.ts", "mobile.ts", "login.tsx" ] },
        "splash.ts": {},
        "desktop.ts": { imports: [ "DesktopLayout.tsx", "utils.ts", "widget.tsx", "icons.ts", "tabs.ts", "markdown.ts" ], lazy: [ "startup.ts", "tree.ts", "dialog.tsx" ] },
        "DesktopLayout.tsx": { imports: [ "utils.ts" ] },
        "mobile.ts": { imports: [ "utils.ts", "icons.ts" ], lazy: [ "tree.ts" ] },
        "login.tsx": { imports: [ "utils.ts" ] },
        "startup.ts": { imports: [ "handlers.ts", "utils.ts", "widget.tsx" ] },
        "tree.ts": { imports: [ "fancytree.js", "widget.tsx", "handlers.ts" ] },
        "dialog.tsx": { imports: [ "widget.tsx", "icons.ts", "tabs.ts", "markdown.ts", "dialog_only.ts" ] },
        "share/src/index.ts": { imports: [ "utils.ts", "markdown.ts", "share_only.ts" ], isEntry: true },
        "utils.ts": { lazy: [ "toast.ts" ] },
        "toast.ts": { imports: [ "utils.ts", "splash.ts" ] },
        "widget.tsx": {},
        "tabs.ts": {},
        "markdown.ts": {},
        "icons.ts": {},
        "handlers.ts": {},
        "fancytree.js": {},
        "dialog_only.ts": {},
        "share_only.ts": {},
        "unrelated.ts": { isEntry: true }
    });
    const chunks = assignStartupChunks({
        entry: "index.html",
        pages: {
            desktop: [
                { name: "shell", entries: [ "desktop.ts" ] },
                { name: "startup", entries: [ "startup.ts" ] },
                { name: "tree", entries: [ "tree.ts" ] }
            ],
            mobile: [ { name: "shell", entries: [ "mobile.ts" ] }, { name: "tree", entries: [ "tree.ts" ] } ],
            login: [ { name: "shell", entries: [ "login.tsx" ] } ]
        },
        getModule
    });

    it("names a chunk after the steps that load it and the pages that do", () => {
        expect(Object.fromEntries(chunks)).toEqual({
            // Every page loads it in its shell, the other input of the build included.
            "utils.ts": "shell",
            // The module index.ts imports, which toast.ts makes lazily loaded. The share input
            // loads toast.ts through utils.ts, so the chunk leaves out the rest of the entry step.
            "splash.ts": "entry.desktop.mobile.login_lazy-ynpvlx.share",
            // Only the desktop loads it while it starts, and the dialog shares it.
            "tabs.ts": "shell.desktop",
            "icons.ts": "shell.desktop.mobile",
            // The other input of the build is a page named after its package.
            "markdown.ts": "shell.desktop.share",
            // In the desktop's shell, while mobile gets it with the tree.
            "widget.tsx": "shell.desktop_tree.mobile",
            // The desktop's startup loads it before its tree does; mobile gets it with the tree.
            "handlers.ts": "startup.desktop_tree.mobile",
            "fancytree.js": "tree.desktop.mobile"
        });
    });

    it("leaves a module to the bundler unless a step loads it and a lazily loaded module imports it", () => {
        // The modules that `import()` names, and the layout that only desktop.ts imports.
        for (const id of [ "index.ts", "desktop.ts", "startup.ts", "tree.ts", "DesktopLayout.tsx" ]) {
            expect(chunks.has(id), id).toBe(false);
        }
        // What no page loads while it starts, and an input that shares nothing with the app.
        for (const id of [ "dialog.tsx", "dialog_only.ts", "toast.ts", "share_only.ts", "unrelated.ts" ]) {
            expect(chunks.has(id), id).toBe(false);
        }
    });

    it("keeps what a later step shares with an optional step out of the optional step's chunk", () => {
        const optionalChunks = assignStartupChunks({
            entry: "index.html",
            pages: {
                desktop: [
                    { name: "shell", entries: [ "desktop.ts" ] },
                    { name: "scripts", entries: [ "scripts.ts" ], optional: true },
                    { name: "editor", entries: [ "editor.ts" ] },
                    { name: "dialog", entries: [ "dialog.tsx" ] }
                ]
            },
            getModule: buildGraph({
                "index.html": { imports: [ "index.ts" ], isEntry: true },
                "index.ts": { lazy: [ "desktop.ts" ] },
                "desktop.ts": { imports: [ "utils.ts" ], lazy: [ "scripts.ts", "editor.ts", "dialog.tsx" ] },
                "scripts.ts": { imports: [ "utils.ts", "tabulator.js", "palette.tsx", "calendar.js" ] },
                "editor.ts": { imports: [ "utils.ts", "ckeditor.js", "palette.tsx" ] },
                "dialog.tsx": { imports: [ "palette.tsx", "ckeditor.js", "calendar.js" ] },
                "utils.ts": {},
                "tabulator.js": {},
                "palette.tsx": {},
                "calendar.js": {},
                "ckeditor.js": {}
            })
        });

        expect(Object.fromEntries(optionalChunks)).toEqual({
            "utils.ts": "shell",
            "tabulator.js": "scripts",
            // The editor loads it whether or not the scripts have, and the dialog has it by then.
            "palette.tsx": "scripts+editor",
            "ckeditor.js": "editor",
            "calendar.js": "scripts+dialog"
        });
    });

    it("keeps what another input loads lazily out of a chunk with modules it does not load", () => {
        // The share theme draws a diagram with mermaid, which imports DOMPurify, a module the app's
        // shells import too, next to the module that creates the app context. Its app view and the
        // print page load that module as well, with the app's globals.
        const shareLoads = [ "mermaid.js", "dompurify.js" ];
        const shareChunks = assignStartupChunks({
            entry: "index.html",
            pages: {
                desktop: [ { name: "shell", entries: [ "desktop.ts" ] } ],
                mobile: [ { name: "shell", entries: [ "mobile.ts" ] } ],
                login: [ { name: "shell", entries: [ "login.tsx" ] } ],
                print: [ { name: "shell", entries: [ "print.tsx" ] } ]
            },
            appLoaders: [ "share/src/index.ts" ],
            getModule: buildGraph({
                "index.html": { imports: [ "index.ts" ], isEntry: true },
                "index.ts": { lazy: [ "desktop.ts", "mobile.ts", "login.tsx" ] },
                "desktop.ts": { imports: [ "sanitize.ts" ], lazy: [ "dialog.tsx" ] },
                "mobile.ts": { imports: [ "sanitize.ts" ] },
                "dialog.tsx": { imports: [ "sanitize.ts" ] },
                "login.tsx": { imports: [ "app_context.ts" ] },
                "sanitize.ts": { imports: [ "dompurify.js", "app_context.ts" ] },
                "app_context.ts": {},
                "print.tsx": { lazy: [ "print_view.tsx" ], isEntry: true },
                "print_view.tsx": { imports: [ "sanitize.ts" ] },
                "share/src/index.ts": {
                    imports: [ "share/src/content/mermaid.ts" ], lazy: [ "share/src/content/note_view.tsx" ], isEntry: true
                },
                "share/src/content/mermaid.ts": { lazy: [ "mermaid.js" ] },
                "share/src/content/note_view.tsx": { imports: [ "sanitize.ts" ] },
                "mermaid.js": { imports: [ "dompurify.js" ] },
                "dompurify.js": {}
            })
        });

        expect(shareChunks.get("sanitize.ts")).toBe("shell.desktop.mobile");
        const chunk = shareChunks.get("dompurify.js");
        const chunkMates = [ ...shareChunks ]
            .filter(([ id, name ]) => chunk !== undefined && name === chunk && !shareLoads.includes(id))
            .map(([ id ]) => id);
        expect(chunkMates).toEqual([]);
    });
});

describe("startupChunkGroup", () => {
    it("names the chunks from the bundler's module graph, which it reads once", () => {
        const root = "/repo/apps/client";
        const src = (file: string) => `${root}/src/${file}`;
        const getModuleInfo = vi.fn(buildGraph({
            [`${root}/index.html`]: { imports: [ src("index.ts") ], isEntry: true },
            [src("index.ts")]: { lazy: [ src("desktop.ts"), src("login.tsx") ] },
            [src("desktop.ts")]: { imports: [ src("services/utils.ts") ], lazy: [ src("widgets/note_tree.ts") ] },
            [src("login.tsx")]: { imports: [ src("services/utils.ts") ] },
            [src("widgets/note_tree.ts")]: { imports: [ src("services/utils.ts"), "/repo/node_modules/fancytree.js" ] },
            [src("services/utils.ts")]: {},
            "/repo/node_modules/fancytree.js": {}
        }));
        const ctx = { getModuleInfo: (id: string) => getModuleInfo(id) ?? null };
        const group = startupChunkGroup(root);

        expect(group.name("/repo/node_modules/fancytree.js", ctx)).toBe("tree.desktop");
        const calls = getModuleInfo.mock.calls.length;
        expect(group.name(src("services/utils.ts"), ctx)).toBe("shell.desktop.login");
        expect(group.name(src("widgets/note_tree.ts"), ctx)).toBeNull();
        expect(group.name("/repo/elsewhere.ts", ctx)).toBeNull();
        expect(getModuleInfo.mock.calls.length).toBe(calls);
    });
});

describe("the startup areas", () => {
    const src = join(import.meta.dirname, "src");

    it("name modules that exist", () => {
        const files = [
            ...Object.values(STARTUP_AREAS).flat(),
            ...Object.values(STARTUP_PAGES).map((page) => page.entry)
        ];
        expect(files.filter((file) => !existsSync(join(src, file)))).toEqual([]);
    });

    it("are each loaded by a page", () => {
        const loaded = new Set(Object.values(STARTUP_PAGES).flatMap((page) => page.areas));
        expect(Object.keys(STARTUP_AREAS).filter((area) => !loaded.has(area as keyof typeof STARTUP_AREAS))).toEqual([]);
    });
});
