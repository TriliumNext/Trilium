import { type Diagnostic, linter } from "@codemirror/lint";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { findTemplateIssues, type TemplateVariableTypes } from "@triliumnext/commons";

/**
 * Highlighting and linting for the templates `evaluateTemplate()` in `@triliumnext/commons` fills
 * in, such as the title a bulk rename gives each note: literal text with `${...}` expressions that
 * read a variable's properties and call a whitelisted method with one string argument.
 */

export type TemplateTokenKind = "delimiter" | "variable" | "property" | "method" | "punctuation" | "string";

export interface TemplateToken {
    from: number;
    to: number;
    kind: TemplateTokenKind;
}

const IDENTIFIER = /[a-zA-Z_]\w*/y;
const MEMBER = /\.(?:[a-zA-Z_]\w*)?/y;
const CALL = /\s*\(/y;
const STRING = /(['"])(?:(?!\1)[^])*(?:\1|$)/y;
const SPACE = /\s+/y;

/**
 * Splits a template into the parts of its expressions worth colouring. An expression whose `}` is
 * not typed yet runs to the end of the text, so it colours while it is being written.
 */
export function tokenizeTemplate(text: string): TemplateToken[] {
    const tokens: TemplateToken[] = [];
    let pos = 0;

    const match = (pattern: RegExp) => {
        pattern.lastIndex = pos;
        return pattern.exec(text);
    };
    const take = (kind: TemplateTokenKind, to: number) => {
        tokens.push({ from: pos, to, kind });
        pos = to;
    };

    while (pos < text.length) {
        const start = text.indexOf("${", pos);
        if (start < 0) {
            break;
        }
        pos = start;
        take("delimiter", start + 2);

        let expectsVariable = true;
        while (pos < text.length && text[pos] !== "}") {
            if (match(SPACE)) {
                pos = SPACE.lastIndex;
            } else if (expectsVariable && match(IDENTIFIER)) {
                take("variable", IDENTIFIER.lastIndex);
                expectsVariable = false;
            } else if (match(MEMBER)) {
                const end = MEMBER.lastIndex;
                CALL.lastIndex = end;
                take(CALL.test(text) ? "method" : "property", end);
            } else if (match(STRING)) {
                take("string", STRING.lastIndex);
            } else if (text[pos] === "(" || text[pos] === ")") {
                take("punctuation", pos + 1);
            } else {
                pos++;
            }
        }

        if (text[pos] === "}") {
            take("delimiter", pos + 1);
        }
    }

    return tokens;
}

/** The wording of the diagnostics, supplied by the consumer because this package holds no translations. */
export interface TemplateLintMessages {
    unclosed: string;
    unsupported: string;
    unknownVariable(name: string): string;
    propertyNotAllowed(name: string): string;
    methodNotAllowed(name: string): string;
    methodNotOnValue(name: string): string;
}

/** Marks the expressions `evaluateTemplate()` refuses, given the variables it is called with. */
export function diagnoseTemplate(text: string, variables: TemplateVariableTypes, messages: TemplateLintMessages): Diagnostic[] {
    return findTemplateIssues(text, variables).map((issue) => ({
        from: issue.from,
        to: issue.to,
        severity: "error",
        message: issue.name === undefined ? messages[issue.kind] : messages[issue.kind](issue.name)
    }));
}

const MARKS: Record<TemplateTokenKind, Decoration> = {
    delimiter: Decoration.mark({ class: "cm-template-delimiter" }),
    variable: Decoration.mark({ class: "cm-template-variable" }),
    property: Decoration.mark({ class: "cm-template-property" }),
    method: Decoration.mark({ class: "cm-template-method" }),
    punctuation: Decoration.mark({ class: "cm-template-punctuation" }),
    string: Decoration.mark({ class: "cm-template-string" })
};

/** Drawn with the search highlighter's palette, so the app's two small languages read alike. */
const templateHighlightTheme = EditorView.baseTheme({
    ".cm-template-delimiter": { color: "var(--search-operator-color, var(--muted-text-color))" },
    ".cm-template-variable": { color: "var(--search-relation-color, #8957e5)" },
    ".cm-template-property": { color: "var(--search-property-color, #268a8a)" },
    ".cm-template-method": { color: "var(--search-label-color, #539bf5)" },
    ".cm-template-punctuation": { color: "var(--search-bracket-color, var(--muted-text-color))" },
    ".cm-template-string": { color: "var(--search-string-color, #2ea043)" }
});

const templateHighlightField = StateField.define<DecorationSet>({
    create: (state) => buildTemplateDecorations(state),
    update: (decorations, tr) => (tr.docChanged ? buildTemplateDecorations(tr.state) : decorations),
    provide: (field) => EditorView.decorations.from(field)
});

function buildTemplateDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const token of tokenizeTemplate(state.doc.toString())) {
        builder.add(token.from, token.to, MARKS[token.kind]);
    }
    return builder.finish();
}

/**
 * The extension to register on an editor holding a template whose expressions can read
 * `variables`. It colours the expressions and underlines the ones the evaluator refuses.
 */
export function triliumTemplate(variables: TemplateVariableTypes, messages: TemplateLintMessages): Extension {
    return [
        templateHighlightField,
        templateHighlightTheme,
        linter((view) => diagnoseTemplate(view.state.doc.toString(), variables, messages), { delay: 250 })
    ];
}
