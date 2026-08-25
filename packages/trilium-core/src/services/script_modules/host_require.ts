/**
 * IMPORTANT: This blocklist is a defense-in-depth measure only. It is NOT a security sandbox.
 * Scripts execute via eval() in the main Node.js process and can reach `globalThis` and `process`
 * without asking this function for anything. The actual security boundary is the
 * [Security] backendScriptingEnabled=false config toggle, which stops backend scripts running at
 * all.
 *
 * Modules that stay blocked while scripting is enabled, because they hand a script the machine
 * rather than a library. Listed by their root, so `fs/promises` and `node:fs` are the same answer.
 */
const BLOCKED_MODULES = new Set([
    "child_process",
    "cluster",
    "dgram",
    "dns",
    "fs",
    // Each of these reaches the ones above: createRequire, an eval channel, and a REPL.
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "process",
    "repl",
    "tls",
    "worker_threads",
    "v8",
    "vm"
]);

/**
 * Requires a module from the host runtime.
 *
 * Shared by the script context and by the loader that evaluates installed packages, so a built-in
 * a script cannot ask for directly is one an installed package cannot reach on its behalf either.
 */
export function requireHostModule(moduleName: string): unknown {
    if (BLOCKED_MODULES.has(builtinRoot(moduleName))) {
        throw new Error(
            `Module '${moduleName}' is blocked for security. ` +
            `Scripts cannot access OS-level modules like child_process, fs, net, os.`
        );
    }

    if (typeof require !== "function") {
        throw new Error(
            `Module '${moduleName}' cannot be loaded: this build has no module loader.`
        );
    }

    try {
        return require(moduleName);
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        throw new Error(
            `Module '${moduleName}' could not be loaded. Install it from Script modules ` +
            `on a backend script note, or name a child note after it. (${reason})`,
            { cause: e }
        );
    }
}

/**
 * The built-in a specifier names, so that one answer covers the ways of asking for it: `node:fs`,
 * `fs/promises` and `fs` are the same module, and a list that only knew the last spelling was a
 * list a script stepped around by writing one of the others.
 */
function builtinRoot(moduleName: string): string {
    const withoutScheme = moduleName.startsWith("node:")
        ? moduleName.slice("node:".length)
        : moduleName;
    const slash = withoutScheme.indexOf("/");
    return slash >= 0 ? withoutScheme.slice(0, slash) : withoutScheme;
}
