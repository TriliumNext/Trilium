import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runTypeDoc, typeDocToDeclarations, typeDocToMarkdown } from "./typedoc_markdown.js";

const FIXTURE = `
/**
 * The demo API, exposed as \`window.demoApi\`.
 *
 * @packageDocumentation
 */
import type { Audience } from "./audience";

/** Options of {@link DemoWindowApi.resize}. */
export interface ResizeOptions {
    /** The new width. */
    width: Size;
    animate?: boolean;
}

/** A size in pixels. */
export type Size = number | "auto";

/** An export the root never reaches. */
export interface Unreached {
    flag: boolean;
    /** A use of \`Screen\` the page does not show, which leaves it used in one place. */
    screen: Screen;
    /** Splits on a\\|b or c|d. */
    separator: string;
}

/** A widget's constructor. */
export type WidgetClass<T> = new (...args: unknown[]) => T;

/** A function, or its source. */
export type Func = ((...args: unknown[]) => unknown) | string;

/** Which screen a window is on. */
export type Screen = "primary" | "secondary";
/** What became of a request. */
export type Outcome =
    /** It went through. */
    | "done"
    /** The user declined it. */
    | "declined";

/** Window controls. */
export interface DemoWindowApi {
    /** Whether the window has the focus. */
    readonly focused: boolean;

    /** Where the window is. */
    screen: Screen;
    /** Who the window serves. */
    audience: Audience;
    /** Who the window served before. */
    previousAudience: Audience | null;

    /**
     * Resizes the window.
     *
     * @param options How to resize.
     * @returns Whether it resized.
     */
    resize(options: ResizeOptions): Promise<boolean>;

    /** Calls back when the window closes. */
    onClose(callback: (reason: string) => void): () => void;

    /** @deprecated Use {@link resize}. */
    maximize(): void;

    /** Reloads the window, e.g. after an update. Unsaved changes are lost. */
    reload(): void;

    /** Reads a stored value. */
    read<T extends string | number = string, K = string>(key: K): T | null;

    /**
     * Asks to close the window.
     *
     * @returns What became of the request.
     */
    requestClose(audience: Audience): Promise<Outcome>;
}

/** The root of the API. */
export interface DemoApi {
    /** Window controls, as \`DemoWindowApi\` lists them. */
    window: DemoWindowApi;
    /** The version, as in \`1.2.3\`. */
    readonly version: string;
}
`;

/** A second root, whose interface extends one of `FIXTURE`'s. */
const DOCKING = `
/** A window that can also be docked. */
export interface DockableWindowApi extends DemoWindowApi {
    /** Docks the window. */
    dock(): void;
}

export interface DockApi {
    window: DemoWindowApi;
    docked: DockableWindowApi;
}

export interface DockOnlyApi {
    docked: DockableWindowApi;
}
`;

const IMPORTED = `
/** Who a window serves. */
export type Audience = "user" | "guest";
`;

/** A heading's level and name, past the anchor the heading of a declaration starts with. */
const HEADING = /^(#+) (?:<a id="[^"]+"><\/a>)?`?(\w+)`?/gm;

describe("typeDocToMarkdown", () => {
    let dir: string;
    let project: Awaited<ReturnType<typeof runTypeDoc>>;
    let markdown: string;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "typedoc-markdown-"));
        await writeFile(join(dir, "api.ts"), FIXTURE);
        await writeFile(join(dir, "audience.ts"), IMPORTED);
        await writeFile(join(dir, "tsconfig.json"), JSON.stringify({
            compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
            files: [ "api.ts", "audience.ts" ]
        }));
        project = await runTypeDoc(join(dir, "api.ts"), join(dir, "tsconfig.json"));
        markdown = typeDocToMarkdown(project, { root: "DemoApi" });
    }, 60_000);

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    /** The row of the members table that documents `name`, which nested tables are part of. */
    const row = (name: string) => {
        const start = markdown.indexOf(`<td><code>${name}</code>`);
        expect(start).toBeGreaterThan(-1);
        return markdown.slice(start, markdown.indexOf("\n        </tr>", start));
    };

    it("opens with the package comment, then the root and what it reaches, in order of reference", () => {
        expect(markdown.startsWith("The demo API, exposed as `window.demoApi`.\n\n## <a id=\"type-DemoApi\"></a>`DemoApi`")).toBe(true);

        const headings = [ ...markdown.matchAll(HEADING) ].map(([ , level, name ]) => `${level} ${name}`);
        // The root and the interfaces with methods come first, and the types they use follow under
        // "Types". The exports the root never reaches belong to another page.
        expect(headings).toEqual([
            "## DemoApi", "## DemoWindowApi", "## Types",
            "### Audience", "### ResizeOptions", "### Outcome", "### Size"
        ]);
        expect(markdown).not.toContain("Unreached");
    });

    it("lists properties in a table, their type above their description", () => {
        expect(markdown).toContain([
            "## <a id=\"type-DemoApi\"></a>`DemoApi`",
            "",
            "The root of the API.",
            "",
            "| Property | Description |",
            "| --- | --- |",
            "| `window` | [`DemoWindowApi`](#type-DemoWindowApi)<br>Window controls, as [`DemoWindowApi`](#type-DemoWindowApi) lists them. |",
            "| `version` | `string`<br>The version, as in `1.2.3`. |"
        ].join("\n"));
        // An optional property says so under its name.
        expect(markdown).toContain("| `width` | [`Size`](#type-Size)<br>The new width. |");
        expect(markdown).toContain("| `animate`<br>*optional* | `boolean` |");
    });

    it("lists the members of an interface with methods in one HTML table, in the export's layout", () => {
        const section = markdown.slice(markdown.indexOf("`DemoWindowApi`\n"), markdown.indexOf("`ResizeOptions`\n"));
        expect(section).toContain([
            "<table>",
            "    <thead>",
            "        <tr>",
            "            <th>Member</th>",
            "            <th>Description</th>",
            "        </tr>",
            "    </thead>",
            "    <tbody>",
            "        <tr>",
            "            <td><code>focused</code></td>"
        ].join("\n"));
        // A blank line would end the HTML block when the page is imported.
        const table = section.slice(section.indexOf("<table>"), section.indexOf("</table>\n") + 8);
        expect(table).not.toMatch(/\n[ \t]*\n/);
        expect(row("focused")).toContain("<code>boolean</code><br>Whether the window has the focus.");
    });

    it("gives a method its signature and description, and parameters and return only when documented", () => {
        const resize = row("resize");
        expect(resize).toMatch(/<pre><code class="language-[^"]+">resize\(options: ResizeOptions\): Promise&lt;boolean&gt;<\/code><\/pre>/);
        expect(resize).toContain("<p>Resizes the window.</p>");
        expect(resize).toMatch(/<th>Parameter<\/th>.*<td><code>options<\/code><\/td><td><a href="#type-ResizeOptions"><code>ResizeOptions<\/code><\/a><br>How to resize.<\/td>/);
        expect(resize).toContain("<strong>Returns</strong> <code>Promise&lt;boolean&gt;</code>: Whether it resized.");

        // Without descriptions, the signature already says everything a table or a Returns line would.
        const onClose = row("onClose");
        expect(onClose).toContain("onClose(callback: (reason: string) =&gt; void): () =&gt; void");
        expect(onClose).not.toContain("<table>");
        expect(onClose).not.toContain("Returns");

        // A generic method declares its type parameters, with their constraints and defaults.
        expect(row("read")).toContain("read&lt;T extends string | number = string, K = string&gt;(key: K): T | null</code></pre>");
    });

    it("warns about a deprecated member and writes links as code", () => {
        expect(row("maximize")).toMatch(/<aside class="admonition warning">.*Deprecated. Use <code>resize<\/code>./);
        expect(markdown).toContain("Options of [`DemoWindowApi.resize`](#type-DemoWindowApi).");
    });

    it("links the types the page has a heading for, leaving the rest of the type as code", () => {
        expect(row("requestClose")).toContain("<strong>Returns</strong> <code>Promise&lt;</code><a href=\"#type-Outcome\">"
            + "<code>Outcome</code></a><code>&gt;</code>: What became of the request.");
        // The operators between a union's members stay outside the code, as on the ETAPI page.
        expect(row("previousAudience")).toContain(
            "<a href=\"#type-Audience\"><code>Audience</code></a> | <code>null</code><br>Who the window served before.");
        // A code block cannot hold a link, so a signature stays plain text.
        expect(row("requestClose")).toContain("requestClose(audience: Audience): Promise&lt;Outcome&gt;</code></pre>");
        // A union written out in place of its name has no heading to link to.
        expect(row("screen")).not.toContain("href");
    });

    it("writes a type alias as its declaration", () => {
        expect(markdown).toContain([
            "### <a id=\"type-Size\"></a>`Size`",
            "",
            "A size in pixels.",
            "",
            "```ts",
            "type Size = number | \"auto\"",
            "```"
        ].join("\n"));
    });

    it("inlines a union of literals that one member uses, with its description", () => {
        expect(markdown).not.toContain("Screen");
        expect(row("screen")).toContain(
            "<code>\"primary\" | \"secondary\"</code><br>Where the window is.<br>Which screen a window is on.");    });

    it("keeps an entry for a union used more than once, even one another module declares", () => {
        expect(row("audience")).toContain("<a href=\"#type-Audience\"><code>Audience</code></a>");
        expect(row("requestClose")).toContain("requestClose(audience: Audience): Promise&lt;Outcome&gt;");
        expect(markdown).toContain([
            "### <a id=\"type-Audience\"></a>`Audience`",
            "",
            "Who a window serves.",
            "",
            "```ts",
            "type Audience = \"user\" | \"guest\"",
            "```"
        ].join("\n"));
    });

    it("lists the values of a union whose values are documented", () => {
        expect(markdown).toContain([
            "### <a id=\"type-Outcome\"></a>`Outcome`",
            "",
            "What became of a request.",
            "",
            "| Value | Description |",
            "| --- | --- |",
            "| `\"done\"` | It went through. |",
            "| `\"declined\"` | The user declined it. |"
        ].join("\n"));
    });

    it("strips the configured prefixes from the names of the declarations it shows", () => {
        const stripped = typeDocToMarkdown(project, { root: "DemoApi", stripPrefixes: [ "Demo" ] });
        const headings = [ ...stripped.matchAll(HEADING) ].map(([ , , name ]) => name);
        expect(headings).toEqual([ "Api", "WindowApi", "Types", "Audience", "ResizeOptions", "Outcome", "Size" ]);
        expect(stripped).toContain("## <a id=\"type-WindowApi\"></a>`WindowApi`");
        // References, signatures, links and code spans that name a declaration follow it.
        expect(stripped).toContain(
            "| `window` | [`WindowApi`](#type-WindowApi)<br>Window controls, as [`WindowApi`](#type-WindowApi) lists them. |");
        expect(stripped).toContain("Options of [`WindowApi.resize`](#type-WindowApi).");
        expect(stripped).toContain("requestClose(audience: Audience): Promise&lt;Outcome&gt;");
        expect(stripped).not.toMatch(/Demo(Window)?Api/);
    });

    it("writes constructor types, the type parameters of an alias and function types in a union", () => {
        const exports = typeDocToMarkdown(project);
        expect(exports).toContain("type WidgetClass<T> = new (...args: unknown[]) => T");
        expect(exports).toContain("type Func = ((...args: unknown[]) => unknown) | string");
    });

    it("escapes the pipes of a table cell, leaving one escaped already as it is", () => {
        expect(typeDocToMarkdown(project)).toContain("| `separator` | `string`<br>Splits on a\\|b or c\\|d. |");
    });

    it("refuses prefixes that would give two declarations one name", () => {
        expect(() => typeDocToMarkdown(project, { root: "DemoApi", stripPrefixes: [ "Demo", "DemoWindow" ] }))
            .toThrow("DemoApi and DemoWindowApi would both be named Api");
    });
});

describe("typeDocToDeclarations", () => {
    let dir: string;
    let project: Awaited<ReturnType<typeof runTypeDoc>>;
    let declarations: string;

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "typedoc-declarations-"));
        await writeFile(join(dir, "api.ts"), FIXTURE + DOCKING);
        await writeFile(join(dir, "audience.ts"), IMPORTED);
        await writeFile(join(dir, "tsconfig.json"), JSON.stringify({
            compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
            files: [ "api.ts", "audience.ts" ]
        }));
        project = await runTypeDoc(join(dir, "api.ts"), join(dir, "tsconfig.json"));
        declarations = typeDocToDeclarations(project, { root: "DemoApi", stripPrefixes: [ "Demo" ] });
    }, 60_000);

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("writes the root and what it reaches as TypeScript, each member under its first sentence", () => {
        expect(declarations.startsWith([
            "/** The root of the API. */",
            "interface Api {",
            "    /** Window controls, as `WindowApi` lists them. */",
            "    window: WindowApi;",
            "    /** The version, as in `1.2.3`. */",
            "    readonly version: string;",
            "}"
        ].join("\n"))).toBe(true);
        expect(declarations).toContain([
            "    /** Resizes the window. */",
            "    resize(options: ResizeOptions): Promise<boolean>;"
        ].join("\n"));
        expect(declarations).toContain("    read<T extends string | number = string, K = string>(key: K): T | null;");
        expect(declarations).toContain("    /** Reloads the window, e.g. after an update. */\n    reload(): void;");
        expect(declarations).toContain("    animate?: boolean;");
        expect(declarations).toContain("/** A size in pixels. */\ntype Size = number | \"auto\";");
        expect(declarations).not.toContain("Unreached");
    });

    it("writes out a union of literals that one member uses, and links nothing", () => {
        expect(declarations).toContain("    screen: \"primary\" | \"secondary\";");
        expect(declarations).toContain("    audience: Audience;");
        expect(declarations).not.toContain("](#");
    });

    it("leaves out deprecated members", () => {
        expect(declarations).not.toContain("maximize");
    });

    it("declares an inherited member only on the interface it comes from, when that one is written too", () => {
        const docking = typeDocToDeclarations(project, { root: "DockApi" });
        expect(docking).toContain([
            "/** A window that can also be docked. */",
            "interface DockableWindowApi extends DemoWindowApi {",
            "    /** Docks the window. */",
            "    dock(): void;",
            "}"
        ].join("\n"));
        expect(docking.match(/ resize\(/g)).toHaveLength(1);

        // The selection does not follow `extends`, so without its parent the interface keeps them.
        const dockOnly = typeDocToDeclarations(project, { root: "DockOnlyApi" });
        expect(dockOnly).not.toContain("interface DemoWindowApi");
        expect(dockOnly.match(/ resize\(/g)).toHaveLength(1);
    });
});
