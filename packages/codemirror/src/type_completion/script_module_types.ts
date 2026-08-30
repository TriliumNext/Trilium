import type { ScriptModuleTypes } from "@triliumnext/commons";

/** Where TypeScript looks for a package, and so where an installed one has to be put. */
const NODE_MODULES = "/node_modules";

/**
 * Lays an installed package's declarations out where TypeScript resolves `require("…")` to them.
 *
 * A package becomes a folder holding its declaration files and a `package.json` naming the one it is
 * typed by, which is all `node10` resolution asks for. A subpath install (`dayjs/plugin/utc`) is a
 * folder at that path, which is where the same resolution looks for it.
 *
 * A package installed at a version can be named with that version, so it gets a second folder — one
 * holding nothing but a `package.json` pointing at the first, since the declarations are the same
 * ones and storing them twice would only make the editor read them twice.
 */
export function scriptModuleVfsFiles(modules: ScriptModuleTypes[]): Record<string, string> {
    const files: Record<string, string> = {};

    for (const module of modules) {
        const directory = `${NODE_MODULES}/${module.name}`;
        files[`${directory}/package.json`] = packageJson(module.name, module.entry);
        for (const file of module.files) {
            files[`${directory}/${file.name}`] = file.content;
        }

        if (module.spec !== module.name) {
            files[`${NODE_MODULES}/${module.spec}/package.json`] =
                packageJson(module.spec, aliasedEntry(module));
        }
    }

    return files;
}

function packageJson(name: string, types: string): string {
    return JSON.stringify({ name, types }, null, 4);
}

/**
 * Path from the versioned folder back to the declarations, which is as many steps up as that folder
 * is deep — a subpath install puts it several below `node_modules` rather than one.
 */
function aliasedEntry(module: ScriptModuleTypes): string {
    const depth = module.spec.split("/").length;
    return `${"../".repeat(depth)}${module.name}/${module.entry}`;
}
