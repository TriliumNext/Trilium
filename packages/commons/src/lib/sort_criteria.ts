/**
 * The grammar of the `#sorted` label: comma-separated sort keys, each optionally followed by `asc`
 * or `desc`, the way a search's `orderBy` is written — `priority desc, dueDate, title`. A key is
 * `title`, `dateCreated`, `dateModified` or the name of a label on the child notes.
 */

export interface SortCriterion {
    key: string;
    /** Set by an explicit `asc`/`desc` after the key; `undefined` follows `#sortDirection`. */
    descending?: boolean;
}

/** Parses a `#sorted` value into its levels; an empty value sorts by title. */
export function parseSortCriteria(value: string | null | undefined): SortCriterion[] {
    const criteria: SortCriterion[] = [];
    for (const level of (value ?? "").split(",")) {
        const words = level.trim().split(/\s+/);
        const last = words[words.length - 1].toLowerCase();
        const isDirection = words.length > 1 && (last === "asc" || last === "desc");
        const key = (isDirection ? words.slice(0, -1) : words).join(" ");
        if (key) {
            criteria.push({ key, descending: isDirection ? last === "desc" : undefined });
        }
    }
    return criteria.length > 0 ? criteria : [{ key: "title" }];
}

/** Writes levels back into the `#sorted` grammar; only a level without a direction is bare. */
export function serializeSortCriteria(criteria: SortCriterion[]) {
    return criteria
        .map(({ key, descending }) => {
            if (descending === undefined) {
                return key;
            }
            return `${key} ${descending ? "desc" : "asc"}`;
        })
        .join(", ");
}
