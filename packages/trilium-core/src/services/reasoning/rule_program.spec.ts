import { describe, expect, it } from "vitest";

import { inferFacts } from "./evaluate.js";
import {
    assembleRules,
    compileRuleNote,
    type IdbPredicate,
    predicateKey,
    queryFor,
    resolveScope,
    type Scope
} from "./rule_program.js";

const anchored: Scope = { mode: "anchored", anchorNoteId: "project" };

describe("reasoning rules", () => {
    it("keeps a rule about ?this and lets a free variable match the workspace", () => {
        const scoped = compileRuleNote(
            `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
            anchored,
            new Map(),
            new Map()
        );
        expect(scoped.diagnostics).toEqual([]);
        expect(scoped.clauses[0]?.edn).toContain('"project"');
        expect(scoped.clauses[0]?.edn).toContain("(ground \"high\")");

        const workspace = compileRuleNote(
            `#mark(?x, "yes") :- #status(?x, "todo").`,
            { mode: "workspace", workspaceNoteId: "work", anchorNoteId: "work" },
            new Map(),
            new Map()
        );
        expect(workspace.diagnostics).toEqual([]);
        expect(workspace.clauses[0]?.edn).toContain("builtin_descendant");
        expect(workspace.clauses[0]?.edn).toContain('"work"');

        const linked = compileRuleNote(
            `#priority(?task, "high") :- child(?this, ?task), #status(?task, "todo").`,
            { mode: "workspace", workspaceNoteId: "work", anchorNoteId: "work" },
            new Map(),
            new Map()
        );
        expect(linked.clauses[0]?.edn).not.toContain("builtin_descendant");

        const citing = compileRuleNote(
            `~listed(?citing, ?this) :- ~cites(?citing, ?this).`,
            { mode: "workspace", workspaceNoteId: "work", anchorNoteId: "book" },
            new Map(),
            new Map()
        );
        expect(citing.diagnostics).toEqual([]);
        expect(citing.clauses[0]?.edn).not.toContain("builtin_descendant");
    });

    it("binds ?this to each instance of a template and lets #reasoningScope=global leave a workspace", () => {
        const onTemplate = resolveScope({
            ruleNoteId: "rules",
            parentId: "projekt",
            parentIsTemplate: true,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: false,
            wantsGlobal: false,
            workspaceId: null
        });
        expect(onTemplate.ok).toBe(true);
        if (onTemplate.ok) {
            expect(onTemplate.scope.mode).toBe("template");
            expect(onTemplate.scope.templateNoteId).toBe("projekt");
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

        const openScope = resolveScope({
            ruleNoteId: "rules",
            parentId: "johannes",
            parentIsTemplate: false,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: false,
            wantsGlobal: true,
            workspaceId: "parish"
        });
        expect(openScope.ok).toBe(true);
        if (openScope.ok) {
            expect(openScope.scope.mode).toBe("global");
            expect(openScope.scope.workspaceNoteId).toBeUndefined();
        }

        const inWorkspace = resolveScope({
            ruleNoteId: "rules",
            parentId: "parish",
            parentIsTemplate: false,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: false,
            wantsGlobal: false,
            workspaceId: "parish"
        });
        expect(inWorkspace.ok).toBe(true);
        if (inWorkspace.ok) {
            expect(inWorkspace.scope.mode).toBe("workspace");
            expect(inWorkspace.scope.workspaceNoteId).toBe("parish");
        }

        const allowed = resolveScope({
            ruleNoteId: "priesthood",
            parentId: null,
            parentIsTemplate: false,
            parentIsSchema: false,
            selfIsTemplate: false,
            selfIsSchema: true,
            wantsGlobal: true,
            workspaceId: null
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
    it("reaches every note around a clone cycle and still infers a scoped label", async () => {
        const around = compileRuleNote(
            [
                `#seen(?note, "yes") :- descendant(?this, ?note).`,
                `#back(?note, "yes") :- child(?this, ?note).`
            ].join("\n"),
            { mode: "anchored", anchorNoteId: "c" },
            new Map(),
            new Map()
        );
        expect(around.diagnostics).toEqual([]);
        const seen = around.clauses.find((clause) => clause.name === "seen");
        const back = around.clauses.find((clause) => clause.name === "back");
        expect(seen).toBeTruthy();
        expect(back).toBeTruthy();
        if (!seen || !back) {
            return;
        }
        const cycle = await inferFacts(
            [
                { noteId: "a", title: "A", type: "text", labels: [], relations: [], childIds: ["b"] },
                { noteId: "b", title: "B", type: "text", labels: [], relations: [], childIds: ["c"] },
                { noteId: "c", title: "C", type: "text", labels: [], relations: [], childIds: ["a"] }
            ],
            assembleRules([seen.edn, back.edn]),
            [
                queryOf(seen),
                queryOf(back)
            ]
        );
        expect(cycle.failures).toEqual([]);
        const seenIds = cycle.facts.filter((fact) => fact.name === "seen").map((fact) => fact.noteId);
        const backIds = cycle.facts.filter((fact) => fact.name === "back").map((fact) => fact.noteId);
        seenIds.sort();
        expect(seenIds).toEqual(["a", "b"]);
        expect(backIds).toEqual(["a"]);

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

    it("lets another rule use a conclusion and does not let a rule feed itself", async () => {
        const compiled = compileWithIdb(
            [
                `#reach(?note, "yes") :- #status(?note, "todo").`,
                `#reach(?target, "yes") :- ~link(?source, ?target), #reach(?source, "yes").`,
                `#wave(?target, "yes") :- ~link(?source, ?target), #reach(?source, "yes").`
            ].join("\n"),
            { mode: "global" }
        );
        expect(compiled.diagnostics).toEqual([]);
        const reach = compiled.clauses.find((clause) => clause.name === "reach");
        const wave = compiled.clauses.find((clause) => clause.name === "wave");
        expect(reach).toBeTruthy();
        expect(wave).toBeTruthy();
        if (!reach || !wave) {
            return;
        }

        const { facts, failures } = await inferFacts(
            [
                {
                    noteId: "a",
                    title: "A",
                    type: "text",
                    labels: [{ name: "status", value: "todo" }],
                    relations: [{ name: "link", targetNoteId: "b" }],
                    childIds: []
                },
                {
                    noteId: "b",
                    title: "B",
                    type: "text",
                    labels: [],
                    relations: [
                        { name: "link", targetNoteId: "a" },
                        { name: "link", targetNoteId: "c" }
                    ],
                    childIds: []
                },
                { noteId: "c", title: "C", type: "text", labels: [], relations: [], childIds: [] }
            ],
            assembleRules(compiled.clauses.map((item) => item.edn)),
            [queryOf(reach), queryOf(wave)]
        );

        expect(failures).toEqual([]);
        const reached = facts.filter((fact) => fact.name === "reach").map((fact) => fact.noteId);
        const waved = facts.filter((fact) => fact.name === "wave").map((fact) => fact.noteId);
        waved.sort();
        expect(reached).toEqual(["a"]);
        expect(waved).toEqual(["b"]);
    });
});

function compileWithIdb(source: string, scope: Scope) {
    const first = compileRuleNote(source, scope, new Map(), new Map());
    const idb = new Map<string, IdbPredicate>();
    for (const clause of first.clauses) {
        const key = predicateKey(clause.form, clause.arity, clause.name);
        if (!idb.has(key)) {
            idb.set(key, {
                symbol: clause.symbol,
                arity: clause.arity,
                form: clause.form,
                name: clause.name
            });
        }
    }
    return compileRuleNote(source, scope, new Map(), idb);
}

function queryOf(clause: { form: "label" | "relation"; name: string; arity: 1 | 2; symbol: string }) {
    return {
        form: clause.form,
        name: clause.name,
        arity: clause.arity,
        symbol: clause.symbol,
        ruleNoteIds: ["rules"],
        query: queryFor(clause.form, clause.arity, clause.symbol)
    };
}
