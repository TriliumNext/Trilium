/**
 * The grammar of the `#sorted` label: comma-separated sort keys, each optionally followed by
 * `asc` or `desc`, the way a search's `orderBy` is written — `#priority desc, #dueDate, title`. A
 * key is a label on the child notes written with `#`, or a bare property: `title`, `dateCreated`,
 * `dateModified` or `folders`, which a note with children has. A key followed by `first` or `last`
 * instead groups the children that have it before or after the rest — `#archived last, title`.
 *
 * A value that is a single bare key keeps its original meaning: a property when it is `title`,
 * `dateCreated` or `dateModified`, otherwise a label, so `#sorted=myOrder` sorts by `#myOrder` and
 * `#sorted=folders` by `#folders`.
 */

const SINGLE_KEY_PROPERTIES = ["title", "dateCreated", "dateModified"];

export interface SortCriterion {
    /** A label name where {@link isLabel} is set, a property name otherwise. */
    key: string;
    isLabel: boolean;
    /** Set by an explicit `asc`/`desc` after the key; absent follows `#sortDirection`. */
    descending?: boolean;
    /** Set by `first`/`last` after the key: groups by whether a child has the key at all. */
    group?: "first" | "last";
}

/** Parses a `#sorted` value into its levels; an empty value sorts by title. */
export function parseSortCriteria(value: string | null | undefined): SortCriterion[] {
    const trimmed = (value ?? "").trim();
    if (/^[^\s,#]+$/.test(trimmed)) {
        return [{ key: trimmed, isLabel: !SINGLE_KEY_PROPERTIES.includes(trimmed) }];
    }

    const criteria: SortCriterion[] = [];
    for (const level of trimmed.split(",")) {
        const words = level.trim().split(/\s+/);
        const last = words[words.length - 1].toLowerCase();
        const hasSuffix = words.length > 1
            && ["asc", "desc", "first", "last"].includes(last);
        const name = (hasSuffix ? words.slice(0, -1) : words).join(" ");
        const isLabel = name.startsWith("#");
        const key = isLabel ? name.slice(1) : name;
        if (!key) {
            continue;
        }

        const criterion: SortCriterion = { key, isLabel };
        if (hasSuffix && (last === "first" || last === "last")) {
            criterion.group = last;
        } else if (hasSuffix) {
            criterion.descending = last === "desc";
        }
        criteria.push(criterion);
    }
    return criteria.length > 0 ? criteria : [{ key: "title", isLabel: false }];
}

/** Writes levels back into the `#sorted` grammar, each label with its `#`. */
export function serializeSortCriteria(criteria: SortCriterion[]) {
    return criteria
        .map(({ key, isLabel, descending, group }) => {
            const name = isLabel ? `#${key}` : key;
            if (group) {
                return `${name} ${group}`;
            }
            if (descending === undefined) {
                return name;
            }
            return `${name} ${descending ? "desc" : "asc"}`;
        })
        .join(", ");
}
