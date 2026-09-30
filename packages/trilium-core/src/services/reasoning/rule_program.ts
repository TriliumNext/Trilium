/**
 * Scoped Datalog for one note.
 *
 * `?this` is the parent of the rule note, or each instance when the rule note sits in a template.
 * A variable with no path back to `?this` matches the workspace the rule note is in. With no
 * workspace, or with `#reasoningScope=global`, it matches the whole database.
 */

export type AttributeForm = "label" | "relation";

export interface RuleDiagnostic {
    code:
        | "parse"
        | "unscoped"
        | "unsafe"
        | "global_not_schema"
        | "unknown_note"
        | "ambiguous_note"
        | "type"
        | "arity"
        | "reserved"
        | "builtin";
    line?: number;
    detail?: string;
    name?: string;
}

export interface Scope {
    mode: "anchored" | "template" | "workspace" | "global";
    anchorNoteId?: string;
    templateNoteId?: string;
    /** Free variables have to be this note or one of its descendants. */
    workspaceNoteId?: string;
}

export interface ScopeFacts {
    ruleNoteId: string;
    /** Nearest strong parent that is neither `root` nor a hidden note. */
    parentId: string | null;
    parentIsTemplate: boolean;
    parentIsSchema: boolean;
    selfIsTemplate: boolean;
    selfIsSchema: boolean;
    wantsGlobal: boolean;
    /** Nearest ancestor, including the rule note, that owns `#workspace`. */
    workspaceId: string | null;
}

/** Body predicates a clause reads. A change wakes the clause when it touches one of these. */
export interface ClauseInterest {
    labels: string[];
    relations: string[];
    child: boolean;
    parent: boolean;
    descendant: boolean;
    title: boolean;
    type: boolean;
}

export type ResolvedScope =
    | { ok: true; contextNoteId: string; scope: Scope }
    | { ok: false; diagnostic: RuleDiagnostic };

export interface CompiledClause {
    /** EDN rule clause, without the surrounding vector. */
    edn: string;
    form: AttributeForm;
    name: string;
    arity: 1 | 2;
    symbol: string;
    interest: ClauseInterest;
}

export interface CompileResult {
    diagnostics: RuleDiagnostic[];
    clauses: CompiledClause[];
}

interface Pattern {
    form: "label" | "relation" | "builtin";
    name: string;
    args: Term[];
    line: number;
}

type Term =
    | { kind: "var"; name: string }
    | { kind: "string"; value: string }
    | { kind: "number"; value: number }
    | { kind: "note"; title: string };

interface Clause {
    head: Pattern;
    body: BodyAtom[];
    line: number;
}

type BodyAtom =
    | { kind: "call"; pattern: Pattern }
    | { kind: "not"; pattern: Pattern }
    | { kind: "cmp"; op: "=" | "!=" | "<" | ">" | "<=" | ">="; left: Term; right: Term; line: number };

const BUILTINS = new Set(["title", "type", "child", "parent", "descendant"]);

const RESERVED_HEADS = new Set([
    "reasoningRule",
    "reasoningError",
    "reasoningScope",
    "reasoningSchema",
    "template",
    "inherit"
]);

type Sort = "note" | "scalar";

interface Tok {
    kind: string;
    value: string;
    line: number;
}

export function resolveScope(facts: ScopeFacts): ResolvedScope {
    const contextNoteId = facts.parentId ?? facts.ruleNoteId;
    const anchorNoteId = facts.parentId ?? facts.ruleNoteId;
    const workspaceNoteId = facts.workspaceId ?? undefined;

    if (facts.wantsGlobal) {
        return { ok: true, contextNoteId, scope: { mode: "global", anchorNoteId } };
    }

    if (facts.selfIsTemplate) {
        return {
            ok: true,
            contextNoteId: facts.ruleNoteId,
            scope: { mode: "template", templateNoteId: facts.ruleNoteId, anchorNoteId: facts.ruleNoteId, workspaceNoteId }
        };
    }

    if (facts.parentIsTemplate && facts.parentId) {
        return {
            ok: true,
            contextNoteId: facts.parentId,
            scope: { mode: "template", templateNoteId: facts.parentId, anchorNoteId: facts.parentId, workspaceNoteId }
        };
    }

    if (facts.workspaceId) {
        return {
            ok: true,
            contextNoteId: anchorNoteId,
            scope: { mode: "workspace", anchorNoteId, workspaceNoteId: facts.workspaceId }
        };
    }

    return { ok: true, contextNoteId: anchorNoteId, scope: { mode: "global", anchorNoteId } };
}

export function attributeKeyword(form: AttributeForm, name: string): string {
    return `${form}/${name.replace(/:/g, "__")}`;
}

export function ruleSymbol(form: AttributeForm, arity: 1 | 2, name: string): string {
    return `${form}_${arity}__${name.replace(/:/g, "__")}`;
}

export function predicateKey(form: AttributeForm, arity: 1 | 2, name: string): string {
    return `${form}:${arity}:${name}`;
}

export interface IdbPredicate {
    symbol: string;
    arity: 1 | 2;
    form: AttributeForm;
    name: string;
}

/**
 * Parses and scope-checks `source`. `idb` lists predicates defined by rules (possibly other notes);
 * a body atom with that name calls the rule and also matches a stored attribute of the same name.
 */
export function compileRuleNote(
    source: string,
    scope: Scope,
    titles: ReadonlyMap<string, readonly string[]>,
    idb: ReadonlyMap<string, IdbPredicate>
): CompileResult {
    const scanned = scan(source);
    if (scanned.error) {
        return { diagnostics: [scanned.error], clauses: [] };
    }

    const parsed = parse(scanned.tokens);
    const diagnostics = [...parsed.diagnostics];
    const clauses: CompiledClause[] = [];
    const localArity = new Map<string, 1 | 2>();

    for (const clause of parsed.clauses) {
        const compiled = compileClause(clause, scope, titles, idb, localArity);
        if (compiled.diagnostic) {
            diagnostics.push(compiled.diagnostic);
            continue;
        }
        if (compiled.clause) {
            clauses.push(compiled.clause);
        }
    }

    return { diagnostics, clauses };
}

export function assembleRules(clauses: readonly string[]): string {
    // `note/scc` is a strongly connected component of the child graph, so a clone cycle
    // stays reachable in both directions and the walk still ends.
    const builtin = [
        `[(builtin_descendant ?a ?b)`,
        `  [?a "note/scc" ?s]`,
        `  [?b "note/scc" ?s]`,
        `  [(!= ?a ?b)]]`,
        `[(builtin_descendant ?a ?b)`,
        `  [?a "note/scc" ?sa]`,
        `  [?b "note/scc" ?sb]`,
        `  (builtin_scc_reaches ?sa ?sb)]`,
        `[(builtin_scc_reaches ?x ?y)`,
        `  [?e "scc/id" ?x]`,
        `  [?e "scc/child" ?y]]`,
        `[(builtin_scc_reaches ?x ?z)`,
        `  [?e "scc/id" ?x]`,
        `  [?e "scc/child" ?y]`,
        `  (builtin_scc_reaches ?y ?z)]`
    ].join("\n ");

    if (clauses.length === 0) {
        return `[\n ${builtin}\n]`;
    }

    return `[\n ${builtin}\n ${clauses.join("\n ")}\n]`;
}

export function queryFor(form: AttributeForm, arity: 1 | 2, symbol: string): string {
    if (form === "label" && arity === 1) {
        return `[:find ?noteId :in $ % :where [?e "note/id" ?noteId] (${symbol} ?e)]`;
    }
    if (form === "label") {
        return `[:find ?noteId ?value :in $ % :where [?e "note/id" ?noteId] (${symbol} ?e ?value)]`;
    }
    return `[:find ?srcId ?dstId :in $ % :where [?src "note/id" ?srcId] (${symbol} ?src ?dst) [?dst "note/id" ?dstId]]`;
}

function compileClause(
    clause: Clause,
    scope: Scope,
    titles: ReadonlyMap<string, readonly string[]>,
    idb: ReadonlyMap<string, IdbPredicate>,
    localArity: Map<string, 1 | 2>
): { diagnostic?: RuleDiagnostic; clause?: CompiledClause } {
    const headDiag = checkHead(clause.head, localArity, idb);
    if (headDiag) {
        return { diagnostic: headDiag };
    }

    const sorts = new Map<string, Sort>();
    const mentioned = variableNames(clause);
    if (mentioned.has("this") && bindsThis(scope)) {
        sorts.set("this", "note");
    }

    const positive = clause.body.filter((atom) => atom.kind === "call");
    for (const atom of positive) {
        const diag = bindPattern(atom.pattern, sorts, titles);
        if (diag) {
            return { diagnostic: diag };
        }
    }

    for (const atom of clause.body) {
        if (atom.kind === "cmp") {
            const diag = bindCmp(atom, sorts);
            if (diag) {
                return { diagnostic: diag };
            }
        } else if (atom.kind === "not") {
            const diag = bindPattern(atom.pattern, sorts, titles);
            if (diag) {
                return { diagnostic: diag };
            }
        }
    }

    const headSortDiag = bindPattern(clause.head, sorts, titles);
    if (headSortDiag) {
        return { diagnostic: headSortDiag };
    }

    const safety = checkSafety(clause, scope);
    if (safety) {
        return { diagnostic: safety };
    }

    const arity = clause.head.args.length as 1 | 2;
    const symbol = ruleSymbol(clause.head.form as AttributeForm, arity, clause.head.name);
    const used = variableNames(clause);
    let gen = 0;
    const fresh = () => {
        let name = `rgen${gen}`;
        gen += 1;
        while (used.has(name)) {
            name = `rgen${gen}`;
            gen += 1;
        }
        used.add(name);
        return name;
    };

    const parts: string[] = [];
    if (mentioned.has("this") && scope.mode === "template" && scope.templateNoteId) {
        const tpl = fresh();
        parts.push(`[?this "relation/template" ?${tpl}]`);
        parts.push(`[?${tpl} "note/id" ${ednString(scope.templateNoteId)}]`);
    } else if (mentioned.has("this") && scope.anchorNoteId) {
        parts.push(`[?this "note/id" ${ednString(scope.anchorNoteId)}]`);
    }

    if (scope.workspaceNoteId && scope.mode !== "global") {
        const linked = connectedToThis(clause);
        const free: string[] = [];
        for (const [name, sort] of sorts) {
            if (sort !== "note" || !mentioned.has(name) || linked.has(name)) {
                continue;
            }
            free.push(name);
        }
        if (free.length > 0) {
            const ws = fresh();
            const wid = ednString(scope.workspaceNoteId);
            parts.push(`[?${ws} "note/id" ${wid}]`);
            for (const name of free) {
                const down = `(builtin_descendant ?${ws} ?${name})`;
                const self = `[?${name} "note/id" ${wid}]`;
                parts.push(`(or ${down} ${self})`);
            }
        }
    }

    const headArgs: string[] = [];
    for (const arg of clause.head.args) {
        // Rule heads only accept variables. Constants are bound in the body with `ground`.
        if (arg.kind === "var") {
            headArgs.push(`?${arg.name}`);
            continue;
        }
        const name = fresh();
        if (arg.kind === "note") {
            parts.push(`[?${name} "note/title" ${ednString(arg.title)}]`);
        } else {
            const literal = arg.kind === "number" ? String(arg.value) : ednString(arg.value);
            parts.push(`[(ground ${literal}) ?${name}]`);
        }
        headArgs.push(`?${name}`);
    }

    for (const atom of positive) {
        parts.push(emitPattern(atom.pattern, idb, fresh, parts, false, symbol));
    }
    for (const atom of clause.body) {
        if (atom.kind === "cmp") {
            const op = atom.op === "!=" ? "not=" : atom.op;
            const left = emitTerm(atom.left, fresh, parts);
            const right = emitTerm(atom.right, fresh, parts);
            parts.push(`[(${op} ${left} ${right})]`);
        }
    }
    for (const atom of clause.body) {
        if (atom.kind === "not") {
            parts.push(emitPattern(atom.pattern, idb, fresh, parts, true, symbol));
        }
    }

    const edn = `[(${symbol} ${headArgs.join(" ")})\n  ${parts.join("\n  ")}]`;
    return {
        clause: {
            edn,
            form: clause.head.form as AttributeForm,
            name: clause.head.name,
            arity,
            symbol,
            interest: interestOf(clause)
        }
    };
}

function bindsThis(scope: Scope): boolean {
    return scope.mode === "template" || !!scope.anchorNoteId;
}

function interestOf(clause: Clause): ClauseInterest {
    const interest: ClauseInterest = {
        labels: [],
        relations: [],
        child: false,
        parent: false,
        descendant: false,
        title: false,
        type: false
    };
    const see = (pattern: Pattern) => {
        if (pattern.form === "label") {
            if (!interest.labels.includes(pattern.name)) {
                interest.labels.push(pattern.name);
            }
            return;
        }
        if (pattern.form === "relation") {
            if (!interest.relations.includes(pattern.name)) {
                interest.relations.push(pattern.name);
            }
            return;
        }
        if (pattern.name === "child") {
            interest.child = true;
        } else if (pattern.name === "parent") {
            interest.parent = true;
        } else if (pattern.name === "descendant") {
            interest.descendant = true;
        } else if (pattern.name === "title") {
            interest.title = true;
        } else if (pattern.name === "type") {
            interest.type = true;
        }
    };
    for (const atom of clause.body) {
        if (atom.kind === "call" || atom.kind === "not") {
            see(atom.pattern);
        }
    }
    return interest;
}

function checkHead(head: Pattern, localArity: Map<string, 1 | 2>, idb: ReadonlyMap<string, IdbPredicate>): RuleDiagnostic | null {
    if (head.form === "builtin") {
        return { code: "builtin", line: head.line, name: head.name };
    }
    if (RESERVED_HEADS.has(head.name)) {
        return { code: "reserved", line: head.line, name: head.name };
    }
    if (head.form === "relation" && head.args.length !== 2) {
        return { code: "arity", line: head.line, name: head.name, detail: "2" };
    }
    if (head.args.length !== 1 && head.args.length !== 2) {
        return { code: "arity", line: head.line, name: head.name, detail: "1 or 2" };
    }

    const arity = head.args.length as 1 | 2;
    const key = `${head.form}:${head.name}`;
    const previous = localArity.get(key);
    if (previous !== undefined && previous !== arity) {
        return { code: "arity", line: head.line, name: head.name, detail: String(previous) };
    }
    localArity.set(key, arity);

    const known = idb.get(predicateKey(head.form, arity === 1 ? 2 : 1, head.name));
    if (known && known.arity !== arity) {
        return { code: "arity", line: head.line, name: head.name, detail: String(known.arity) };
    }
    const same = idb.get(predicateKey(head.form, arity, head.name));
    if (same && same.arity !== arity) {
        return { code: "arity", line: head.line, name: head.name, detail: String(same.arity) };
    }
    return null;
}

function bindPattern(pattern: Pattern, sorts: Map<string, Sort>, titles: ReadonlyMap<string, readonly string[]>): RuleDiagnostic | null {
    const expected = expectedSorts(pattern);
    if (!expected) {
        return { code: "arity", line: pattern.line, name: pattern.name, detail: pattern.form === "relation" ? "2" : "1 or 2" };
    }
    if (pattern.form === "builtin" && !BUILTINS.has(pattern.name)) {
        return { code: "builtin", line: pattern.line, name: pattern.name };
    }

    for (let i = 0; i < pattern.args.length; i += 1) {
        const arg = pattern.args[i];
        const sort = expected[i];
        if (!arg || !sort) {
            continue;
        }
        const diag = bindTerm(arg, sort, sorts, titles, pattern.line);
        if (diag) {
            return diag;
        }
    }
    return null;
}

function expectedSorts(pattern: Pattern): Sort[] | null {
    if (pattern.form === "label") {
        if (pattern.args.length === 1) {
            return ["note"];
        }
        if (pattern.args.length === 2) {
            return ["note", "scalar"];
        }
        return null;
    }
    if (pattern.form === "relation" || pattern.form === "builtin") {
        if (pattern.name === "title" || pattern.name === "type") {
            return pattern.args.length === 2 ? ["note", "scalar"] : null;
        }
        return pattern.args.length === 2 ? ["note", "note"] : null;
    }
    return null;
}

function bindTerm(term: Term, sort: Sort, sorts: Map<string, Sort>, titles: ReadonlyMap<string, readonly string[]>, line: number): RuleDiagnostic | null {
    if (term.kind === "var") {
        const prev = sorts.get(term.name);
        if (prev && prev !== sort) {
            return { code: "type", line, name: term.name, detail: prev };
        }
        sorts.set(term.name, sort);
        return null;
    }
    if (term.kind === "note") {
        if (sort !== "note") {
            return { code: "type", line, name: term.title, detail: "note" };
        }
        const hits = titles.get(term.title) ?? [];
        if (hits.length === 0) {
            return { code: "unknown_note", line, name: term.title };
        }
        if (hits.length > 1) {
            return { code: "ambiguous_note", line, name: term.title };
        }
        return null;
    }
    if (sort !== "scalar") {
        return { code: "type", line, detail: "scalar" };
    }
    return null;
}

function bindCmp(atom: Extract<BodyAtom, { kind: "cmp" }>, sorts: Map<string, Sort>): RuleDiagnostic | null {
    const numeric = atom.op !== "=" && atom.op !== "!=";
    for (const term of [atom.left, atom.right]) {
        if (term.kind === "note") {
            return { code: "type", line: atom.line, name: term.title, detail: "note" };
        }
        if (term.kind === "var") {
            const prev = sorts.get(term.name);
            if (numeric && prev === "note") {
                return { code: "type", line: atom.line, name: term.name, detail: "note" };
            }
            if (!prev) {
                sorts.set(term.name, "scalar");
            }
        }
    }
    return null;
}

function checkSafety(clause: Clause, scope: Scope): RuleDiagnostic | null {
    const bound = positiveVars(clause);
    if (variableNames(clause).has("this") && bindsThis(scope)) {
        bound.add("this");
    }

    for (const atom of clause.body) {
        if (atom.kind === "call") {
            continue;
        }
        const names = atom.kind === "not" ? termVars(atom.pattern.args) : termVars([atom.left, atom.right]);
        for (const name of names) {
            if (!bound.has(name)) {
                return { code: "unsafe", line: clause.line, name };
            }
        }
    }

    for (const arg of clause.head.args) {
        if (arg.kind === "var" && !bound.has(arg.name)) {
            return { code: "unsafe", line: clause.line, name: arg.name };
        }
    }
    return null;
}

/** Names that share a path with `?this` through a positive condition or `=`. */
function connectedToThis(clause: Clause): Set<string> {
    const parent = new Map<string, string>();
    const find = (name: string): string => {
        const prev = parent.get(name);
        if (!prev || prev === name) {
            parent.set(name, name);
            return name;
        }
        const root = find(prev);
        parent.set(name, root);
        return root;
    };
    const union = (a: string, b: string) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) {
            parent.set(ra, rb);
        }
    };

    find("this");
    for (const atom of clause.body) {
        if (atom.kind === "call") {
            const vars = [...termVars(atom.pattern.args)];
            for (let i = 1; i < vars.length; i += 1) {
                const left = vars[0];
                const right = vars[i];
                if (left && right) {
                    union(left, right);
                }
            }
        } else if (atom.kind === "cmp" && atom.op === "=" && atom.left.kind === "var" && atom.right.kind === "var") {
            union(atom.left.name, atom.right.name);
        }
    }

    const root = find("this");
    const linked = new Set<string>();
    if (variableNames(clause).has("this")) {
        linked.add("this");
    }
    for (const name of variableNames(clause)) {
        if (find(name) === root) {
            linked.add(name);
        }
    }
    return linked;
}

function positiveVars(clause: Clause): Set<string> {
    const names = new Set<string>();
    for (const atom of clause.body) {
        if (atom.kind === "call") {
            for (const name of termVars(atom.pattern.args)) {
                names.add(name);
            }
        }
    }
    return names;
}

function variableNames(clause: Clause): Set<string> {
    const names = new Set<string>();
    for (const arg of clause.head.args) {
        if (arg.kind === "var") {
            names.add(arg.name);
        }
    }
    for (const atom of clause.body) {
        if (atom.kind === "cmp") {
            for (const name of termVars([atom.left, atom.right])) {
                names.add(name);
            }
        } else {
            for (const name of termVars(atom.pattern.args)) {
                names.add(name);
            }
        }
    }
    return names;
}

function termVars(terms: Term[]): string[] {
    const names: string[] = [];
    for (const term of terms) {
        if (term.kind === "var") {
            names.push(term.name);
        }
    }
    return names;
}

function emitTerm(term: Term, fresh: () => string, parts: string[]): string {
    if (term.kind === "var") {
        return `?${term.name}`;
    }
    if (term.kind === "number") {
        return String(term.value);
    }
    if (term.kind === "string") {
        return ednString(term.value);
    }
    const name = fresh();
    parts.push(`[?${name} "note/title" ${ednString(term.title)}]`);
    return `?${name}`;
}

function emitPattern(
    pattern: Pattern,
    idb: ReadonlyMap<string, IdbPredicate>,
    fresh: () => string,
    parts: string[],
    negate: boolean,
    headSymbol: string
): string {
    const args = pattern.args.map((arg) => emitTerm(arg, fresh, parts));
    let form: string;
    if (pattern.form === "builtin") {
        if (pattern.name === "descendant") {
            form = `(builtin_descendant ${args.join(" ")})`;
        } else {
            const kw = pattern.name === "child"
                ? "note/child"
                : pattern.name === "parent"
                    ? "note/parent"
                    : pattern.name === "title"
                        ? "note/title"
                        : "note/type";
            form = `[${args[0]} "${kw}" ${args[1]}]`;
        }
    } else {
        const arity = pattern.args.length as 1 | 2;
        const kw = attributeKeyword(pattern.form, pattern.name);
        const edb = arity === 1 ? `[${args[0]} "${kw}" _]` : `[${args[0]} "${kw}" ${args[1]}]`;
        const known = idb.get(predicateKey(pattern.form, arity, pattern.name));
        // Calling the rule being defined recurses without a bound when the notes form a cycle.
        if (known && known.symbol !== headSymbol) {
            const callArgs: string[] = [];
            for (const arg of args) {
                if (arg.startsWith("?")) {
                    callArgs.push(arg);
                    continue;
                }
                // A constant inside `or` is not a binding DataScript can parse. Ground it first.
                const name = fresh();
                parts.push(`[(ground ${arg}) ?${name}]`);
                callArgs.push(`?${name}`);
            }
            form = `(or (${known.symbol} ${callArgs.join(" ")}) ${edb})`;
        } else {
            form = edb;
        }
    }
    return negate ? `(not ${form})` : form;
}

export function ednString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
}

function scan(source: string): { tokens: Tok[]; error?: RuleDiagnostic } {
    const tokens: Tok[] = [];
    let i = 0;
    let line = 1;

    const peek = () => source[i];
    const bumpLine = (ch: string | undefined) => {
        if (ch === "\n") {
            line += 1;
        }
    };

    while (i < source.length) {
        const ch = peek();
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            bumpLine(ch);
            i += 1;
            continue;
        }
        if (ch === "/" && source[i + 1] === "/") {
            while (i < source.length && source[i] !== "\n") {
                i += 1;
            }
            continue;
        }
        const startLine = line;
        if (ch === "?" ) {
            i += 1;
            const name = readIdent(source, i);
            if (!name) {
                return { tokens, error: { code: "parse", line: startLine, detail: "expected a variable name" } };
            }
            i += name.length;
            tokens.push({ kind: "var", value: name, line: startLine });
            continue;
        }
        if (ch === "@" && source[i + 1] === "\"") {
            i += 2;
            const read = readString(source, i, line);
            if (read.error) {
                return { tokens, error: read.error };
            }
            tokens.push({ kind: "note", value: read.value, line: startLine });
            i = read.index;
            line = read.line;
            continue;
        }
        if (ch === "\"") {
            i += 1;
            const read = readString(source, i, line);
            if (read.error) {
                return { tokens, error: read.error };
            }
            tokens.push({ kind: "str", value: read.value, line: startLine });
            i = read.index;
            line = read.line;
            continue;
        }
        if (ch === "#" || ch === "~" || ch === "(" || ch === ")" || ch === "," || ch === ".") {
            const kind = ch === "#" ? "hash" : ch === "~" ? "tilde" : ch === "(" ? "lp" : ch === ")" ? "rp" : ch === "," ? "comma" : "dot";
            tokens.push({ kind, value: ch, line: startLine });
            i += 1;
            continue;
        }
        if (ch === ":" && source[i + 1] === "-") {
            tokens.push({ kind: "turnstile", value: ":-", line: startLine });
            i += 2;
            continue;
        }
        const op = readOp(source, i);
        if (op) {
            tokens.push({ kind: "op", value: op, line: startLine });
            i += op.length;
            continue;
        }
        if (ch === "-" || (ch >= "0" && ch <= "9")) {
            const num = readNumber(source, i);
            if (num) {
                tokens.push({ kind: "num", value: num, line: startLine });
                i += num.length;
                continue;
            }
        }
        const ident = readIdent(source, i);
        if (ident) {
            tokens.push({ kind: ident === "not" ? "not" : "id", value: ident, line: startLine });
            i += ident.length;
            continue;
        }
        return { tokens, error: { code: "parse", line: startLine, detail: `unexpected '${ch}'` } };
    }
    return { tokens };
}

function readIdent(source: string, index: number): string {
    const rest = source.slice(index);
    const match = /^[\p{L}_][\p{L}\p{N}_:]*/u.exec(rest);
    return match?.[0] ?? "";
}

function readNumber(source: string, index: number): string {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?/.exec(source.slice(index));
    return match?.[0] ?? "";
}

function readOp(source: string, index: number): string {
    const two = source.slice(index, index + 2);
    if (two === ">=" || two === "<=" || two === "!=") {
        return two;
    }
    const one = source[index];
    if (one === ">" || one === "<" || one === "=") {
        return one;
    }
    return "";
}

function readString(source: string, index: number, line: number): { value: string; index: number; line: number; error?: RuleDiagnostic } {
    let value = "";
    let i = index;
    let currentLine = line;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "\"") {
            return { value, index: i + 1, line: currentLine };
        }
        if (ch === "\n") {
            currentLine += 1;
        }
        if (ch === "\\") {
            const next = source[i + 1];
            if (next === "n") {
                value += "\n";
            } else if (next === "\"" || next === "\\") {
                value += next;
            } else if (next) {
                value += next;
            } else {
                return { value, index: i, line: currentLine, error: { code: "parse", line, detail: "unterminated string" } };
            }
            i += 2;
            continue;
        }
        value += ch;
        i += 1;
    }
    return { value, index: i, line: currentLine, error: { code: "parse", line, detail: "unterminated string" } };
}

function parse(tokens: Tok[]): { clauses: Clause[]; diagnostics: RuleDiagnostic[] } {
    const clauses: Clause[] = [];
    const diagnostics: RuleDiagnostic[] = [];
    let i = 0;
    const peek = () => tokens[i];
    const skipToDot = () => {
        while (i < tokens.length && tokens[i]?.kind !== "dot") {
            i += 1;
        }
        if (tokens[i]?.kind === "dot") {
            i += 1;
        }
    };

    while (i < tokens.length) {
        const start = peek();
        if (!start) {
            break;
        }
        try {
            const head = parsePattern();
            if (peek()?.kind !== "turnstile") {
                throw parseError(peek()?.line ?? head.line, "expected ':-'");
            }
            i += 1;
            const body: BodyAtom[] = [];
            if (peek()?.kind === "dot") {
                throw parseError(peek()?.line ?? head.line, "expected a condition");
            }
            body.push(parseAtom());
            while (peek()?.kind === "comma") {
                i += 1;
                body.push(parseAtom());
            }
            if (peek()?.kind !== "dot") {
                throw parseError(peek()?.line ?? head.line, "expected '.'");
            }
            i += 1;
            clauses.push({ head, body, line: head.line });
        } catch (error) {
            if (error instanceof ParseError) {
                diagnostics.push({ code: "parse", line: error.line, detail: error.message });
                skipToDot();
                continue;
            }
            throw error;
        }
    }

    return { clauses, diagnostics };

    function parseAtom(): BodyAtom {
        const tok = peek();
        if (!tok) {
            throw parseError(1, "unexpected end of rule");
        }
        if (tok.kind === "not") {
            i += 1;
            return { kind: "not", pattern: parsePattern() };
        }
        if (tok.kind === "var" || tok.kind === "str" || tok.kind === "num" || tok.kind === "note") {
            const left = parseTerm();
            const op = peek();
            if (!op || op.kind !== "op") {
                throw parseError(tok.line, "expected a comparison");
            }
            i += 1;
            const right = parseTerm();
            return { kind: "cmp", op: op.value as Extract<BodyAtom, { kind: "cmp" }>["op"], left, right, line: tok.line };
        }
        return { kind: "call", pattern: parsePattern() };
    }

    function parsePattern(): Pattern {
        const tok = peek();
        if (!tok) {
            throw parseError(1, "expected a predicate");
        }
        let form: Pattern["form"];
        if (tok.kind === "hash") {
            form = "label";
            i += 1;
        } else if (tok.kind === "tilde") {
            form = "relation";
            i += 1;
        } else if (tok.kind === "id") {
            form = "builtin";
        } else {
            throw parseError(tok.line, "expected '#' , '~' or a builtin");
        }
        const nameTok = peek();
        if (!nameTok || nameTok.kind !== "id") {
            throw parseError(tok.line, "expected a name");
        }
        i += 1;
        if (form === "builtin" && !BUILTINS.has(nameTok.value)) {
            throw parseError(nameTok.line, `unknown predicate '${nameTok.value}'`);
        }
        if (peek()?.kind !== "lp") {
            throw parseError(nameTok.line, "expected '('");
        }
        i += 1;
        const args: Term[] = [];
        if (peek()?.kind !== "rp") {
            args.push(parseTerm());
            while (peek()?.kind === "comma") {
                i += 1;
                args.push(parseTerm());
            }
        }
        if (peek()?.kind !== "rp") {
            throw parseError(nameTok.line, "expected ')'");
        }
        i += 1;
        return { form, name: nameTok.value, args, line: tok.line };
    }

    function parseTerm(): Term {
        const tok = peek();
        if (!tok) {
            throw parseError(1, "expected a term");
        }
        i += 1;
        if (tok.kind === "var") {
            return { kind: "var", name: tok.value };
        }
        if (tok.kind === "str") {
            return { kind: "string", value: tok.value };
        }
        if (tok.kind === "num") {
            return { kind: "number", value: Number(tok.value) };
        }
        if (tok.kind === "note") {
            return { kind: "note", title: tok.value };
        }
        throw parseError(tok.line, "expected a variable, string, number or @\"note\"");
    }
}

class ParseError extends Error {
    constructor(readonly line: number, message: string) {
        super(message);
    }
}

function parseError(line: number, message: string): ParseError {
    return new ParseError(line, message);
}
