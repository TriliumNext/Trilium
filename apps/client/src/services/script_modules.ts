import {
    type CompiledModuleFile,
    type FrontendScriptModule,
    SCRIPT_MODULE_IMPORT_META,
    type UnavailableScriptModule
} from "@triliumnext/commons";

/** Packages already evaluated in this page, kept against the files they were evaluated from. */
const evaluated = new Map<string, { fingerprint: string; exports: unknown }>();

/**
 * Resolves the packages a frontend bundle requires.
 *
 * The bundle arrives with them compiled, so nothing here reads the database or parses JavaScript —
 * a package is evaluated the first time a script asks for it and kept for the life of the page.
 * Answers `undefined` for a name it does not know, leaving the caller to look elsewhere.
 */
export function createScriptModuleRequire(
    modules: FrontendScriptModule[] = [],
    unavailable: UnavailableScriptModule[] = []
): (moduleName: string) => { exports: unknown } | undefined {
    const bySpecifier = new Map<string, FrontendScriptModule>();
    for (const module of modules) {
        for (const specifier of module.specifiers) {
            bySpecifier.set(specifier, module);
        }
    }

    const reasons = new Map(unavailable.map((entry) => [ entry.specifier, entry.reason ]));

    return (moduleName: string) => {
        const reason = reasons.get(moduleName);
        if (reason) {
            throw new Error(reason);
        }

        const module = bySpecifier.get(moduleName);
        return module ? { exports: load(module) } : undefined;
    };
}

/** Drops every evaluated package, so the next require evaluates what the bundle now carries. */
export function clearScriptModuleCache() {
    evaluated.clear();
}

/**
 * The exports of a package, evaluating it where what was sent has changed since last time.
 *
 * Keyed on the content of the files rather than on when they arrived, so a re-install that rebuilds
 * a package to the same bytes reuses what is already evaluated.
 */
function load(module: FrontendScriptModule): unknown {
    const cached = evaluated.get(module.noteId);
    if (cached && cached.fingerprint === module.fingerprint) {
        return cached.exports;
    }

    const exports = evaluate(module);
    evaluated.set(module.noteId, { fingerprint: module.fingerprint, exports });
    return exports;
}

/**
 * Evaluates a package, a file at a time, starting from its entry.
 *
 * The files are CommonJS by the time they arrive, so a cycle between them resolves the way Node
 * resolves one: a file that is still running answers with what it has exported so far.
 */
function evaluate(module: FrontendScriptModule): unknown {
    const held = new Map(module.files.map((file) => [ file.name, file ]));
    const started = new Map<string, { exports: unknown }>();

    function loadFile(fileName: string): unknown {
        const running = started.get(fileName);
        if (running) {
            return running.exports;
        }

        const file = held.get(fileName);
        if (!file) {
            throw new Error(`File '${fileName}' of a script module is missing.`);
        }

        const record: { exports: unknown } = { exports: newModuleExports() };
        started.set(fileName, record);

        const run = compile(file);
        run.call(record.exports, record.exports, record, requireSibling, { url: file.url });

        return record.exports;
    }

    function requireSibling(specifier: string): unknown {
        const sibling = specifier.startsWith("./") ? specifier.slice(2) : undefined;
        if (sibling === undefined || !held.has(sibling)) {
            throw new Error(
                `A script module imports '${specifier}', which the browser cannot provide.`
            );
        }

        return loadFile(sibling);
    }

    return loadFile(module.entry);
}

function compile(file: CompiledModuleFile) {
    try {
        return new Function("exports", "module", "require", SCRIPT_MODULE_IMPORT_META, file.code);
    } catch (e) {
        throw new Error(
            `File '${file.name}' of a script module is not valid JavaScript.`, { cause: e });
    }
}

/**
 * A fresh exports object that a file can still assign `__esModule` on.
 *
 * The compiled prologue defines that property with a value alone, which leaves it read-only, and a
 * bundle carrying CommonJS that assigns it itself then throws in strict mode.
 */
function newModuleExports(): object {
    return Object.defineProperty({}, "__esModule", {
        value: false,
        writable: true,
        enumerable: false,
        configurable: true
    });
}
