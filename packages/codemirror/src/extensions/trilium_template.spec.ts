import { diagnosticCount, forceLinting } from "@codemirror/lint";
import { EditorSelection } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { createFieldEditor } from "../field_editor.js";
import { diagnoseTemplate, type TemplateLintMessages, tokenizeTemplate, triliumTemplate } from "./trilium_template.js";

const MESSAGES: TemplateLintMessages = {
    unclosed: "unclosed",
    unsupported: "unsupported",
    unknownVariable: (name) => `variable:${name}`,
    propertyNotAllowed: (name) => `property:${name}`,
    methodNotAllowed: (name) => `method:${name}`,
    methodNotOnValue: (name) => `not-on-value:${name}`
};

function tokensOf(text: string) {
    return tokenizeTemplate(text).map(({ from, to, kind }) => `${kind}:${text.slice(from, to)}`);
}

describe("tokenizeTemplate", () => {
    it("colours the expressions and leaves the literal text alone", () => {
        expect(tokensOf("NEW: ${note.title}")).toStrictEqual([
            "delimiter:${", "variable:note", "property:.title", "delimiter:}"
        ]);
    });

    it("tells a method call and its string argument from a property", () => {
        expect(tokensOf("${note.dateCreatedObj.format('MM-DD')}")).toStrictEqual([
            "delimiter:${", "variable:note", "property:.dateCreatedObj", "method:.format",
            "punctuation:(", "string:'MM-DD'", "punctuation:)", "delimiter:}"
        ]);
    });

    it("colours an expression still being typed, up to the end of the text", () => {
        expect(tokensOf("A ${note.")).toStrictEqual([ "delimiter:${", "variable:note", "property:." ]);
    });

    it("skips whitespace and characters with no colour, and the text after the last expression", () => {
        expect(tokensOf("${ note.title } and ${1 + 2} tail")).toStrictEqual([
            "delimiter:${", "variable:note", "property:.title", "delimiter:}",
            "delimiter:${", "delimiter:}"
        ]);
    });
});

describe("triliumTemplate", () => {
    it("colours the expressions in the rendered editor and recolours them after an edit", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const view = createFieldEditor({
            parent,
            doc: "NEW: ${note.title}",
            extensions: [ triliumTemplate({ note: "note" }, MESSAGES) ]
        });

        try {
            expect(textOf(parent, ".cm-template-variable")).toStrictEqual([ "note" ]);
            expect(textOf(parent, ".cm-template-property")).toStrictEqual([ ".title" ]);

            view.dispatch({ changes: { from: 12, to: 18, insert: "getLabelValue('x')" } });
            expect(textOf(parent, ".cm-template-method")).toStrictEqual([ ".getLabelValue" ]);
            expect(textOf(parent, ".cm-template-string")).toStrictEqual([ "'x'" ]);

            view.dispatch({ selection: EditorSelection.cursor(0) });
            expect(textOf(parent, ".cm-template-method")).toStrictEqual([ ".getLabelValue" ]);
        } finally {
            view.destroy();
        }
    });

    it("underlines an expression the evaluator refuses", async () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const view = createFieldEditor({
            parent,
            doc: "NEW: ${other}",
            extensions: [ triliumTemplate({ note: "note" }, MESSAGES) ]
        });

        try {
            forceLinting(view);
            await vi.waitFor(() => expect(diagnosticCount(view.state)).toBe(1));
            expect(parent.querySelector(".cm-lintRange-error")?.textContent).toBe("${other}");
        } finally {
            view.destroy();
        }
    });
});

function textOf(parent: HTMLElement, selector: string) {
    return [ ...parent.querySelectorAll(selector) ].map((el) => el.textContent);
}

describe("diagnoseTemplate", () => {
    it("underlines each refused expression with the consumer's wording", () => {
        const diagnostics = diagnoseTemplate(
            "${note.title} ${note.constructor} ${other} ${note.title.format('Y')} ${note.title",
            { note: "note" },
            MESSAGES
        );

        expect(diagnostics.map((d) => d.message)).toStrictEqual([
            "property:constructor", "variable:other", "not-on-value:format", "unclosed"
        ]);
        expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
        expect([ diagnostics[0].from, diagnostics[0].to ]).toStrictEqual([ 14, 33 ]);
    });

    it("has nothing to say about a valid template", () => {
        expect(diagnoseTemplate("NEW: ${note.title}", { note: "note" }, MESSAGES)).toStrictEqual([]);
    });
});
