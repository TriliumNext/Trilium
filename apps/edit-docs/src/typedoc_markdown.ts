/**
 * Renders the declarations of a TypeScript module, as TypeDoc reads them, as the Markdown body of
 * a User Guide page. The page's title comes from its note, so the output starts with the module's
 * `@packageDocumentation` comment rather than an H1.
 */
import { renderToHtml } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { execFile } from "child_process";
import { mkdtemp, readFile, rm } from "fs/promises";
import { createRequire } from "module";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { JSONOutput } from "typedoc";
import { promisify } from "util";

type Project = JSONOutput.ProjectReflection;
type Declaration = JSONOutput.DeclarationReflection;
type Signature = JSONOutput.SignatureReflection;
type SomeType = JSONOutput.SomeType;
type Comment = JSONOutput.Comment;

/**
 * Runs TypeDoc on one entry point and returns its model, as `typedoc --json` writes it.
 *
 * TypeDoc runs in a process of its own because typedoc-plugin-missing-exports patches TypeDoc
 * and refuses to load a second time in one process. It is resolved from the working directory, the
 * documentation checkout, since the packaged editor ships without it. `process.execPath` is Electron
 * in the editor, so `ELECTRON_RUN_AS_NODE` makes it run TypeDoc as Node would.
 */
export async function runTypeDoc(entryPoint: string, tsconfig: string): Promise<Project> {
    const typeDocPackage = createRequire(join(process.cwd(), "package.json")).resolve("typedoc/package.json");
    const typeDoc = join(dirname(typeDocPackage), "bin", "typedoc");
    const dir = await mkdtemp(join(tmpdir(), "typedoc-"));
    const output = join(dir, "project.json");
    try {
        await promisify(execFile)(process.execPath, [
            typeDoc,
            // Entry points are globs, which take `/` as the only separator.
            "--entryPoints", entryPoint.replaceAll("\\", "/"),
            "--tsconfig", tsconfig,
            "--json", output,
            "--skipErrorChecking",
            "--sort", "source-order",
            "--excludePrivate",
            "--logLevel", "Error",
            // Declares the types the entry point imports from other modules in an `<internal>` module.
            "--plugin", "typedoc-plugin-missing-exports"
        ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
        return JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
        // TypeDoc logs its errors to stdout.
        const { stdout, stderr, message } = error as { stdout?: string; stderr?: string; message: string };
        const log = [ stdout, stderr ].map((text) => text?.trim()).filter(Boolean).join("\n") || message;
        throw new Error(`TypeDoc could not convert ${entryPoint}.\n${log}`);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

/**
 * Renders `root` and the declarations it reaches, in order of first reference, so a module can
 * hold several pages' APIs. Without `root`, the exports follow in source order.
 *
 * `root` and the interfaces with methods come first, each under a heading of its own; the types
 * they use follow under "Types". A union of literals that one place uses is written out there
 * instead of getting an entry. A reference to a declaration the page shows links to its heading.
 */
export function typeDocToMarkdown(project: Project, options: TypeDocMarkdownOptions = {}): string {
    return renderSelection(project, options, true, ({ apis, types }) => {
        const blocks: string[] = [];
        if (project.comment) {
            blocks.push(renderComment(project.comment));
        }

        for (const declaration of apis) {
            blocks.push(...renderDeclaration(declaration, "##"));
        }

        if (apis.length && types.length) {
            blocks.push("## Types");
        }
        for (const declaration of types) {
            blocks.push(...renderDeclaration(declaration, apis.length ? "###" : "##"));
        }

        return blocks.filter(Boolean).join("\n\n");
    });
}

/**
 * Renders the declarations `typeDocToMarkdown()` shows as compact TypeScript: every member on one
 * line, under the first sentence of its description, for an LLM to read where the page would cost
 * too many tokens. Deprecated declarations and members are left out.
 */
export function typeDocToDeclarations(project: Project, options: TypeDocMarkdownOptions = {}): string {
    return renderSelection(project, options, false, ({ apis, types }) => {
        const declarations = [ ...apis, ...types ].filter((declaration) => !isDeprecated(declaration.comment));
        const names = new Set(declarations.map((declaration) => declaration.name));
        return declarations.map((declaration) => declarationToString(declaration, names)).join("\n\n");
    });
}

export interface TypeDocMarkdownOptions {
    /** The export the page starts with; the page then shows only what it reaches. */
    root?: string;
    /**
     * Prefixes to leave out of the names of the declarations the page shows, such as `Script` to
     * write `ScriptNote` as `Note`. A prefix counts only before an uppercase letter.
     */
    stripPrefixes?: string[];
}

/** The `ReflectionKind` values this module renders. */
const KIND = {
    interface: 256,
    typeAlias: 2097152,
    property: 1024,
    method: 2048,
    accessor: 262144,
    constructorSignature: 16384
};

/** The aliases `typeToString()` writes out in place of their name, while a page renders. */
let inlinedAliases = new Map<string, Declaration>();

/** The names the page writes for the declarations it shows, where they differ, while it renders. */
let displayNames = new Map<string, string>();

/** The declarations that have a heading on the page, while it renders. */
let shownNames = new Set<string>();

/** Whether `typeToString()` marks the names it can link, for `typeMarkdown()` to find. */
let markingLinks = false;
const LINK_START = "\u0002";
const LINK_END = "\u0003";

/**
 * Selects what a page shows and sets the naming state `typeToString()` reads while `render` runs.
 * `root` and the interfaces with methods are the APIs; the rest are the types they use. Only a
 * `linked` rendering marks the names it can link to a heading.
 */
function renderSelection(
    project: Project,
    { root, stripPrefixes = [] }: TypeDocMarkdownOptions,
    linked: boolean,
    render: (selection: { apis: Declaration[]; types: Declaration[] }) => string
) {
    const { declarations, inlined } = selectDeclarations(project, root);
    inlinedAliases = inlined;
    displayNames = stripNames(declarations.map((declaration) => declaration.name), stripPrefixes);
    shownNames = linked ? new Set(declarations.map((declaration) => declaration.name)) : new Set();
    try {
        const isApi = (declaration: Declaration) => declaration.name === root
            || !!declaration.children?.some((member) => member.kind === KIND.method);
        return render({
            apis: declarations.filter(isApi),
            types: declarations.filter((declaration) => !isApi(declaration))
        });
    } finally {
        inlinedAliases = new Map();
        displayNames = new Map();
        shownNames = new Set();
    }
}

/**
 * Maps each name that starts with one of `prefixes`, before an uppercase letter, to the name
 * without it, trying the longest prefix first. Throws when two names would end up the same.
 */
function stripNames(names: string[], prefixes: string[]) {
    const longestFirst = [ ...prefixes ].sort((a, b) => b.length - a.length);
    const renamed = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const name of names) {
        const prefix = longestFirst.find((candidate) => name.startsWith(candidate) && /[A-Z]/.test(name.charAt(candidate.length)));
        const display = prefix ? name.slice(prefix.length) : name;
        const owner = owners.get(display);
        if (owner !== undefined) {
            throw new Error(`${owner} and ${name} would both be named ${display}.`);
        }
        owners.set(display, name);
        if (display !== name) {
            renamed.set(name, display);
        }
    }
    return renamed;
}

function displayName(name: string) {
    return displayNames.get(name) ?? name;
}

/**
 * A dotted reference, such as `Api.member`, as code with its first part renamed. It links to the
 * heading of that first part when the page shows it.
 */
function referenceMarkdown(reference: string) {
    const [ first, ...rest ] = reference.split(".");
    const text = code([ displayName(first), ...rest ].join("."));
    return shownNames.has(first) ? `[${text}](#${anchor(first)})` : text;
}

/** The id of the anchor in a declaration's heading. */
function anchor(name: string) {
    return `type-${displayName(name)}`;
}

/**
 * What the page shows: `root` and what it reaches, or else the module's exports and the types they
 * import from other modules. The unions of literals that one of them uses are left out, and
 * returned to be written out where they are used.
 */
function selectDeclarations(project: Project, root: string | undefined) {
    const own = (project.children ?? []).filter((declaration) => declaration.name !== "<internal>");
    const imported = (project.children ?? [])
        .filter((declaration) => declaration.name === "<internal>")
        .flatMap((internal) => internal.children ?? [])
        .filter((declaration) => !declaration.sources?.some((source) => source.fileName.includes("node_modules/")));
    const byName = new Map([ ...own, ...imported ].map((declaration) => [ declaration.name, declaration ]));

    let shown: Declaration[];
    const rootDeclaration = root ? byName.get(root) : undefined;
    if (rootDeclaration) {
        shown = reach(rootDeclaration, byName);
    } else {
        const usedByOwn = new Set(own.flatMap(referencedNames));
        shown = [ ...own, ...imported.filter((declaration) => usedByOwn.has(declaration.name)) ];
    }

    const uses = new Map<string, number>();
    for (const name of shown.flatMap(referencedNames)) {
        uses.set(name, (uses.get(name) ?? 0) + 1);
    }

    const inlined = new Map(shown
        .filter((declaration) => isLiteralUnion(declaration) && uses.get(declaration.name) === 1)
        .map((declaration) => [ declaration.name, declaration ]));
    return {
        declarations: shown.filter((declaration) => !inlined.has(declaration.name)),
        inlined
    };
}

/** Whether a declaration is a type alias for a union of literals whose values have no comments. */
function isLiteralUnion(declaration: Declaration) {
    const type = declaration.type;
    return declaration.kind === KIND.typeAlias && type?.type === "union" && !type.elementSummaries
        && type.types.every((member) => member.type === "literal");
}

/** `root` and the declarations it reaches, breadth first, in order of first reference. */
function reach(root: Declaration, byName: Map<string, Declaration>) {
    const reached = new Set<Declaration>();
    const queue = [ root ];
    for (let declaration = queue.shift(); declaration; declaration = queue.shift()) {
        if (reached.has(declaration)) {
            continue;
        }

        reached.add(declaration);
        for (const name of referencedNames(declaration)) {
            const referenced = byName.get(name);
            if (referenced) {
                queue.push(referenced);
            }
        }
    }

    return [ ...reached ];
}

/** Keys whose references a page does not show: comments, and the links between related types. */
const UNSHOWN_KEYS = new Set([ "comment", "extendedTypes", "extendedBy", "implementedTypes", "implementedBy", "inheritedFrom" ]);

/** The names of the types a declaration refers to, in the order they appear in it. */
function referencedNames(declaration: Declaration) {
    const names: string[] = [];
    const visit = (value: unknown) => {
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
            }
        } else if (value && typeof value === "object") {
            const node = value as Record<string, unknown>;
            if (node.type === "reference" && typeof node.name === "string") {
                names.push(node.name);
            }
            for (const [ key, child ] of Object.entries(node)) {
                if (!UNSHOWN_KEYS.has(key)) {
                    visit(child);
                }
            }
        }
    };
    visit(declaration);
    return names;
}

function renderDeclaration(declaration: Declaration, heading: string) {
    const blocks = [ `${heading} <a id="${anchor(declaration.name)}"></a>${code(displayName(declaration.name))}` ];
    if (declaration.comment) {
        blocks.push(renderComment(declaration.comment));
    }

    if (declaration.kind === KIND.typeAlias) {
        const type = declaration.type;
        blocks.push(type?.type === "union" && type.elementSummaries
            ? table([ "Value", "Description" ], type.types.map((value, index) => [
                typeMarkdown(value),
                oneLine(partsToMarkdown(type.elementSummaries?.[index] ?? []))
            ]))
            : fence(`type ${displayName(declaration.name)}${typeParametersToString(declaration.typeParameters)} = ${typeToString(type)}`));
        return blocks;
    }

    const members = (declaration.children ?? []).filter((member) =>
        member.kind === KIND.property || member.kind === KIND.accessor || member.kind === KIND.method);
    if (!members.length) {
        return blocks;
    }

    // Properties alone fit a Markdown table; a method's cell holds blocks, which only HTML can.
    if (!members.some((member) => member.kind === KIND.method)) {
        blocks.push(table([ "Property", "Description" ], members.map((property) => [
            property.flags.isOptional ? `${code(property.name)}<br>*optional*` : code(property.name),
            propertyDetails(property)
        ])));
        return blocks;
    }

    blocks.push(htmlTable([ "Member", "Description" ], members.map((member) => [
        `<code>${escapeHtml(member.name)}</code>${member.flags.isOptional ? "<br><em>optional</em>" : ""}`,
        markdownToHtml(member.kind === KIND.method ? methodDetails(member) : propertyDetails(member))
    ])));
    return blocks;
}

/**
 * A declaration as TypeScript, under the first sentence of its description. A member inherited
 * from one of `written`, the declarations written alongside, is left to that declaration.
 */
function declarationToString(declaration: Declaration, written: Set<string>) {
    const name = `${displayName(declaration.name)}${typeParametersToString(declaration.typeParameters)}`;
    const comment = summaryComment(declaration.comment, "");
    if (declaration.kind === KIND.typeAlias) {
        return `${comment}type ${name} = ${typeToString(declaration.type)};`;
    }

    const extended = declaration.extendedTypes?.length
        ? ` extends ${declaration.extendedTypes.map(typeToString).join(", ")}`
        : "";
    const members = (declaration.children ?? [])
        .filter((member) => !written.has(member.inheritedFrom?.name.split(".")[0] ?? ""))
        .flatMap(memberToLines);
    return members.length
        ? `${comment}interface ${name}${extended} {\n${members.join("\n")}\n}`
        : `${comment}interface ${name}${extended} {}`;
}

/** A member's lines in an interface: the first sentence of its description, then one line per signature. */
function memberToLines(member: Declaration): string[] {
    const indent = "    ";
    const optional = member.flags.isOptional ? "?" : "";
    let comment: Comment | undefined;
    let lines: string[];
    if (member.kind === KIND.method) {
        const signatures = member.signatures ?? [];
        comment = (signatures.find((candidate) => candidate.comment) ?? signatures[0])?.comment;
        lines = signatures.map((signature) =>
            `${indent}${member.name}${optional}${parametersToString(signature)}: ${typeToString(signature.type)};`);
    } else if (member.kind === KIND.property || member.kind === KIND.accessor) {
        const isAccessor = member.kind === KIND.accessor;
        comment = member.comment ?? member.getSignature?.comment;
        const readonly = member.flags.isReadonly || (isAccessor && !member.setSignature) ? "readonly " : "";
        const type = isAccessor ? member.getSignature?.type : member.type;
        lines = [ `${indent}${readonly}${member.name}${optional}: ${typeToString(type)};` ];
    } else {
        return [];
    }

    if (isDeprecated(comment)) {
        return [];
    }
    const summary = summaryComment(comment, indent);
    return summary ? [ summary.trimEnd(), ...lines ] : lines;
}

/** The first sentence of a comment's summary as a `/** … *\/` line, or nothing without one. */
function summaryComment(comment: Comment | undefined, indent: string) {
    const summary = comment ? oneLine(partsToMarkdown(comment.summary)) : "";
    if (!summary) {
        return "";
    }

    // A sentence ends at a stop followed by a capital, which keeps "e.g. `x`" in one piece.
    const sentence = /^.*?[.!?](?=\s+[A-Z]|$)/.exec(summary)?.[0] ?? summary;
    return `${indent}/** ${sentence.replaceAll("*/", "*\\/")} */\n`;
}

function isDeprecated(comment: Comment | undefined) {
    return !!comment?.blockTags?.some((tag) => tag.tag === "@deprecated");
}

function propertyDetails(property: Declaration) {
    const type = typeMarkdown(property.type ?? property.getSignature?.type);
    return details(type, [ property.comment, ...inlinedComments(property) ]);
}

/** The comments of the aliases a member's types write out, which their names no longer point to. */
function inlinedComments(member: Declaration) {
    return [ ...new Set(referencedNames(member)) ]
        .map((name) => inlinedAliases.get(name)?.comment)
        .filter((comment) => !!comment);
}

/**
 * A method's signature and description, then its parameters and its return value when a comment
 * describes them; otherwise the signature already says all they would.
 */
function methodDetails(method: Declaration) {
    const signatures = method.signatures ?? [];
    const blocks = [ fence(signatures.map(signatureToString).join("\n")) ];

    // Overloads share one entry, described by the first signature that has a comment.
    const signature = signatures.find((candidate) => candidate.comment) ?? signatures[0];
    if (!signature) {
        return blocks.join("\n\n");
    }

    if (signature.comment) {
        blocks.push(renderComment(signature.comment));
    }
    blocks.push(...inlinedComments(method).map(renderComment));

    const parameters = signature.parameters ?? [];
    if (parameters.some((parameter) => parameter.comment)) {
        blocks.push(table([ "Parameter", "Description" ], parameters.map((parameter) => [
            parameter.flags.isOptional ? `${code(parameter.name)}<br>*optional*` : code(parameter.name),
            details(typeMarkdown(parameter.type), [ parameter.comment ])
        ])));
    }

    const returns = blockTag(signature.comment, "@returns");
    if (returns) {
        blocks.push(`**Returns** ${typeMarkdown(signature.type)}: ${returns}`);
    }

    return blocks.filter(Boolean).join("\n\n");
}

/** A comment's summary, followed by a warning when it carries `@deprecated`. */
function renderComment(comment: Comment) {
    const blocks = [ partsToMarkdown(comment.summary) ];
    const deprecated = comment.blockTags?.find((tag) => tag.tag === "@deprecated");
    if (deprecated) {
        const reason = partsToMarkdown(deprecated.content);
        blocks.push(`> [!WARNING]\n> Deprecated.${reason ? ` ${reason.replace(/\n/g, "\n> ")}` : ""}`);
    }

    return blocks.filter(Boolean).join("\n\n");
}

function blockTag(comment: Comment | undefined, tag: string) {
    const content = comment?.blockTags?.find((candidate) => candidate.tag === tag)?.content;
    return content ? partsToMarkdown(content) : "";
}

/**
 * Comment text as Markdown; a `{@link}` becomes its target's name as code. A code span that names
 * a declaration, such as `` `Api` `` or `` `Api.member` ``, follows its display name. Both link to
 * the declaration's heading.
 */
function partsToMarkdown(parts: JSONOutput.CommentDisplayPart[]) {
    const renderPart = (part: JSONOutput.CommentDisplayPart) => {
        if (part.kind === "inline-tag") {
            return referenceMarkdown(part.text);
        }
        const reference = part.kind === "code" ? /^`([\w$]+(?:\.[\w$]+)*)`$/.exec(part.text) : null;
        return reference ? referenceMarkdown(reference[1]) : part.text;
    };
    return parts.map(renderPart).join("")
        .replaceAll("\r\n", "\n")
        .trim();
}

/** A table cell holding a type, written by `typeMarkdown()`, with each description on a line below. */
function details(type: string, comments: (Comment | undefined)[]) {
    const descriptions = comments.map((comment) => comment ? oneLine(partsToMarkdown(comment.summary)) : "");
    return [ type, ...descriptions ].filter(Boolean).join("<br>");
}

function oneLine(text: string) {
    return text.replace(/\s*\n\s*/g, " ");
}

function signatureToString(signature: Signature) {
    return `${signature.name}${parametersToString(signature)}: ${typeToString(signature.type)}`;
}

function parametersToString(signature: Signature) {
    const parameters = (signature.parameters ?? []).map((parameter) => {
        const rest = parameter.flags.isRest ? "..." : "";
        const optional = parameter.flags.isOptional ? "?" : "";
        return `${rest}${parameter.name}${optional}: ${typeToString(parameter.type)}`;
    });
    return `${typeParametersToString(signature.typeParameters)}(${parameters.join(", ")})`;
}

/** The type parameters of a signature or a type alias, as in `<T extends string = string>`. */
function typeParametersToString(typeParameters: JSONOutput.TypeParameterReflection[] | undefined) {
    const parameters = (typeParameters ?? []).map((parameter) => {
        const constraint = parameter.type ? ` extends ${typeToString(parameter.type)}` : "";
        const fallback = parameter.default ? ` = ${typeToString(parameter.default)}` : "";
        return `${parameter.name}${constraint}${fallback}`;
    });
    return parameters.length ? `<${parameters.join(", ")}>` : "";
}

/**
 * A type as Markdown: `typeToString()` as code, except that each declaration the page shows links
 * to its heading, with the rest of the type as code around it. The `|` and `&` next to a link stay
 * outside the code.
 */
function typeMarkdown(type: SomeType | undefined) {
    markingLinks = true;
    let text: string;
    try {
        text = typeToString(type);
    } finally {
        markingLinks = false;
    }

    return text.split(new RegExp(`${LINK_START}(\\w+)${LINK_END}`)).map((part, index) => {
        if (index % 2) {
            return referenceMarkdown(part);
        }
        const [ , before, core, after ] = /^([\s|&]*)([\s\S]*?)([\s|&]*)$/.exec(part) ?? [ "", "", part, "" ];
        return core ? `${before}${code(core)}${after}` : part;
    }).join("");
}

/** A type as TypeScript writes it. */
function typeToString(type: SomeType | undefined): string {
    if (!type) {
        return "";
    }

    switch (type.type) {
        case "intrinsic":
            return type.name;
        case "reference": {
            const alias = !type.typeArguments && inlinedAliases.get(type.name);
            if (alias) {
                return typeToString(alias.type);
            }
            const args = type.typeArguments?.map(typeToString).join(", ");
            const name = markingLinks && shownNames.has(type.name)
                ? `${LINK_START}${type.name}${LINK_END}`
                : displayName(type.name);
            return args ? `${name}<${args}>` : name;
        }
        case "literal":
            return type.value === null ? "null"
                : typeof type.value === "object" ? `${type.value.negative ? "-" : ""}${type.value.value}n`
                    : JSON.stringify(type.value);
        case "array":
            return `${wrap(type.elementType)}[]`;
        case "union":
            return type.types
                .map((member) => isFunctionType(member) ? `(${typeToString(member)})` : typeToString(member))
                .join(" | ");
        case "intersection":
            return type.types.map(wrap).join(" & ");
        case "tuple":
            return `[${(type.elements ?? []).map(typeToString).join(", ")}]`;
        case "namedTupleMember":
            return `${type.name}${type.isOptional ? "?" : ""}: ${typeToString(type.element)}`;
        case "optional":
            return `${typeToString(type.elementType)}?`;
        case "rest":
            return `...${typeToString(type.elementType)}`;
        case "typeOperator":
            return `${type.operator} ${wrap(type.target)}`;
        case "query":
            return `typeof ${typeToString(type.queryType)}`;
        case "indexedAccess":
            return `${wrap(type.objectType)}[${typeToString(type.indexType)}]`;
        case "predicate":
            return `${type.asserts ? "asserts " : ""}${type.name}${type.targetType ? ` is ${typeToString(type.targetType)}` : ""}`;
        case "reflection":
            return reflectionToString(type.declaration);
        default:
            return "name" in type && typeof type.name === "string" ? type.name : type.type;
    }
}

/** An inline type: a function or constructor type, or an object type literal. */
function reflectionToString(declaration: Declaration) {
    const signature = declaration.signatures?.[0];
    if (signature) {
        const keyword = signature.kind === KIND.constructorSignature ? "new " : "";
        return `${keyword}${parametersToString(signature)} => ${typeToString(signature.type)}`;
    }

    const members = (declaration.children ?? []).map((member) => {
        const optional = member.flags.isOptional ? "?" : "";
        const memberSignature = member.signatures?.[0];
        return memberSignature
            ? `${member.name}${optional}${parametersToString(memberSignature)}: ${typeToString(memberSignature.type)}`
            : `${member.name}${optional}: ${typeToString(member.type)}`;
    });
    const index = declaration.indexSignatures?.[0];
    if (index) {
        const [ key ] = index.parameters ?? [];
        members.push(`[${key?.name ?? "key"}: ${typeToString(key?.type)}]: ${typeToString(index.type)}`);
    }

    return members.length ? `{ ${members.join("; ")} }` : "{}";
}

/** A type as an operand of `[]`, `&` or a type operator, in parentheses when it needs them. */
function wrap(type: SomeType | undefined) {
    const text = typeToString(type);
    if (type?.type === "reference" && !type.typeArguments && inlinedAliases.has(type.name)) {
        type = inlinedAliases.get(type.name)?.type;
    }
    const needsParentheses = type?.type === "union" || type?.type === "intersection" || isFunctionType(type);
    return needsParentheses ? `(${text})` : text;
}

/** Whether `typeToString()` writes a type as a function or constructor type, `(…) => …`. */
function isFunctionType(type: SomeType | undefined) {
    return type?.type === "reflection" && !!type.declaration.signatures?.length;
}

function fence(text: string) {
    return `\`\`\`ts\n${text}\n\`\`\``;
}

function table(headers: string[], rows: string[][]) {
    const line = (cells: string[]) => `| ${cells.map(escapePipes).join(" | ")} |`;
    return [ line(headers), `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map(line) ].join("\n");
}

/**
 * A table as the Markdown export writes one it keeps as HTML: a structural tag per line and
 * each cell's content on one line, so the page comes back from an import and export unchanged.
 */
function htmlTable(headers: string[], rows: string[][]) {
    const tableRow = (tag: string, cells: string[]) => [
        "        <tr>",
        ...cells.map((cell) => `            <${tag}>${cell}</${tag}>`),
        "        </tr>"
    ];
    return [
        "<table>",
        "    <thead>",
        ...tableRow("th", headers),
        "    </thead>",
        "    <tbody>",
        ...rows.flatMap((cells) => tableRow("td", cells)),
        "    </tbody>",
        "</table>"
    ].join("\n");
}

/**
 * Markdown rendered as a table cell takes it, in the form the export writes the cell: the import's
 * renderer, on one line outside `<pre>`, with quotes in text unescaped. A blank line in a `<pre>`
 * becomes `&#10;`, since a blank line would end the HTML block.
 */
function markdownToHtml(markdown: string) {
    const html = renderToHtml(markdown, "", { sanitize: (dirtyHtml) => dirtyHtml, demoteH1: false })
        .trim()
        .replace(/>\n+</g, "><")
        .replace(/>([^<]*)</g, (_, text: string) => `>${text.replaceAll("&#39;", "'").replaceAll("&quot;", "\"")}<`);

    return html.split(/(<pre[\s\S]*?<\/pre>)/)
        .map((part) => part.startsWith("<pre")
            ? part.replace(/\n(?=[ \t]*(?:\n|$))/g, "&#10;")
            : part.replace(/\s*\n\s*/g, " "))
        .join("");
}

/**
 * Escapes the pipes of a table cell's Markdown, which would otherwise end the cell, even inside a
 * code span. A pipe after an odd number of backslashes is escaped already.
 */
function escapePipes(markdown: string) {
    return markdown.replace(/(\\*)\|/g, (_, backslashes: string) =>
        `${backslashes}${backslashes.length % 2 ? "" : "\\"}|`);
}

function escapeHtml(text: string) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function code(text: string) {
    return text ? `\`${text}\`` : "";
}
