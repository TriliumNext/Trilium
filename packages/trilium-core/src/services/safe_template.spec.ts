import { describe, expect, it, vi } from "vitest";
import { getLog } from "./log.js";
import { evaluateTemplate, evaluateTemplateSafe } from "./safe_template.js";

/**
 * A stand-in for the note-like objects passed into template evaluation. Only the
 * whitelisted properties/methods are exercised; method calls record their args so
 * we can assert the single string literal is forwarded verbatim.
 */
function fakeNote(overrides: Record<string, unknown> = {}) {
    return {
        title: "My Note",
        type: "text",
        noteId: "abc123",
        getLabelValue: (name: string) => `label:${name}`,
        getRelationValue: (name: string) => `relation:${name}`,
        format: (fmt: string) => `formatted(${fmt})`,
        ...overrides
    };
}

describe("safe_template - evaluateTemplate", () => {
    it("returns literal text unchanged when there are no expressions", () => {
        expect(evaluateTemplate("just text", {})).toBe("just text");
    });

    it("resolves a bare variable reference", () => {
        expect(evaluateTemplate("${note}", { note: "value" })).toBe("value");
    });

    it("resolves a single-level property access", () => {
        expect(evaluateTemplate("${note.title}", { note: fakeNote() })).toBe(
            "My Note"
        );
    });

    it("resolves a multi-level property chain (both segments whitelisted)", () => {
        // `content` and `title` are both whitelisted, so a two-hop chain resolves.
        const note = fakeNote({ content: { title: "inner" } });
        expect(evaluateTemplate("${note.content.title}", { note })).toBe(
            "inner"
        );
    });

    it("interpolates multiple expressions mixed with literal text", () => {
        const note = fakeNote();
        expect(evaluateTemplate("[${note.type}] ${note.title}", { note })).toBe(
            "[text] My Note"
        );
    });

    it("calls a whitelisted method with a single-quoted string argument", () => {
        const note = fakeNote();
        expect(
            evaluateTemplate("${note.getLabelValue('authorName')}", { note })
        ).toBe("label:authorName");
    });

    it("calls a whitelisted method with a double-quoted string argument", () => {
        const note = fakeNote();
        expect(evaluateTemplate('${note.format("YYYY-MM-DD")}', { note })).toBe(
            "formatted(YYYY-MM-DD)"
        );
    });

    it("calls a whitelisted method through a property chain", () => {
        const note = fakeNote({
            dateCreatedObj: { format: (f: string) => `date(${f})` }
        });
        expect(
            evaluateTemplate("${note.dateCreatedObj.format('MM-DD')}", {
                note
            })
        ).toBe("date(MM-DD)");
    });

    it("calls a whitelisted no-arg method", () => {
        const note = fakeNote({ getLabelValue: () => "no-arg-value" });
        expect(evaluateTemplate("${note.getLabelValue()}", { note })).toBe(
            "no-arg-value"
        );
    });

    it("returns empty string when a no-arg method target along the chain is null", () => {
        // `dateCreatedObj` is whitelisted but null, so the chain resolves to null
        // and the no-arg method call short-circuits to null (rendered empty).
        const note = fakeNote({ dateCreatedObj: null });
        expect(evaluateTemplate("${note.dateCreatedObj.format()}", { note })).toBe(
            ""
        );
    });

    it("renders null/undefined results as an empty string", () => {
        expect(
            evaluateTemplate("[${note.title}]", {
                note: fakeNote({ title: null })
            })
        ).toBe("[]");
        expect(
            evaluateTemplate("[${note.title}]", {
                note: fakeNote({ title: undefined })
            })
        ).toBe("[]");
    });

    it("returns empty string when a method target along the chain is null", () => {
        // resolvePropertyChain yields null because the root variable itself is null.
        expect(
            evaluateTemplate("${note.getLabelValue('x')}", { note: null })
        ).toBe("");
    });

    it("returns null (rendered empty) when a property on a null intermediate is accessed", () => {
        expect(evaluateTemplate("[${note.title}]", { note: null })).toBe("[]");
    });

    it("treats an empty string argument as a valid method argument", () => {
        const note = fakeNote({ getLabelValue: (name: string) => `[${name}]` });
        expect(evaluateTemplate("${note.getLabelValue('')}", { note })).toBe(
            "[]"
        );
    });
});

describe("safe_template - rejected expressions", () => {
    it("throws for an unknown root variable", () => {
        expect(() => evaluateTemplate("${missing.title}", {})).toThrow(
            /Unknown variable 'missing'/
        );
    });

    it("throws for a non-whitelisted property", () => {
        const note = fakeNote({ constructor: "evil" });
        expect(() => evaluateTemplate("${note.constructor}", { note })).toThrow(
            /Property 'constructor' is not allowed/
        );
    });

    it("throws for a non-whitelisted method", () => {
        const note = fakeNote({ toString: () => "boom" });
        expect(() => evaluateTemplate("${note.toString()}", { note })).toThrow(
            /Method 'toString' is not allowed/
        );
    });

    it("throws for a non-whitelisted method with an argument", () => {
        const note = fakeNote({ eval: (s: string) => s });
        expect(() => evaluateTemplate("${note.eval('1+1')}", { note })).toThrow(
            /Method 'eval' is not allowed/
        );
    });

    it("throws when a whitelisted method name resolves to a non-function", () => {
        // `format` is whitelisted but here it is a plain string, not callable.
        const note = fakeNote({ format: "not a function" });
        expect(() => evaluateTemplate("${note.format('x')}", { note })).toThrow(
            /'format' is not a function/
        );
    });

    it("throws when a whitelisted no-arg method name resolves to a non-function", () => {
        const note = fakeNote({ getLabelValue: 42 });
        expect(() =>
            evaluateTemplate("${note.getLabelValue()}", { note })
        ).toThrow(/'getLabelValue' is not a function/);
    });

    it("throws for syntactically unsupported expressions", () => {
        expect(() => evaluateTemplate("${1 + 1}", {})).toThrow(
            /is not a supported expression/
        );
        expect(() =>
            evaluateTemplate("${note['title']}", { note: fakeNote() })
        ).toThrow(/is not a supported expression/);
        expect(() =>
            evaluateTemplate("${note.method(unquotedArg)}", {
                note: fakeNote()
            })
        ).toThrow(/is not a supported expression/);
    });
});

describe("safe_template - evaluateTemplateSafe", () => {
    it("returns the interpolated value on success", () => {
        const note = fakeNote();
        expect(
            evaluateTemplateSafe("${note.title}", { note }, "fallback", "test")
        ).toBe("My Note");
    });

    it("returns the fallback and logs when evaluation throws", () => {
        const errorSpy = vi
            .spyOn(getLog(), "error")
            .mockImplementation(() => {});
        try {
            const result = evaluateTemplateSafe(
                "${missing.title}",
                {},
                "the-fallback",
                "my context"
            );
            expect(result).toBe("the-fallback");
            expect(errorSpy).toHaveBeenCalledOnce();
            expect(errorSpy.mock.calls[0]?.[0]).toContain("my context");
        } finally {
            errorSpy.mockRestore();
        }
    });
});
