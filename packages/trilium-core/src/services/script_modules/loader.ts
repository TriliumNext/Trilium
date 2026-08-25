import { SCRIPT_MODULE_IMPORT_META } from "@triliumnext/commons";
import { transform } from "sucrase";

import becca from "../../becca/becca.js";
import { getLog } from "../log.js";
import { canRequireHostModules, requireHostModule } from "./host_require.js";
import {
    formatPackageSpec,
    listScriptModules,
    openScriptModuleSources,
    type ScriptModuleFileInfo,
    type StoredScriptModule
} from "./storage.js";

/**
 * Resolves a specifier against the installed packages and evaluates the one it names, or answers
 * `undefined` where nothing is installed under that name.
 *
 * A package is evaluated the first time a script asks for it and its exports are kept for the life
 * of the process, so nothing an install holds is read until something imports it, and no script
 * pays to load a package it does not use.
 */
export function requireScriptModule(moduleName: string): { exports: unknown } | undefined {
    const module = resolveScriptModule(moduleName);
    if (!module) {
        return undefined;
    }

    return { exports: load(module) };
}

/**
 * The installed package a specifier names.
 *
 * `cheerio@1.1.2` names one version; `cheerio` names whichever version is installed, which is an
 * answer only while one is. Asking for a package installed at two versions is an error rather than
 * a guess, since the two versions are what the caller was distinguishing between.
 *
 * Two *builds* of one version are not that: they are the same package compiled for different
 * runtimes, so the one that runs here is chosen without asking, and the Node build wins where Node
 * can run it. A `require()` names a package, not a build.
 */
function resolveScriptModule(moduleName: string): StoredScriptModule | undefined {
    return selectInstalledModule(listScriptModules(), moduleName, canRequireHostModules());
}

/**
 * Picks the install a specifier names out of everything installed.
 *
 * Separate from reading the database so the rule can be checked on its own, `canRunNode` included —
 * whether this runtime has a module loader is not something a test can arrange by hand.
 */
export function selectInstalledModule(
    all: StoredScriptModule[],
    moduleName: string,
    canRunNode: boolean
): StoredScriptModule | undefined {
    const installed = all.filter((module) => names(module, moduleName));
    if (installed.length === 0) {
        return undefined;
    }

    const runnable = installed.filter((module) => module.spec.target !== "node" || canRunNode);
    if (runnable.length === 0) {
        throw new Error(
            `'${moduleName}' is installed only as a Node.js build, which this runtime ` +
            `cannot run. ` +
            `Install the portable build of it as well.`
        );
    }

    const versions = new Set(runnable.map((module) => formatPackageSpec(module.spec)));
    if (versions.size > 1) {
        throw new Error(
            `'${moduleName}' is installed more than once (${[ ...versions ].sort().join(", ")}). ` +
            `Ask for one of them by name and version.`
        );
    }

    return runnable.find((module) => module.spec.target === "node") ?? runnable[0];
}

/** Whether a specifier names this install, by name and version or by name alone. */
function names(module: StoredScriptModule, moduleName: string): boolean {
    return formatPackageSpec(module.spec) === moduleName
        || `${module.spec.name}${module.spec.subpath ?? ""}` === moduleName;
}

/** Drops what a package loaded, for a package that is being removed. */
export function forgetScriptModule(noteId: string) {
    evaluated.delete(noteId);
}

/** Forgets every loaded package, so the next require reads the installs again. */
export function clearScriptModuleCache() {
    evaluated.clear();
}

/** An evaluated package, kept against the content it was evaluated from. */
interface EvaluatedModule {
    fingerprint: string;
    exports: unknown;
}

const evaluated = new Map<string, EvaluatedModule>();

/**
 * The exports of a package, evaluating it where what is stored has changed since last time.
 *
 * The check is against the content ids of the files rather than a timestamp, so a re-install that
 * rebuilds a package to the same bytes reuses what is loaded, and one that changes them does not.
 */
function load(module: StoredScriptModule): unknown {
    const fingerprint = module.files.map((file) => `${file.name}@${file.blobId}`).join("|");
    const cached = evaluated.get(module.noteId);
    if (cached && cached.fingerprint === fingerprint) {
        return cached.exports;
    }

    const exports = evaluate(module);
    evaluated.set(module.noteId, { fingerprint, exports });
    return exports;
}

/**
 * Evaluates a package, reading each file the first time something imports it.
 *
 * The files are CommonJS by the time they run, so a cycle between them resolves the way Node
 * resolves one: a file that is still running answers with what it has exported so far.
 */
function evaluate(module: StoredScriptModule): unknown {
    const name = formatPackageSpec(module.spec);
    const note = becca.getNoteOrThrow(module.noteId);
    const readSource = openScriptModuleSources(note);
    const held = new Map(module.files.map((file) => [file.name, file]));
    const started = new Map<string, { exports: unknown }>();

    function loadFile(fileName: string): unknown {
        const running = started.get(fileName);
        if (running) {
            return running.exports;
        }

        const file = held.get(fileName);
        const source = file && readSource(fileName);
        if (file === undefined || source === undefined) {
            throw new Error(`File '${fileName}' of script module '${name}' is missing.`);
        }

        const record: { exports: unknown } = { exports: newModuleExports() };
        started.set(fileName, record);

        const run = compile(source, file, name);
        run.call(record.exports, record.exports, record, requireFrom(fileName), { url: file.url });

        return record.exports;
    }

    const allowBlocked = module.spec.target === "node";

    function requireFrom(fromFile: string) {
        return (specifier: string): unknown => {
            const sibling = siblingName(specifier);
            if (sibling === undefined) {
                return requireHostModule(specifier, { allowBlocked });
            }
            if (!held.has(sibling)) {
                throw new Error(
                    `'${fromFile}' of script module '${name}' imports '${specifier}', ` +
                    `which the install does not hold.`
                );
            }
            return loadFile(sibling);
        };
    }

    const exports = loadFile(module.entry);
    getLog().info(`Loaded script module '${name}' (${started.size}/${module.files.length} files).`);
    return exports;
}

/**
 * Turns one stored ES module into a runnable CommonJS body.
 *
 * `import.meta` is the one part of a module that survives the conversion, and a function body is
 * not a module, so it is rewritten to a parameter carrying the URL the file was built from. The
 * rewrite is textual, so text that merely reads as `import.meta` is rewritten too — it then names
 * a parameter holding what the real one would have.
 */
/**
 * Turns one stored ES module into a runnable CommonJS body, as source.
 *
 * Split from {@link compile} for the frontend, which is handed the text rather than a function: the
 * page that evaluates it is not the runtime that reads the database.
 */
export function compileModuleSource(source: string, fileName: string, moduleName: string): string {
    let code: string;
    try {
        code = transform(source, {
            transforms: ["imports"],
            // Rewrite the module syntax and nothing else. Lowering class fields as well produces
            // invalid output where a field initializer meets `super()` inside a comma expression,
            // which esm.sh's Node polyfills do — its `buffer` shim compiles to `;,new Error(…)`.
            disableESTransforms: true,
            filePath: fileName
        }).code;
    } catch (e) {
        throw new Error(
            `File '${fileName}' of script module '${moduleName}' could not be compiled.`,
            { cause: e }
        );
    }

    return code.replace(/\bimport\.meta\b/g, IMPORT_META);
}

function compile(source: string, file: ScriptModuleFileInfo, moduleName: string) {
    const code = compileModuleSource(source, file.name, moduleName);

    try {
        return new Function("exports", "module", "require", IMPORT_META, code);
    } catch (e) {
        throw new Error(
            `File '${file.name}' of script module '${moduleName}' is not valid JavaScript.`,
            { cause: e }
        );
    }
}

const IMPORT_META = SCRIPT_MODULE_IMPORT_META;

/**
 * A fresh exports object that a file can still assign `__esModule` on.
 *
 * The compiled prologue defines that property with a value alone, which leaves it read-only, and a
 * bundle carrying CommonJS that assigns it itself then throws in strict mode — cheerio's jsDelivr
 * build does. Seeding it writable survives the prologue, since redefining a property with a partial
 * descriptor changes only the fields that descriptor names.
 */
function newModuleExports(): object {
    return Object.defineProperty({}, "__esModule", {
        value: false,
        writable: true,
        enumerable: false,
        configurable: true
    });
}

/**
 * The file a specifier names, or `undefined` where it names something outside the package.
 *
 * An install rewrites every import between its own files to `./name`, so a relative specifier is
 * always one of them — and one that resolves to no held file is a broken install rather than a
 * package to go looking for on the host.
 */
function siblingName(specifier: string): string | undefined {
    if (specifier.startsWith("./")) {
        return specifier.slice(2);
    }
    return specifier.startsWith("../") || specifier.startsWith("/") ? specifier : undefined;
}
