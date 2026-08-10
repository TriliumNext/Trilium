/**
 * Validation of attribute *names* in general, whatever they mean. The vocabulary of names the system
 * itself defines, and the `LabelNames` / `RelationNames` types that go with it, live in
 * `builtin_attributes.ts` — they are derived from the runtime list there so the two cannot drift.
 */

/**
 * The characters an attribute name may consist of: letters, numbers, underscore and colon. Kept as a
 * single source of truth so that {@link filterAttributeName} and {@link isValidAttributeName} cannot
 * drift apart.
 *
 * Note that {@link sanitizeAttributeName} in `trilium-core` deliberately applies the *same* character
 * set with different semantics (it substitutes an underscore and renames the empty string, rather than
 * stripping), so it is not expressed in terms of these helpers.
 */
const ATTRIBUTE_NAME_CHARS = "\\p{L}\\p{N}_:";
const DISALLOWED_MATCHER = new RegExp(`[^${ATTRIBUTE_NAME_CHARS}]`, "gu");
const ATTR_NAME_MATCHER = new RegExp(`^[${ATTRIBUTE_NAME_CHARS}]+$`, "u");

/** Strips every character an attribute name may not contain, returning a usable (possibly empty) name. */
export function filterAttributeName(name: string) {
    return name.replace(DISALLOWED_MATCHER, "");
}

/** Whether the name is a valid attribute name, i.e. non-empty and free of disallowed characters. */
export function isValidAttributeName(name: string) {
    return ATTR_NAME_MATCHER.test(name);
}
