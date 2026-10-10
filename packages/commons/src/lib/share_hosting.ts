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

/**
 * Returns the key of a note map request, the same for the same root, kind and relation filters in
 * any order, under which the static export indexes the map it computed for that request.
 */
export function getNoteMapDataKey(
    mapRootNoteId: string,
    mapType: "tree" | "link",
    filters: { excludeRelations: string[]; includeRelations: string[] }
) {
    const params = new URLSearchParams([
        ...[ ...filters.excludeRelations ].sort().map((name) => [ "exclude", name ]),
        ...[ ...filters.includeRelations ].sort().map((name) => [ "include", name ])
    ]);
    return `${mapRootNoteId}/${mapType}?${params}`;
}

/** Returns the files of `manifest`'s groups `names` and of the groups they require, each once. */
export function getShareThemeGroupFiles(manifest: ShareThemeManifest, names: Iterable<string>) {
    const groups = resolveShareThemeGroups(manifest.requires, names);
    return [ ...new Set(groups.flatMap((name) => manifest.lazy[name] ?? [])) ];
}
