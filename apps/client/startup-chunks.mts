import { basename, dirname, extname, join } from "node:path";

import { normalizePath } from "vite";

/**
 * The parts of the app that an `import()` loads while the app starts, each with the modules that
 * `import()` names. Paths are relative to `src`.
 */
export const STARTUP_AREAS = {
    // The handlers and components that `desktop.ts` starts after the first render of the layout.
    "startup": [ "desktop_startup.ts" ],
    "tree": [ "widgets/note_tree.ts" ],
    "status-bar": [
        "widgets/layout/StatusBarPanels.tsx",
        "widgets/layout/StatusBarAttributes.tsx",
        "widgets/layout/StatusBarCode.tsx",
        "widgets/sidebar/Backlinks.tsx",
        "widgets/sidebar/NotePaths.tsx"
    ],
    "launch-bar": [
        "widgets/quick_search.tsx",
        "widgets/launch_bar/RecordMeetingButton.tsx",
        "widgets/launch_bar/CustomWidget.tsx",
        "widgets/launch_bar/LauncherDropTarget.tsx",
        "widgets/launch_bar/CalendarDropdown.tsx",
        "widgets/launch_bar/BookmarkMenu.tsx"
    ],
    "right-pane": [ "widgets/sidebar/RightPaneContent.tsx" ],
    // A text note as it is first shown, with the parts of the title area that load with it.
    "note": [
        "widgets/type_widgets/text/ReadOnlyText.tsx",
        "widgets/layout/NoteTypeSwitcher.tsx",
        "widgets/PromotedAttributes.tsx"
    ],
    "script-api": [ "services/frontend_script_api.ts" ],
    "editor": [ "widgets/type_widgets/text/EditableText.tsx" ]
} satisfies Record<string, string[]>;

export type StartupArea = keyof typeof STARTUP_AREAS;

/**
 * The areas a page loads only for some users or notes: the script API for a user with `#widget` or
 * startup scripts. The areas after one cannot count on its modules.
 */
export const OPTIONAL_AREAS: ReadonlySet<StartupArea> = new Set<StartupArea>([ "script-api" ]);

export interface StartupPage {
    /** The module `importEntry()` in `index.ts` loads for the page. Its imports are the page's `shell`. */
    entry: string;
    /** The areas the page loads after its shell, in that order. */
    areas: StartupArea[];
}

/** The pages `index.ts` chooses between. */
export const STARTUP_PAGES: Record<string, StartupPage> = {
    desktop: {
        entry: "desktop.ts",
        areas: [ "startup", "tree", "status-bar", "launch-bar", "right-pane", "note", "script-api", "editor" ]
    },
    mobile: { entry: "mobile.ts", areas: [ "launch-bar" ] },
    login: { entry: "login.tsx", areas: [] },
    setup: { entry: "setup.tsx", areas: [] },
    set_password: { entry: "set_password.tsx", areas: [] },
    print: { entry: "print.tsx", areas: [] }
};

/** What {@link assignStartupChunks} reads of a module; a subset of the bundler's `ModuleInfo`. */
export interface ModuleLinks {
    importedIds: readonly string[];
    dynamicallyImportedIds: readonly string[];
    importers: readonly string[];
    dynamicImporters: readonly string[];
    /** Whether the module is an input of the build. */
    isEntry: boolean;
}

interface Step {
    name: string;
    /** The absolute IDs of the modules the step loads from. */
    entries: string[];
    /** Whether the page can skip the step, so that a later step loads what it shares with this one. */
    optional?: boolean;
}

export interface StartupChunkOptions {
    /** The absolute ID of the build input that loads the pages. Its imports are the `entry` step. */
    entry: string;
    /** The steps of each page in the order the page loads them: its shell, then its areas. */
    pages: Record<string, Step[]>;
    /** The links of a module, or nothing for a module outside the build. */
    getModule: (id: string) => ModuleLinks | null | undefined;
}

/**
 * Names the chunk of the modules that the pages load while they start.
 *
 * A step of a page takes the modules its entries import statically that no earlier step of that
 * page has loaded. Modules that every page loads in the same steps, or not at all, share a chunk,
 * so a page downloads few files for a step and none of the code that only other pages use. Such a
 * chunk is named after its steps and, unless every page loads it, their pages: `shell`,
 * `shell.desktop.mobile`, `startup.desktop_shell.print`.
 *
 * A page can skip an optional step, so its modules do not count as loaded for the steps after it.
 * A module that a later step imports too gets a chunk named after both steps, `script-api+editor`,
 * which keeps the rest of the optional step away from a page that skipped it.
 *
 * Every other input of the build counts as a page with one step, which keeps the chunks of the app
 * out of it. A module keeps the chunk the bundler gives it when a step loads from it, or when no
 * lazily loaded module imports it: the code of one page then stays in that page's own chunk, away
 * from the code that a lazily loaded module can make any page download.
 */
export function assignStartupChunks({ entry, pages, getModule }: StartupChunkOptions) {
    const modules = collectLinkedModules(entry, getModule);
    const stepsByPage = new Map<string, Step[]>();
    const pageEntries = new Set<string>();
    const areaEntries = new Set<string>();
    for (const [ page, [ shell, ...areas ] ] of Object.entries(pages)) {
        stepsByPage.set(page, [ { name: "entry", entries: [ entry ] }, shell, ...areas ]);
        for (const id of shell.entries) {
            pageEntries.add(id);
        }
        for (const id of areas.flatMap((area) => area.entries)) {
            areaEntries.add(id);
        }
    }
    for (const [ id, module ] of modules) {
        if (module.isEntry && id !== entry) {
            stepsByPage.set(getInputName(id), [ { name: "shell", entries: [ id ] } ]);
            pageEntries.add(id);
        }
    }

    const stepsByModule = new Map<string, Map<string, string>>();
    for (const [ page, steps ] of stepsByPage) {
        const loaded = new Set<string>();
        for (const step of steps) {
            for (const id of collectImports(step.entries, loaded, modules)) {
                if (!step.optional) {
                    loaded.add(id);
                }
                const stepsOfModule = stepsByModule.get(id) ?? new Map<string, string>();
                const optionalSteps = stepsOfModule.get(page);
                stepsOfModule.set(page, optionalSteps ? `${optionalSteps}+${step.name}` : step.name);
                stepsByModule.set(id, stepsOfModule);
            }
        }
    }

    const lazyEntries = new Set<string>();
    for (const module of modules.values()) {
        for (const id of module.dynamicallyImportedIds) {
            if (!pageEntries.has(id)) {
                lazyEntries.add(id);
            }
        }
    }
    const lazilyLoaded = collectImports([ ...lazyEntries ], new Set(), modules);

    const chunks = new Map<string, string>();
    for (const [ id, stepsOfModule ] of stepsByModule) {
        if (lazilyLoaded.has(id) && !areaEntries.has(id)) {
            chunks.set(id, getChunkName(stepsOfModule, stepsByPage.size));
        }
    }
    return chunks;
}

/**
 * A group for `output.codeSplitting.groups` that puts the modules of {@link STARTUP_PAGES} into the
 * chunks {@link assignStartupChunks} names. It needs `includeDependenciesRecursively: false`, or
 * each chunk would also take the imports of its modules from the chunks of earlier steps.
 */
export function startupChunkGroup(rootDir: string) {
    const toId = (file: string) => normalizePath(join(rootDir, "src", file));
    let chunks: Map<string, string> | undefined;

    return {
        debugName: "startup",
        name(id: string, ctx: { getModuleInfo(id: string): ModuleLinks | null }) {
            chunks ??= assignStartupChunks({
                entry: normalizePath(join(rootDir, "index.html")),
                pages: Object.fromEntries(Object.entries(STARTUP_PAGES).map(([ page, { entry, areas } ]) => [ page, [
                    { name: "shell", entries: [ toId(entry) ] },
                    ...areas.map((area) => ({
                        name: area,
                        entries: STARTUP_AREAS[area].map(toId),
                        optional: OPTIONAL_AREAS.has(area)
                    }))
                ] ])),
                getModule: (moduleId) => ctx.getModuleInfo(moduleId)
            });
            return chunks.get(id) ?? null;
        }
    };
}

/** The modules of the build that import `entry` or that it imports, directly or not. */
function collectLinkedModules(entry: string, getModule: StartupChunkOptions["getModule"]) {
    const modules = new Map<string, ModuleLinks>();
    const pending = [ entry ];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        const module = modules.has(id) ? undefined : getModule(id);
        if (!module) continue;
        modules.set(id, module);
        pending.push(
            ...module.importedIds, ...module.dynamicallyImportedIds,
            ...module.importers, ...module.dynamicImporters
        );
    }
    return modules;
}

/** The modules that `entries` import statically, directly or not, leaving out those in `loaded`. */
function collectImports(entries: string[], loaded: ReadonlySet<string>, modules: Map<string, ModuleLinks>) {
    const imports = new Set<string>();
    const pending = [ ...entries ];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        const module = modules.get(id);
        if (!module || imports.has(id) || loaded.has(id)) continue;
        imports.add(id);
        pending.push(...module.importedIds);
    }
    return imports;
}

/** Names the page of a build input: its file, or its package for an `index` or a `src/index`. */
function getInputName(id: string) {
    const name = basename(id, extname(id));
    if (name !== "index") {
        return name;
    }
    const dir = dirname(id);
    return basename(basename(dir) === "src" ? dirname(dir) : dir);
}

function getChunkName(stepsOfModule: Map<string, string>, pageCount: number) {
    const pagesByStep = new Map<string, string[]>();
    for (const [ page, step ] of stepsOfModule) {
        pagesByStep.set(step, [ ...pagesByStep.get(step) ?? [], page ]);
    }
    return [ ...pagesByStep ]
        .map(([ step, pages ]) => (pages.length === pageCount ? step : [ step, ...pages ].join(".")))
        .join("_");
}
