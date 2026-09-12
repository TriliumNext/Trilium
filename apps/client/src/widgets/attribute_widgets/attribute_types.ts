import type { PromotedAttribute } from "../collections/promoted_attributes";

/** The kind a definition takes when it points at a note instead of holding a value. */
export const RELATION_DEFINITION_TYPE = "relation";

/**
 * The icon each kind of definition is drawn with, wherever one is listed by its kind: the editor's
 * own type list, a sort menu, a menu that sets values.
 *
 * Data alone, so that a menu naming an icon does not pull in the attribute editor and the widget
 * stack behind it.
 */
export const DEFINITION_TYPE_ICONS: Record<string, string> = {
    text: "bx bx-text",
    textarea: "bx bx-align-left",
    number: "bx bx-hash",
    boolean: "bx bx-toggle-left",
    select: "bx bx-list-ul",
    date: "bx bx-calendar",
    datetime: "bx bx-calendar-event",
    time: "bx bx-time",
    url: "bx bx-link",
    email: "bx bx-envelope",
    phone: "bx bx-phone",
    color: "bx bx-palette",
    [RELATION_DEFINITION_TYPE]: "bx bx-transfer"
};

/** The icon for an attribute's kind: its `labelType`, or the relation icon for a relation. */
export function promotedAttributeIcon(attribute: PromotedAttribute) {
    const kind = attribute.type === "relation"
        ? RELATION_DEFINITION_TYPE
        : attribute.labelType ?? "text";

    return DEFINITION_TYPE_ICONS[kind] ?? DEFINITION_TYPE_ICONS.text;
}
