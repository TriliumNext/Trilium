import type { ShareThemeManifest } from "./shared_types.js";

/**
 * The view types of the collections a shared page shows with the app's own view. The app build
 * checks that each has a `view:<viewType>` group in the share theme's manifest.
 */
export const SHARE_HOSTED_VIEW_TYPES: readonly string[] = [
    "board", "calendar", "dashboard", "geoMap", "presentation", "table"
];

/**
 * The note types a shared page shows with the app's own widget, or with a viewer of the share
 * theme. The app build checks that each has a `type:<noteType>` group in the share theme's
 * manifest.
 */
export const SHARE_HOSTED_NOTE_TYPES: readonly string[] = [
    "canvas", "image", "mermaid", "mindMap", "noteMap", "relationMap", "render", "spreadsheet"
];

/**
 * Returns `names` and every group they require in `requires`, directly or through the groups
 * they require, each once.
 */
export function resolveShareThemeGroups(
    requires: Record<string, string[]>,
    names: Iterable<string>
) {
    const resolved = new Set<string>();
    const pending = [ ...names ];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
        if (!resolved.has(name)) {
            resolved.add(name);
            pending.push(...requires[name] ?? []);
        }
    }
    return [ ...resolved ];
}

/** Returns the files of `manifest`'s groups `names` and of the groups they require, each once. */
export function getShareThemeGroupFiles(manifest: ShareThemeManifest, names: Iterable<string>) {
    const groups = resolveShareThemeGroups(manifest.requires, names);
    return [ ...new Set(groups.flatMap((name) => manifest.lazy[name] ?? [])) ];
}
