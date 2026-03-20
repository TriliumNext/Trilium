import type { CodeFormatter } from "./code_formatter.js";
import type { Plugin } from "prettier";

interface PrettierParserConfig {
    parser: string;
    plugins: () => Promise<(string | URL | Plugin)[]>;
}

const babelPlugins = () =>
    Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
    ]);

const typescriptPlugins = () =>
    Promise.all([
        import("prettier/plugins/typescript"),
        import("prettier/plugins/estree"),
    ]);

const postcssPlugins = () =>
    import("prettier/plugins/postcss").then((m) => [m]);

const LANGUAGE_MAP: Record<string, PrettierParserConfig> = {
    "application-javascript-env-frontend": { parser: "babel", plugins: babelPlugins },
    "application-javascript-env-backend": { parser: "babel", plugins: babelPlugins },
    "text-jsx": { parser: "babel", plugins: babelPlugins },
    "application-typescript": { parser: "typescript", plugins: typescriptPlugins },
    "text-typescript-jsx": { parser: "typescript", plugins: typescriptPlugins },
    "application-json": { parser: "json", plugins: babelPlugins },
    "text-css": { parser: "css", plugins: postcssPlugins },
    "text-x-less": { parser: "less", plugins: postcssPlugins },
    "text-x-scss": { parser: "scss", plugins: postcssPlugins },
    "text-html": {
        parser: "html",
        plugins: () => import("prettier/plugins/html").then((m) => [m]),
    },
    "text-x-yaml": {
        parser: "yaml",
        plugins: () => import("prettier/plugins/yaml").then((m) => [m]),
    },
    "text-x-markdown": {
        parser: "markdown",
        plugins: () => import("prettier/plugins/markdown").then((m) => [m]),
    },
};

export class PrettierFormatter implements CodeFormatter {
    readonly name = "Prettier";

    canFormat(language: string): boolean {
        return language in LANGUAGE_MAP;
    }

    async format(code: string, language: string): Promise<string> {
        const config = LANGUAGE_MAP[language];
        if (!config) {
            throw new Error(
                `PrettierFormatter: no parser config for language "${language}"`,
            );
        }

        const [prettier, plugins] = await Promise.all([
            import("prettier/standalone"),
            config.plugins(),
        ]);

        try {
            return await prettier.format(code, {
                parser: config.parser,
                plugins,
                tabWidth: 4,
                printWidth: 120,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Prettier: ${msg}`);
        }
    }
}
