import { type CodeFormatter, FormatterRegistry } from "./code_formatter.js";
import { beforeEach, describe, expect, it } from "vitest";

function makeFormatter(
    name: string,
    supportedLanguages: string[],
): CodeFormatter {
    return {
        name,
        canFormat(language: string): boolean {
            return supportedLanguages.includes(language);
        },
        async format(code: string, _language: string): Promise<string> {
            return `[${name}] ${code}`;
        },
    };
}

function makeNeverFormatter(name = "NeverFormatter"): CodeFormatter {
    return makeFormatter(name, []);
}

describe("FormatterRegistry", () => {
    let registry: FormatterRegistry;

    beforeEach(() => {
        registry = new FormatterRegistry();
    });

    describe("initial state", () => {
        it("should have no formatters registered", () => {
            expect(registry.isLanguageSupported("javascript")).toBe(false);
        });

        it("should return undefined for getFormatterForLanguage when empty", () => {
            expect(
                registry.getFormatterForLanguage("typescript"),
            ).toBeUndefined();
        });
    });

    describe("isLanguageSupported", () => {
        it("should return false for an unknown language when formatters are registered", () => {
            registry.register(makeFormatter("A", ["javascript"]));

            expect(registry.isLanguageSupported("python")).toBe(false);
        });

        it("should return true for a language handled by a registered formatter", () => {
            registry.register(makeFormatter("A", ["javascript"]));

            expect(registry.isLanguageSupported("javascript")).toBe(true);
        });

        it("should return true when only one of many formatters handles the language", () => {
            registry.register(makeFormatter("A", ["css"]));
            registry.register(makeFormatter("B", ["html"]));

            expect(registry.isLanguageSupported("html")).toBe(true);
        });

        it("should return false when all registered formatters reject the language", () => {
            registry.register(makeNeverFormatter("X"));
            registry.register(makeNeverFormatter("Y"));

            expect(registry.isLanguageSupported("rust")).toBe(false);
        });
    });

    describe("getFormatterForLanguage", () => {
        it("should return undefined for an unregistered language", () => {
            registry.register(makeFormatter("A", ["javascript"]));

            expect(registry.getFormatterForLanguage("rust")).toBeUndefined();
        });

        it("should return the matching formatter for a registered language", () => {
            const formatter = makeFormatter("Prettier", ["typescript"]);
            registry.register(formatter);

            expect(registry.getFormatterForLanguage("typescript")).toBe(
                formatter,
            );
        });

        it("should return the first matching formatter when multiple formatters support the language", () => {
            const first = makeFormatter("First", ["javascript"]);
            const second = makeFormatter("Second", ["javascript"]);
            registry.register(first);
            registry.register(second);

            expect(registry.getFormatterForLanguage("javascript")).toBe(first);
        });

        it("should return the correct formatter when languages do not overlap", () => {
            const cssFormatter = makeFormatter("CSS", ["css"]);
            const jsFormatter = makeFormatter("JS", ["javascript"]);
            registry.register(cssFormatter);
            registry.register(jsFormatter);

            expect(registry.getFormatterForLanguage("css")).toBe(cssFormatter);
            expect(registry.getFormatterForLanguage("javascript")).toBe(
                jsFormatter,
            );
        });
    });

    describe("register", () => {
        it("should allow registering a single formatter", () => {
            registry.register(makeFormatter("A", ["json"]));

            expect(registry.isLanguageSupported("json")).toBe(true);
        });

        it("should allow registering multiple formatters independently", () => {
            registry.register(makeFormatter("A", ["json"]));
            registry.register(makeFormatter("B", ["yaml"]));

            expect(registry.isLanguageSupported("json")).toBe(true);
            expect(registry.isLanguageSupported("yaml")).toBe(true);
        });

        it("should give priority to the first registered formatter when both handle the same language", () => {
            const first = makeFormatter("First", ["scss"]);
            const second = makeFormatter("Second", ["scss"]);
            registry.register(first);
            registry.register(second);

            const resolved = registry.getFormatterForLanguage("scss");

            expect(resolved?.name).toBe("First");
        });

        it("should skip non-matching formatters and reach the one that matches", () => {
            const noMatch = makeNeverFormatter("NoMatch");
            const match = makeFormatter("Match", ["graphql"]);
            registry.register(noMatch);
            registry.register(match);

            expect(registry.getFormatterForLanguage("graphql")).toBe(match);
        });
    });

    describe("format", () => {
        it("should delegate to the matching formatter", async () => {
            registry.register(makeFormatter("F", ["javascript"]));

            const result = await registry.format("x", "javascript");

            expect(result).toBe("[F] x");
        });

        it("should delegate to the first matching formatter when multiple match", async () => {
            registry.register(makeFormatter("First", ["javascript"]));
            registry.register(makeFormatter("Second", ["javascript"]));

            const result = await registry.format("x", "javascript");

            expect(result).toBe("[First] x");
        });

        it("should reject with an error for an unsupported language", async () => {
            await expect(registry.format("x", "rust")).rejects.toThrow(
                "No formatter available for language: rust",
            );
        });

        it("should reject with an error when registry is empty", async () => {
            await expect(registry.format("x", "javascript")).rejects.toThrow(
                "No formatter available for language: javascript",
            );
        });
    });

    describe("canFormat delegation", () => {
        it("should delegate canFormat to each registered formatter in order", () => {
            const callLog: string[] = [];

            const trackingFormatter = (
                name: string,
                languages: string[],
            ): CodeFormatter => ({
                name,
                canFormat(language: string): boolean {
                    callLog.push(name);
                    return languages.includes(language);
                },
                async format(code: string): Promise<string> {
                    return code;
                },
            });

            const formatterA = trackingFormatter("A", []);
            const formatterB = trackingFormatter("B", ["markdown"]);
            registry.register(formatterA);
            registry.register(formatterB);

            registry.getFormatterForLanguage("markdown");

            expect(callLog).toEqual(["A", "B"]);
        });

        it("should stop delegation at the first formatter that handles the language", () => {
            const callLog: string[] = [];

            const trackingFormatter = (
                name: string,
                languages: string[],
            ): CodeFormatter => ({
                name,
                canFormat(language: string): boolean {
                    callLog.push(name);
                    return languages.includes(language);
                },
                async format(code: string): Promise<string> {
                    return code;
                },
            });

            const formatterA = trackingFormatter("A", ["html"]);
            const formatterB = trackingFormatter("B", ["html"]);
            registry.register(formatterA);
            registry.register(formatterB);

            registry.getFormatterForLanguage("html");

            // Array.prototype.find stops at the first truthy result, so B
            // should never be consulted.
            expect(callLog).toEqual(["A"]);
        });
    });

    describe("CodeFormatter interface contract", () => {
        it("should expose a readonly name property", () => {
            const formatter = makeFormatter("TestFormatter", ["javascript"]);

            expect(formatter.name).toBe("TestFormatter");
        });

        it("canFormat should return true for a supported language", () => {
            const formatter = makeFormatter("F", ["css", "scss"]);

            expect(formatter.canFormat("css")).toBe(true);
            expect(formatter.canFormat("scss")).toBe(true);
        });

        it("canFormat should return false for an unsupported language", () => {
            const formatter = makeFormatter("F", ["css"]);

            expect(formatter.canFormat("rust")).toBe(false);
        });

        it("format should return a promise that resolves to a string", async () => {
            const formatter = makeFormatter("F", ["javascript"]);

            const result = await formatter.format("const x = 1", "javascript");

            expect(typeof result).toBe("string");
        });

        it("format should resolve with the formatted output", async () => {
            const formatter = makeFormatter("F", ["javascript"]);

            const result = await formatter.format("const x = 1", "javascript");

            expect(result).toBe("[F] const x = 1");
        });

        it("format should preserve empty string input", async () => {
            const formatter = makeFormatter("F", ["javascript"]);

            const result = await formatter.format("", "javascript");

            expect(result).toBe("[F] ");
        });
    });
});
