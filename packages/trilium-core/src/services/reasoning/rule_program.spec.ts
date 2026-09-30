import { describe, expect, it } from "vitest";

import { dropBackEdges, inferFacts } from "./evaluate.js";
import { assembleRules, compileRuleNote, queryFor, resolveScope, type Scope } from "./rule_program.js";

const anchored: Scope = { mode: "anchored", anchorNoteId: "project" };

describe("reasoning rules", () => {
    it("keeps a rule that is about ?this and rejects one that quantifies over every note", () => {
        const scoped = compileRuleNote(
            `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
            anchored,
            new Map(),
            new Map()
        );
        expect(scoped.diagnostics).toEqual([]);
        expect(scoped.clauses[0]?.edn).toContain('"project"');
        expect(scoped.clauses[0]?.edn).toContain("(ground \"high\")");

        const global = compileRuleNote(
            `#mark(?x, "yes") :- #status(?x, "todo").`,
            anchored,
            new Map(),
            new Map()
        );
        expect(global.clauses).toEqual([]);
        expect(global.diagnostics[0]?.code).toBe("unscoped");
        expect(global.diagnostics[0]?.name).toBe("x");
    });

    it("binds ?this to each instance of a template and allows a global rule only on a schema note", () => {
        const onTemplate = resolveScope({
            ruleNoteId: "rules",
            parentId: "projekt",
            parentIsTemplate: true,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: false,
            wantsGlobal: false
        });
        expect(onTemplate.ok).toBe(true);
        if (onTemplate.ok) {
            expect(onTemplate.scope).toEqual({ mode: "template", templateNoteId: "projekt" });
        }

        const compiled = compileRuleNote(
            `#blocked(?this) :- descendant(?this, ?task), #status(?task, "blocked").`,
            { mode: "template", templateNoteId: "projekt" },
            new Map(),
            new Map()
        );
        expect(compiled.diagnostics).toEqual([]);
        expect(compiled.clauses[0]?.edn).toContain('"projekt"');
        expect(compiled.clauses[0]?.edn).toContain("relation/template");

        const refused = resolveScope({
            ruleNoteId: "rules",
            parentId: "johannes",
            parentIsTemplate: false,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: false,
            wantsGlobal: true
        });
        expect(refused.ok).toBe(false);

        const allowed = resolveScope({
            ruleNoteId: "priesthood",
            parentId: null,
            parentIsTemplate: false,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: true,
            wantsGlobal: true
        });
        expect(allowed.ok).toBe(true);
        if (allowed.ok) {
            expect(allowed.scope.mode).toBe("global");
        }

        const open = compileRuleNote(
            `#vollmacht(?x, "Ja") :- #rolle(?x, "Priester").`,
            { mode: "global" },
            new Map(),
            new Map()
        );
        expect(open.diagnostics).toEqual([]);
        expect(open.clauses).toHaveLength(1);
    });

    it("follows a citation out of the subtree and refuses an unknown note title", () => {
        const listed = compileRuleNote(
            `~listed(?citing, ?this) :- ~cites(?citing, ?this).`,
            { mode: "anchored", anchorNoteId: "book" },
            new Map(),
            new Map()
        );
        expect(listed.diagnostics).toEqual([]);
        expect(listed.clauses[0]?.form).toBe("relation");

        const missing = compileRuleNote(
            `~listed(?citing, @"Reading list") :- ~cites(?citing, ?this).`,
            { mode: "anchored", anchorNoteId: "book" },
            new Map(),
            new Map()
        );
        expect(missing.diagnostics[0]?.code).toBe("unknown_note");
    });
});

describe("reasoning evaluation", () => {
    it("drops a child link that would cycle and still infers a scoped label", async () => {
        const children = dropBackEdges(new Map([
            ["a", ["b"]],
            ["b", ["c"]],
            ["c", ["a"]]
        ]));
        expect(children.get("c")).toEqual([]);
        expect(children.get("a")).toEqual(["b"]);

        const compiled = compileRuleNote(
            `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
            anchored,
            new Map(),
            new Map()
        );
        const clause = compiled.clauses[0];
        expect(clause).toBeTruthy();
        if (!clause) {
            return;
        }

        const { facts, failures } = await inferFacts(
            [
                { noteId: "project", title: "Project", type: "book", labels: [], relations: [], childIds: ["task", "later"] },
                { noteId: "task", title: "Write", type: "text", labels: [{ name: "status", value: "todo" }], relations: [], childIds: [] },
                { noteId: "later", title: "Later", type: "text", labels: [{ name: "status", value: "done" }], relations: [], childIds: [] },
                { noteId: "other", title: "Other", type: "text", labels: [{ name: "status", value: "todo" }], relations: [], childIds: [] }
            ],
            assembleRules([clause.edn]),
            [{
                form: "label",
                name: "priority",
                arity: 2,
                symbol: clause.symbol,
                ruleNoteIds: ["rules"],
                query: queryFor("label", 2, clause.symbol)
            }]
        );

        expect(failures).toEqual([]);
        expect(facts).toEqual([
            { noteId: "task", type: "label", name: "priority", value: "high", ruleNoteIds: ["rules"] }
        ]);
    });
});
