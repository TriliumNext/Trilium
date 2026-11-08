/**
 * Renders an OpenAPI 3.x document as the Markdown body of a User Guide page. The page's title
 * comes from its note, so the output starts with the API's description rather than an H1.
 */
import { MULTICOLUMN_COLUMN_CLASS, MULTICOLUMN_LAYOUT_CLASS } from "../../../packages/commons/src/index.js";

export interface OpenApiSpec {
    info: { title: string; description?: string };
    paths: Record<string, PathItem>;
    /**
     * Declares the order of the operation groups and describes them. `x-icon` is the icon class
     * of a group's heading, as an `#iconClass` label takes it (`bx bx-note`).
     */
    tags?: { name: string; description?: string; "x-icon"?: string }[];
    security?: SecurityRequirement[];
    components?: {
        schemas?: Record<string, Schema>;
        parameters?: Record<string, Parameter>;
        requestBodies?: Record<string, RequestBody>;
        responses?: Record<string, Response>;
        headers?: Record<string, Header>;
        securitySchemes?: Record<string, SecurityScheme>;
    };
}

/** Scheme names mapped to their scopes; every scheme of one requirement is needed. */
type SecurityRequirement = Record<string, string[]>;

interface SecurityScheme {
    type: string;
    description?: string;
    /** For `apiKey`: where the key goes and under which name. */
    in?: string;
    name?: string;
    /** For `http`: the authorization scheme, e.g. `basic` or `bearer`. */
    scheme?: string;
}

interface Reference {
    $ref: string;
}

interface Schema {
    $ref?: string;
    type?: string | string[];
    format?: string;
    pattern?: string;
    description?: string;
    enum?: unknown[];
    nullable?: boolean;
    items?: Schema;
    properties?: Record<string, Schema>;
    required?: string[];
    allOf?: Schema[];
    oneOf?: Schema[];
    anyOf?: Schema[];
    example?: unknown;
    default?: unknown;
    readOnly?: boolean;
    writeOnly?: boolean;
}

interface Parameter {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: Schema;
}

interface MediaType {
    schema?: Schema;
    example?: unknown;
    examples?: Record<string, { value?: unknown }>;
}

interface MediaTypes {
    content?: Record<string, MediaType>;
}

interface RequestBody extends MediaTypes {
    description?: string;
    required?: boolean;
}

interface Header {
    description?: string;
    required?: boolean;
    schema?: Schema;
    example?: unknown;
}

interface Response extends MediaTypes {
    description?: string;
    headers?: Record<string, Header | Reference>;
}

interface Operation {
    operationId?: string;
    tags?: string[];
    summary?: string;
    description?: string;
    parameters?: (Parameter | Reference)[];
    requestBody?: RequestBody | Reference;
    responses?: Record<string, Response | Reference>;
    security?: SecurityRequirement[];
}

type PathItem = { parameters?: (Parameter | Reference)[] } & Partial<Record<HttpMethod, Operation>>;

type HttpMethod = typeof HTTP_METHODS[number];

const HTTP_METHODS = [ "get", "put", "post", "delete", "options", "head", "patch", "trace" ] as const;

/** The places a parameter can go, in the order their tables appear. */
const PARAMETER_LOCATIONS = [
    [ "path", "Path parameters" ],
    [ "query", "Query parameters" ],
    [ "header", "Header parameters" ],
    [ "cookie", "Cookie parameters" ]
] as const;

export function openApiToMarkdown(spec: OpenApiSpec): string {
    const blocks: string[] = [];
    if (spec.info.description) {
        blocks.push(spec.info.description.trim());
    }

    const securitySchemes = Object.entries(spec.components?.securitySchemes ?? {});
    if (securitySchemes.length) {
        blocks.push(`## ${icon("bx bx-lock-alt")}Authentication`);
        for (const [ name, scheme ] of securitySchemes) {
            blocks.push(`### ${code(name)}`, describeSecurityScheme(scheme));
            if (scheme.description) {
                blocks.push(scheme.description.trim());
            }
        }
    }

    for (const [ group, operations ] of groupOperations(spec)) {
        const tag = spec.tags?.find(({ name }) => name === group);
        blocks.push(`## ${icon(tag?.["x-icon"])}${group}`);
        if (tag?.description) {
            blocks.push(tag.description.trim());
        }
        for (const operation of operations) {
            blocks.push(...renderOperation(spec, operation));
        }
    }

    const schemas = Object.entries(spec.components?.schemas ?? {});
    if (schemas.length) {
        blocks.push(`## ${icon("bx bx-cube")}Schemas`);
        for (const [ name, schema ] of schemas) {
            blocks.push(...renderSchema(spec, name, schema));
        }
    }

    return blocks.join("\n\n");
}

interface OperationEntry {
    method: HttpMethod;
    path: string;
    pathItem: PathItem;
    operation: Operation;
}

/**
 * Groups operations by their first tag: the tags the spec declares first, in that order, then the
 * others in order of appearance. Operations without a tag share one group.
 */
function groupOperations(spec: OpenApiSpec) {
    const groups = new Map<string, OperationEntry[]>((spec.tags ?? []).map((tag) => [ tag.name, [] ]));
    for (const [ path, pathItem ] of Object.entries(spec.paths)) {
        for (const method of HTTP_METHODS) {
            const operation = pathItem[method];
            if (!operation) {
                continue;
            }

            const group = operation.tags?.[0] ?? "Endpoints";
            const entries = groups.get(group) ?? [];
            entries.push({ method, path, pathItem, operation });
            groups.set(group, entries);
        }
    }

    return [ ...groups ].filter(([ , entries ]) => entries.length);
}

function renderOperation(spec: OpenApiSpec, { method, path, pathItem, operation }: OperationEntry) {
    // Named like Redocly does: by summary, else by operation ID, else by the route. The route line
    // keeps the operation ID in sight when the summary takes the heading.
    const route = code(`${method.toUpperCase()} ${path}`);
    const id = code(operation.operationId ?? "");
    const summary = operation.summary?.trim();
    const blocks = summary
        ? [ `### ${summary}`, id ? `${route} · ${id}` : route ]
        : id ? [ `### ${id}`, route ] : [ `### ${route}` ];
    if (operation.description) {
        blocks.push(operation.description.trim());
    }

    const security = operation.security ?? spec.security;
    if (security) {
        blocks.push(`**Authorization**: ${describeSecurity(security)}`);
    }

    const parameters = [ ...pathItem.parameters ?? [], ...operation.parameters ?? [] ]
        .map((parameter) => resolve<Parameter>(spec, parameter));
    for (const [ location, label ] of PARAMETER_LOCATIONS) {
        const located = parameters.filter((p) => p.in === location);
        if (located.length) {
            blocks.push(`**${label}**`, table(
                [ "Name", "Description" ],
                located.map((p) => [ nameCell(p.name, p.required), detailsCell(typeMarkdown(spec, p.schema), describe(p)) ])
            ));
        }
    }

    if (operation.requestBody) {
        const body = resolve<RequestBody>(spec, operation.requestBody);
        blocks.push(body.required ? "**Request body** (required)" : "**Request body**");
        if (body.description) {
            blocks.push(body.description.trim());
        }
        blocks.push(...renderContent(spec, body.content ?? {}, "request"));
    }

    const responses = Object.entries(operation.responses ?? {});
    if (responses.length) {
        blocks.push("**Responses**");
    }
    // One tab per status; consecutive tabs form a single tab block.
    for (const [ status, response ] of responses) {
        const { description, headers, content } = resolve<Response>(spec, response);

        const body = renderContent(spec, content ?? {}, "response");
        const panel = [ ...renderHeaders(spec, headers ?? {}), ...body.length ? body : [ "No content." ] ];

        // A tab's title is one line.
        const title = [ status, description?.replace(/\s+/g, " ").trim() ].filter(Boolean).join(": ");
        blocks.push(`=== "${title}"`, ...panel.map(indent));
    }

    return blocks;
}

/** The table of a response's headers, each described by its example when it has no description. */
function renderHeaders(spec: OpenApiSpec, headers: Record<string, Header | Reference>) {
    const rows = Object.entries(headers).map(([ name, header ]) => {
        const { description, required, schema, example } = resolve<Header>(spec, header);
        const sample = example ?? schema?.example;
        const text = description ?? (sample === undefined ? "" : `Example: ${code(String(sample))}`);
        return [
            nameCell(name, required),
            detailsCell(typeMarkdown(spec, schema), describe({ description: text, schema }))
        ];
    });
    return rows.length ? [ "**Response headers**", table([ "Name", "Description" ], rows) ] : [];
}

/** Indents a block into the panel of a tab, which holds the lines indented by four spaces. */
function indent(block: string) {
    return block.split("\n").map((line) => line ? `    ${line}` : line).join("\n");
}

/**
 * A body's content type, which is also its `Content-Type` header, and the type of its schema,
 * linked to its heading unless `spec` is left out, as for a tab title, which a click selects.
 */
function mediaLine(mime: string, { schema }: MediaType, spec?: OpenApiSpec) {
    const type = spec ? typeMarkdown(spec, schema) : code(typeOf(schema));
    return type ? `${code(mime)}: ${type}` : code(mime);
}

type Direction = "request" | "response";

/**
 * The content types of a body, each with its table and sample. When there are several and one of
 * them has something to show, each content type becomes a tab; otherwise they stay a list.
 */
function renderContent(spec: OpenApiSpec, content: Record<string, MediaType>, direction: Direction) {
    const bodies = Object.entries(content).map(([ mime, media ]) => ({
        title: mediaLine(mime, media),
        line: mediaLine(mime, media, spec),
        body: renderBody(spec, mime, media, direction)
    }));

    if (bodies.length > 1 && bodies.some(({ body }) => body.length)) {
        return bodies.flatMap(({ title, body }) => [ `=== "${title}"`, ...body.map(indent) ]);
    }
    return bodies.flatMap(({ line, body }) => [ `*   ${line}`, ...body ]);
}

/**
 * The property table of a body's schema and a sample of the body, side by side when both exist.
 * The sample is the body's own example in any format, else one generated for a JSON body.
 */
function renderBody(spec: OpenApiSpec, mime: string, { schema, example, examples }: MediaType, direction: Direction) {
    const blocks: string[] = [];
    const resolved = schema && resolve(spec, schema);
    if (resolved?.properties) {
        blocks.push(propertyTable(spec, resolved));
    }

    const isJson = mime.includes("json");
    const sample = example ?? Object.values(examples ?? {})[0]?.value
        ?? (isJson && schema ? sampleOf(spec, schema, direction) : undefined);
    if (sample !== undefined) {
        const text = typeof sample === "string" && !isJson ? sample.trimEnd() : JSON.stringify(sample, null, 4);
        blocks.push(`\`\`\`${isJson ? "json" : "plaintext"}\n${text}\n\`\`\``);
    }

    return blocks.length > 1 ? [ columns(blocks) ] : blocks;
}

/** A multicolumn layout of equal columns, in the shape the Markdown export writes it. */
function columns(blocks: string[]) {
    const layout = `<div class="${MULTICOLUMN_LAYOUT_CLASS}" data-trilium-column-ratios="${blocks.map(() => 1).join("-")}">`;
    const content = blocks.map((block) => `<div class="${MULTICOLUMN_COLUMN_CLASS}">\n\n${block}\n\n</div>`);
    return [ layout, ...content, "</div>" ].join("\n");
}

/**
 * A value matching the schema, built from its examples where it has them. A request leaves out
 * read-only properties and a response write-only ones; a schema met again inside itself
 * becomes `{}`.
 */
function sampleOf(spec: OpenApiSpec, schema: Schema, direction: Direction, seen: ReadonlySet<string> = new Set()): unknown {
    if (schema.example !== undefined) {
        return schema.example;
    }
    if (schema.$ref) {
        return seen.has(schema.$ref)
            ? {}
            : sampleOf(spec, resolve(spec, schema), direction, new Set([ ...seen, schema.$ref ]));
    }
    if (schema.default !== undefined) {
        return schema.default;
    }
    if (schema.enum?.length) {
        return schema.enum[0];
    }
    if (schema.allOf) {
        return Object.assign({}, ...schema.allOf.map((part) => sampleOf(spec, part, direction, seen)));
    }
    const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
    if (variant) {
        return sampleOf(spec, variant, direction, seen);
    }

    const type = [ schema.type ].flat().find((t) => t !== "null") ?? (schema.properties ? "object" : undefined);
    switch (type) {
        case "object": {
            const sample: Record<string, unknown> = {};
            for (const [ property, propertySchema ] of Object.entries(schema.properties ?? {})) {
                const resolved = resolve(spec, propertySchema);
                const hidden = direction === "request"
                    ? propertySchema.readOnly ?? resolved.readOnly
                    : propertySchema.writeOnly ?? resolved.writeOnly;
                if (!hidden) {
                    sample[property] = sampleOf(spec, propertySchema, direction, seen);
                }
            }
            return sample;
        }
        case "array":
            return schema.items ? [ sampleOf(spec, schema.items, direction, seen) ] : [];
        case "string":
            return STRING_SAMPLES[schema.format ?? ""] ?? "string";
        case "integer":
        case "number":
            return 0;
        case "boolean":
            return true;
        default:
            return null;
    }
}

/** Placeholders for strings of a known format, the ones Redocly uses. */
const STRING_SAMPLES: Record<string, string> = {
    "date-time": "2019-08-24T14:15:22Z",
    "date": "2019-08-24"
};

function renderSchema(spec: OpenApiSpec, name: string, schema: Schema) {
    const blocks = [ `### <a id="${schemaAnchor(name)}"></a>${code(name)}` ];
    if (schema.description) {
        blocks.push(schema.description.trim());
    }

    if (schema.properties) {
        blocks.push(propertyTable(spec, schema));
        return blocks;
    }

    blocks.push(`Type: ${typeMarkdown(spec, schema)}`, describe({ schema }));
    if (schema.example !== undefined) {
        blocks.push(`Example: ${code(String(schema.example))}`);
    }
    return blocks.filter(Boolean);
}

function propertyTable(spec: OpenApiSpec, schema: Schema) {
    return table([ "Property", "Description" ], propertyRows(spec, schema, ""));
}

/**
 * A row per property, each followed by the rows of the inline object it holds, directly or as its
 * array's items, named by their path (`results[].score`). A referenced schema has a heading of its
 * own, so its properties and its pattern stay there.
 */
function propertyRows(spec: OpenApiSpec, { properties, required }: Schema, prefix: string): string[][] {
    const requiredProperties = new Set(required);
    return Object.entries(properties ?? {}).flatMap(([ property, propertySchema ]) => {
        const resolved = resolve(spec, propertySchema);
        const description = describe({
            description: propertySchema.description ?? resolved.description,
            schema: { enum: resolved.enum, pattern: propertySchema.pattern }
        });
        const row = [
            nameCell(`${prefix}${property}`, requiredProperties.has(property)),
            detailsCell(typeMarkdown(spec, propertySchema), description)
        ];

        const isArray = propertySchema.type === "array";
        const inline = isArray ? propertySchema.items : propertySchema;
        if (!inline?.properties || inline.$ref) {
            return [ row ];
        }
        return [ row, ...propertyRows(spec, inline, `${prefix}${property}${isArray ? "[]" : ""}.`) ];
    });
}

function describeSecurityScheme({ type, in: location, name, scheme }: SecurityScheme) {
    if (type === "apiKey" && location && name) {
        const where = location === "query" ? "query parameter" : location;
        return `API key in the ${code(name)} ${where}.`;
    }
    if (type === "http" && scheme) {
        return `HTTP ${code(scheme)} authentication.`;
    }
    return `Type: ${code(type)}.`;
}

/** Requirements are alternatives; an empty one (or none at all) lets the call go unauthenticated. */
function describeSecurity(requirements: SecurityRequirement[]) {
    if (!requirements.length) {
        return "none";
    }

    return requirements
        .map((requirement) => Object.keys(requirement).map(code).join(" and ") || "none")
        .join(" or ");
}

/**
 * The type of a schema as Markdown: `typeOf()` as code, except that each schema the spec defines
 * links to its heading, with the rest of the type as text around it.
 */
function typeMarkdown(spec: OpenApiSpec, schema: Schema | undefined): string {
    if (!schema || !namesDefinedSchema(spec, schema)) {
        return code(typeOf(schema));
    }

    let type: string;
    if (schema.$ref) {
        const name = refName(schema.$ref);
        type = `[${code(name)}](#${schemaAnchor(name)})`;
    } else if (schema.allOf) {
        type = schema.allOf.map((part) => typeMarkdown(spec, part)).join(" & ");
    } else if (schema.oneOf ?? schema.anyOf) {
        type = (schema.oneOf ?? schema.anyOf ?? []).map((part) => typeMarkdown(spec, part)).join(" | ");
    } else {
        type = `array of ${typeMarkdown(spec, schema.items)}`;
    }

    return schema.nullable ? `${type} | ${code("null")}` : type;
}

/** Whether the type of `schema` names a schema of `components.schemas`, which has a heading. */
function namesDefinedSchema(spec: OpenApiSpec, schema: Schema | undefined): boolean {
    if (!schema) {
        return false;
    }
    if (schema.$ref) {
        return Object.hasOwn(spec.components?.schemas ?? {}, refName(schema.$ref));
    }

    const parts = [ ...schema.allOf ?? [], ...schema.oneOf ?? [], ...schema.anyOf ?? [] ];
    if (schema.type === "array") {
        parts.push(...schema.items ? [ schema.items ] : []);
    }
    return parts.some((part) => namesDefinedSchema(spec, part));
}

/** The id of the anchor in a schema's heading. */
function schemaAnchor(name: string) {
    return `schema-${name}`;
}

/** The type of a schema as one line, naming referenced schemas instead of expanding them. */
function typeOf(schema: Schema | undefined): string {
    if (!schema) {
        return "";
    }

    let type: string;
    if (schema.$ref) {
        type = refName(schema.$ref);
    } else if (schema.allOf) {
        type = schema.allOf.map(typeOf).join(" & ");
    } else if (schema.oneOf ?? schema.anyOf) {
        type = (schema.oneOf ?? schema.anyOf ?? []).map(typeOf).join(" | ");
    } else if (schema.type === "array") {
        type = `array of ${typeOf(schema.items)}`;
    } else if (schema.type) {
        type = [ schema.type ].flat().join(" | ");
        if (schema.format) {
            type += ` (${schema.format})`;
        }
    } else {
        type = schema.properties ? "object" : "any";
    }

    return schema.nullable ? `${type} | null` : type;
}

/** A description followed by the values the schema allows: its enum, else the pattern it matches. */
function describe({ description, schema }: { description?: string; schema?: Schema }) {
    const values = schema?.enum ? `One of ${schema.enum.map((value) => code(String(value))).join(", ")}.`
        : schema?.pattern ? `Matches ${code(schema.pattern)}.`
            : "";
    if (!values) {
        return description ?? "";
    }

    return description ? `${description.trim().replace(/(?<![.!?])$/, ".")} ${values}` : values;
}

function resolve<T extends object>(spec: OpenApiSpec, value: T | Reference): T {
    if (!isReference(value)) {
        return value;
    }

    // "#/components/parameters/Force" → spec.components.parameters.Force
    let target: unknown = spec;
    for (const segment of value.$ref.replace(/^#\//, "").split("/")) {
        target = (target as Record<string, unknown> | undefined)?.[segment];
    }
    if (!target) {
        throw new Error(`Cannot resolve ${value.$ref}`);
    }
    return target as T;
}

function isReference(value: object): value is Reference {
    return "$ref" in value;
}

function refName(ref: string) {
    return ref.slice(ref.lastIndexOf("/") + 1);
}

function table(headers: string[], rows: string[][]) {
    return [ headers, headers.map(() => "---"), ...rows ]
        .map((cells) => `| ${cells.map(cell).join(" | ")} |`)
        .join("\n");
}

/**
 * A table cell holds one line, and a pipe would end it early, even inside a code span. A pipe after
 * an odd number of backslashes is escaped already.
 */
function cell(text: string) {
    return text.replace(/\s*\n\s*/g, " ")
        .replace(/(\\*)\|/g, (_, backslashes: string) => `${backslashes}${backslashes.length % 2 ? "" : "\\"}|`)
        .trim();
}

/** The name cell of a parameter or property, marking it below the name when it is required. */
function nameCell(text: string, required?: boolean) {
    return required ? `${code(text)}<br>*required*` : code(text);
}

/** The description cell of a parameter or property, its type (Markdown) on the first line. */
function detailsCell(type: string, description: string) {
    return [ type, description ].filter(Boolean).join("<br>");
}

/** An inline icon followed by a space, to put before a heading's text. */
function icon(iconClass: string | undefined) {
    return iconClass ? `<span class="tn-icon ${iconClass}"></span> ` : "";
}

function code(text: string) {
    return text ? `\`${text}\`` : "";
}
