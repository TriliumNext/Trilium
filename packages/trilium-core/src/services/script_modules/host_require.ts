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

/** Whether this runtime has a module loader at all, which is what a Node build needs. */
export function canRequireHostModules(): boolean {
    return typeof require === "function";
}

export interface HostRequireOptions {
    /**
     * Whether the blocklist is waived.
     *
     * True only for a package installed as a Node build, which is the whole point of that build and
     * which someone asked for on purpose. It does not widen what a script can reach in any sense
     * that holds: a script can wrap such a package and re-export anything it can see. The boundary
     * stays the backendScriptingEnabled toggle.
     */
    allowBlocked?: boolean;
}

/**
 * Requires a module from the host runtime.
 *
 * Shared by the script context and by the loader that evaluates installed packages, so a built-in
 * a script cannot ask for directly is one a portable package cannot reach on its behalf either.
 */
export function requireHostModule(moduleName: string, options: HostRequireOptions = {}): unknown {
    if (!options.allowBlocked && BLOCKED_MODULES.has(builtinRoot(moduleName))) {
        throw new Error(
            `Module '${moduleName}' is blocked for security. ` +
            `Scripts cannot access OS-level modules like child_process, fs, net, os.`
        );
    }

    if (!canRequireHostModules()) {
        throw new Error(
            `Module '${moduleName}' cannot be loaded: this build has no module loader.`
        );
    }

    try {
        return require(moduleName);
    } catch (e) {
        throw new Error(
            `Module '${moduleName}' could not be loaded. Install it from Script modules ` +
            `on a script note, or name a child note after it.${describeRefusal(e)}`,
            { cause: e }
        );
    }
}

/**
 * What to add about why the host refused, or nothing where it has nothing to add.
 *
 * A module the host does not have is what the sentence above already covers, and Node answers that
 * with a require stack of Trilium's own modules — a page of internals about a name a script wrote,
 * which reads as though the failure were somewhere in Trilium. Anything else is the host saying
 * something the sentence does not, so its first line is kept and the stack still dropped.
 */
function describeRefusal(e: unknown): string {
    const code = (e as { code?: string } | null)?.code;
    if (!(e instanceof Error) || code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") {
        return "";
    }

    const [ firstLine ] = e.message.split(/\r?\n|\s*Require stack:/);
    return firstLine?.trim() ? ` (${firstLine.trim()})` : "";
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
