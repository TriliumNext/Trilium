import type { HostedCompletionInsert } from "@triliumnext/codemirror/src/extensions/hosted_completion";
import type { TemplateValueType, TemplateVariableTypes } from "@triliumnext/commons";

import { t } from "../../services/i18n";
import type { CommandEntry } from "../react/NoteAutocomplete";

/**
 * Completions for the templates `evaluateTemplate()` fills in: the variables right after `${`, and
 * the members of what the path before a `.` resolves to. Only members the template engine allows,
 * and that give a readable value on the server's `BNote`, are offered.
 */

export interface TemplateMember {
    name: string;
    kind: "property" | "method";
    type: TemplateValueType;
    /** Translation key of what the member gives. */
    descriptionKey: string;
}

export const NOTE_TEMPLATE_MEMBERS: readonly TemplateMember[] = [
    { name: "title", kind: "property", type: "text", descriptionKey: "template_field.member_title" },
    { name: "noteId", kind: "property", type: "text", descriptionKey: "template_field.member_note_id" },
    { name: "type", kind: "property", type: "text", descriptionKey: "template_field.member_type" },
    { name: "mime", kind: "property", type: "text", descriptionKey: "template_field.member_mime" },
    { name: "dateCreatedObj", kind: "property", type: "date", descriptionKey: "template_field.member_date_created_obj" },
    { name: "utcDateCreatedObj", kind: "property", type: "date", descriptionKey: "template_field.member_utc_date_created_obj" },
    { name: "dateCreated", kind: "property", type: "text", descriptionKey: "template_field.member_date_created" },
    { name: "dateModified", kind: "property", type: "text", descriptionKey: "template_field.member_date_modified" },
    { name: "utcDateCreated", kind: "property", type: "text", descriptionKey: "template_field.member_utc_date_created" },
    { name: "utcDateModified", kind: "property", type: "text", descriptionKey: "template_field.member_utc_date_modified" },
    { name: "isProtected", kind: "property", type: "text", descriptionKey: "template_field.member_is_protected" },
    { name: "getLabelValue", kind: "method", type: "text", descriptionKey: "template_field.member_get_label_value" },
    { name: "getRelationValue", kind: "method", type: "text", descriptionKey: "template_field.member_get_relation_value" }
];

const DATE_TEMPLATE_MEMBERS: readonly TemplateMember[] = [
    { name: "format", kind: "method", type: "text", descriptionKey: "template_field.member_format" }
];

const MEMBERS: Readonly<Record<TemplateValueType, readonly TemplateMember[]>> = {
    note: NOTE_TEMPLATE_MEMBERS,
    date: DATE_TEMPLATE_MEMBERS,
    text: []
};

/** An entry of the list, and what a pick puts in place of what was typed. */
export interface TemplateEntry extends CommandEntry {
    insert: HostedCompletionInsert;
}

export interface TemplateCompletion {
    /** Where the typed name starts, which a pick replaces. */
    from: number;
    query: string;
    /** Identifies the entries offered at this place, so the list keeps them while it stays open. */
    key: string;
    entries(): TemplateEntry[];
}

// The expression typed so far, from the last `${` that is not closed before the caret.
const OPEN_EXPRESSION = /\$\{([^{}]*)$/;
const VARIABLE_START = /^\s*([a-zA-Z_]\w*)?$/;
const MEMBER_START = /^\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\.([a-zA-Z_]\w*)?$/;

/**
 * Finds what can be completed at the end of `before`, the text up to the caret, given the variables
 * the template can read. Returns `null` outside an expression and after a path that holds nothing
 * with members, such as a title.
 */
export function templateCompletionAt(before: string, variables: TemplateVariableTypes): TemplateCompletion | null {
    const open = OPEN_EXPRESSION.exec(before);
    if (!open) {
        return null;
    }
    const expression = open[1];

    const variable = VARIABLE_START.exec(expression);
    if (variable) {
        const query = variable[1] ?? "";
        return {
            from: before.length - query.length,
            query,
            key: "variables",
            entries: () => Object.keys(variables).map((name) => ({
                id: name,
                title: name,
                icon: "bx bx-note",
                description: t(`template_field.variable_${name}`),
                insert: name
            }))
        };
    }

    const member = MEMBER_START.exec(expression);
    if (!member) {
        return null;
    }

    const type = resolvePathType(member[1].split("."), variables);
    const members = type ? MEMBERS[type] : [];
    if (members.length === 0) {
        return null;
    }

    const query = member[2] ?? "";
    return {
        from: before.length - query.length,
        query,
        key: `members:${member[1]}`,
        entries: () => members.map(toEntry)
    };
}

function resolvePathType([ root, ...properties ]: string[], variables: TemplateVariableTypes): TemplateValueType | undefined {
    let type: TemplateValueType | undefined = Object.hasOwn(variables, root) ? variables[root] : undefined;
    for (const property of properties) {
        type = type && MEMBERS[type].find((m) => m.kind === "property" && m.name === property)?.type;
    }
    return type;
}

function toEntry(member: TemplateMember): TemplateEntry {
    const description = t(member.descriptionKey);

    if (member.kind === "method") {
        return {
            id: member.name,
            title: `${member.name}('…')`,
            icon: "bx bx-code-curly",
            description,
            // The argument is the one thing left to type, so the caret goes between the quotes.
            insert: (view, from, to) => {
                const text = `${member.name}('')`;
                view.dispatch({
                    changes: { from, to, insert: text },
                    selection: { anchor: from + text.length - 2 }
                });
            }
        };
    }

    return {
        id: member.name,
        title: member.name,
        icon: member.type === "date" ? "bx bx-calendar" : "bx bx-purchase-tag",
        description,
        // A value with members of its own takes the dot, which opens the list on them.
        insert: MEMBERS[member.type].length > 0 ? `${member.name}.` : member.name
    };
}
