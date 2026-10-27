import { describe, expect, it } from "vitest";

import {
    getMarkdownNameFromCKEditorLanguage, getMimeTypeFromFileName, getMimeTypeFromMarkdownName,
    MIME_TYPE_AUTO, MIME_TYPES_DICT,
    normalizeMimeTypeForCKEditor, resolveEnabledMimeTypes, shouldSyntaxHighlight
} from "./mime_type.js";

describe("normalizeMimeTypeForCKEditor", () => {
    it("collapses non-word characters and underscores into single dashes", () => {
        expect(normalizeMimeTypeForCKEditor("text/x-c++src")).toBe("text-x-c-src");
        expect(normalizeMimeTypeForCKEditor("application/javascript;env=backend")).toBe("application-javascript-env-backend");
        expect(normalizeMimeTypeForCKEditor("a__b")).toBe("a-b");
    });

    it("lowercases the MIME type", () => {
        expect(normalizeMimeTypeForCKEditor("TEXT/HTML")).toBe("text-html");
        expect(normalizeMimeTypeForCKEditor("Text/X-CSrc")).toBe("text-x-csrc");
    });
});

describe("getMimeTypeFromMarkdownName", () => {
    it("returns the definition for a language tag with a single entry", () => {
        const result = getMimeTypeFromMarkdownName("css");
        expect(result).toBeDefined();
        expect(result?.mime).toBe("text/css");
        expect(result?.mdLanguageCode).toBe("css");
    });

    it("returns the first matching entry in dict order when multiple entries share a language tag", () => {
        const result = getMimeTypeFromMarkdownName("javascript");
        expect(result).toBeDefined();
        expect(result?.mdLanguageCode).toBe("javascript");
        // Plain "JavaScript" comes before the Trilium frontend/backend script variants in
        // the dictionary, so it wins — a markdown code fence is not a Trilium script.
        expect(result?.title).toBe("JavaScript");
        expect(result?.mime).toBe("text/javascript");
    });

    it("prefers the entry that lists the tag as an alias over earlier variants", () => {
        expect(getMimeTypeFromMarkdownName("java")?.mime).toBe("text/x-java");
        expect(getMimeTypeFromMarkdownName("json")?.mime).toBe("application/json");
        expect(getMimeTypeFromMarkdownName("sql")?.mime).toBe("text/x-sql");
    });

    it("resolves the alternative names used by Markdown fences, PrismJS and VS Code", () => {
        expect(getMimeTypeFromMarkdownName("bash")?.mime).toBe("text/x-sh");
        expect(getMimeTypeFromMarkdownName("shellscript")?.mime).toBe("text/x-sh");
        expect(getMimeTypeFromMarkdownName("ts")?.mime).toBe("application/typescript");
        expect(getMimeTypeFromMarkdownName("typescriptreact")?.mime).toBe("text/typescript-jsx");
        expect(getMimeTypeFromMarkdownName("jsonc")?.mime).toBe("application/json");
        expect(getMimeTypeFromMarkdownName("yml")?.mime).toBe("text/x-yaml");
        expect(getMimeTypeFromMarkdownName("php")?.mime).toBe("text/x-php");
        expect(getMimeTypeFromMarkdownName("clike")?.mime).toBe("text/x-csrc");
    });

    it("resolves the fence names of GitHub Linguist", () => {
        expect(getMimeTypeFromMarkdownName("scala")?.mime).toBe("text/x-scala");
        expect(getMimeTypeFromMarkdownName("restructuredtext")?.mime).toBe("text/x-rst");
        expect(getMimeTypeFromMarkdownName("rst")?.mime).toBe("text/x-rst");
        expect(getMimeTypeFromMarkdownName("matlab")?.mime).toBe("text/x-octave");
        expect(getMimeTypeFromMarkdownName("lhs")?.mime).toBe("text/x-literate-haskell");
        expect(getMimeTypeFromMarkdownName("jinja")?.mime).toBe("text/jinja2");
        expect(getMimeTypeFromMarkdownName("tex")?.mime).toBe("text/x-stex");
        expect(getMimeTypeFromMarkdownName("roff")?.mime).toBe("text/troff");
    });

    it("resolves the fence names of other highlighters for the languages GitHub lacks", () => {
        expect(getMimeTypeFromMarkdownName("mysql")?.mime).toBe("text/x-mysql");
        expect(getMimeTypeFromMarkdownName("tsql")?.mime).toBe("text/x-mssql");
        expect(getMimeTypeFromMarkdownName("cljs")?.mime).toBe("text/x-clojurescript");
        expect(getMimeTypeFromMarkdownName("ttcn3")?.mime).toBe("text/x-ttcn");
        expect(getMimeTypeFromMarkdownName("excel")?.mime).toBe("text/x-spreadsheet");
    });

    it("lets no alias take the mdLanguageCode of another entry", () => {
        for (const mimeType of MIME_TYPES_DICT) {
            if (mimeType.mdLanguageCode) {
                const resolved = getMimeTypeFromMarkdownName(mimeType.mdLanguageCode);
                expect(resolved?.mdLanguageCode, mimeType.mime).toBe(mimeType.mdLanguageCode);
            }
        }
    });

    it("lists each alias on one entry only", () => {
        const aliases = MIME_TYPES_DICT.flatMap((mimeType) => mimeType.aliases ?? []);
        expect(new Set(aliases).size).toBe(aliases.length);
    });

    it("returns undefined for an unknown language tag", () => {
        expect(getMimeTypeFromMarkdownName("definitely-not-a-language")).toBeUndefined();
    });

    it("returns the same cached reference across calls", () => {
        const first = getMimeTypeFromMarkdownName("css");
        const second = getMimeTypeFromMarkdownName("css");
        expect(second).toBe(first);
    });
});

describe("getMarkdownNameFromCKEditorLanguage", () => {
    it("keeps the last segment of the language when it resolves back", () => {
        expect(getMarkdownNameFromCKEditorLanguage("text-x-toml")).toBe("toml");
        expect(getMarkdownNameFromCKEditorLanguage("application-x-bat")).toBe("bat");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-vb")).toBe("vb");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-hcl")).toBe("hcl");
    });

    it("falls back to the mdLanguageCode or an alias when the segment resolves elsewhere", () => {
        expect(getMarkdownNameFromCKEditorLanguage("text-plain")).toBe("plaintext");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-csrc")).toBe("c");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-c-src")).toBe("cpp");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-rustsrc")).toBe("rust");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-nginx-conf")).toBe("nginx");
        expect(getMarkdownNameFromCKEditorLanguage("text-typescript-jsx")).toBe("tsx");
        expect(getMarkdownNameFromCKEditorLanguage("text-jinja2")).toBe("jinja");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-stex")).toBe("tex");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-mssql")).toBe("tsql");
        expect(getMarkdownNameFromCKEditorLanguage("text-x-spreadsheet")).toBe("excel");
    });

    it("returns undefined for an unknown language or one whose names resolve elsewhere", () => {
        expect(getMarkdownNameFromCKEditorLanguage("text-x-not-a-language")).toBeUndefined();
        expect(getMarkdownNameFromCKEditorLanguage(MIME_TYPE_AUTO)).toBeUndefined();
        expect(getMarkdownNameFromCKEditorLanguage("text-x-trilium-search")).toBeUndefined();
        // `sql` resolves to `text/x-sql`, not to the MariaDB dialect.
        expect(getMarkdownNameFromCKEditorLanguage("text-x-mariadb")).toBeUndefined();
    });

    it("returns for every language only a name that resolves back to it", () => {
        const named = MIME_TYPES_DICT.filter((mimeType) => {
            const language = normalizeMimeTypeForCKEditor(mimeType.mime);
            const name = getMarkdownNameFromCKEditorLanguage(language);
            if (name !== undefined) {
                expect(getMimeTypeFromMarkdownName(name), mimeType.mime).toBe(mimeType);
            }
            return name !== undefined;
        });
        expect(named.length).toBeGreaterThan(0);
    });

    it("relies on every MIME type normalizing to a distinct language", () => {
        const languages = MIME_TYPES_DICT.map((mimeType) =>
            normalizeMimeTypeForCKEditor(mimeType.mime));
        expect(new Set(languages).size).toBe(languages.length);
    });
});

describe("exports", () => {
    it("exposes the auto MIME type pseudo-value", () => {
        expect(MIME_TYPE_AUTO).toBe("text-x-trilium-auto");
    });

    it("exposes a non-empty frozen MIME types dictionary", () => {
        expect(Array.isArray(MIME_TYPES_DICT)).toBe(true);
        expect(MIME_TYPES_DICT.length).toBeGreaterThan(0);
        expect(Object.isFrozen(MIME_TYPES_DICT)).toBe(true);
    });
});

describe("getMimeTypeFromFileName", () => {
    it("names the language of a file by its extension, in any case", () => {
        expect([
            "app.js", "app.MJS", "types.ts", "script.py", "main.rb", "lib.rs", "Main.kt",
            "Program.cs", "header.h", "README.md", "page.htm", "build.ps1", "Dockerfile"
        ].map(getMimeTypeFromFileName)).toEqual([
            "text/javascript", "text/javascript", "application/typescript", "text/x-python",
            "text/x-ruby", "text/x-rustsrc", "text/x-kotlin", "text/x-csharp", "text/x-csrc",
            "text/x-gfm", "text/html", "application/x-powershell", "text/x-dockerfile"
        ]);
    });

    it("has no type for a file without a known language", () => {
        expect([ "notes.txt", "server.log", "archive", ".", "data.unknown" ]
            .map(getMimeTypeFromFileName)).toEqual(Array(5).fill(undefined));
    });
});

describe("resolveEnabledMimeTypes", () => {
    const enabledMimes = (enabled: readonly (string | null)[] | null | undefined) =>
        resolveEnabledMimeTypes(enabled).filter((mt) => mt.enabled).map((mt) => mt.mime);

    it("enables the listed MIME types plus text/plain, on copies of the dictionary", () => {
        expect(enabledMimes([ "text/x-python", null ])).toStrictEqual([ "text/plain", "text/x-python" ]);
        expect(enabledMimes([])).toStrictEqual([ "text/plain" ]);

        const mimeTypes = resolveEnabledMimeTypes([]);
        expect(mimeTypes).toHaveLength(MIME_TYPES_DICT.length);
        expect(mimeTypes[0]).not.toBe(MIME_TYPES_DICT[0]);
    });

    it("falls back to the default MIME types when nothing is configured", () => {
        for (const enabled of [ enabledMimes(null), enabledMimes(undefined) ]) {
            expect(enabled).toContain("text/x-python");
            expect(enabled).not.toContain("text/x-cobol");
        }
    });
});

describe("shouldSyntaxHighlight", () => {
    it("allows code up to 500 lines", () => {
        expect(shouldSyntaxHighlight("")).toBe(true);
        expect(shouldSyntaxHighlight(Array(500).fill("x").join("\n"))).toBe(true);
        expect(shouldSyntaxHighlight(Array(501).fill("x").join("\n"))).toBe(false);
    });

    it("allows code up to 50,000 characters, however few lines it has", () => {
        expect(shouldSyntaxHighlight("x".repeat(50_000))).toBe(true);
        expect(shouldSyntaxHighlight("x".repeat(50_001))).toBe(false);
    });
});
