import type { CodeFormatter } from "./code_formatter";
import {
    LANG_JAVASCRIPT_FRONTEND,
    LANG_JAVASCRIPT_BACKEND,
    LANG_TYPESCRIPT,
    LANG_TYPESCRIPT_JSX,
    LANG_JSX,
    LANG_JSON,
    LANG_CSS,
    LANG_LESS,
    LANG_SCSS,
    LANG_HTML,
    LANG_YAML,
    LANG_MARKDOWN,
    LANG_GRAPHQL,
} from "./languages";
import type { Plugin } from "prettier";

interface PrettierParserConfig {
    parser: string;
    plugins: () => Promise<(string | URL | Plugin<any>)[]>;
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
    [LANG_JAVASCRIPT_FRONTEND]: { parser: "babel", plugins: babelPlugins },
    [LANG_JAVASCRIPT_BACKEND]: { parser: "babel", plugins: babelPlugins },
    [LANG_JSX]: { parser: "babel", plugins: babelPlugins },
    [LANG_TYPESCRIPT]: { parser: "typescript", plugins: typescriptPlugins },
    [LANG_TYPESCRIPT_JSX]: { parser: "typescript", plugins: typescriptPlugins },
    [LANG_JSON]: { parser: "json", plugins: babelPlugins },
    [LANG_CSS]: { parser: "css", plugins: postcssPlugins },
    [LANG_LESS]: { parser: "less", plugins: postcssPlugins },
    [LANG_SCSS]: { parser: "scss", plugins: postcssPlugins },
    [LANG_HTML]: {
        parser: "html",
        plugins: () => import("prettier/plugins/html").then((m) => [m]),
    },
    [LANG_YAML]: {
        parser: "yaml",
        plugins: () => import("prettier/plugins/yaml").then((m) => [m]),
    },
    [LANG_MARKDOWN]: {
        parser: "markdown",
        plugins: () => import("prettier/plugins/markdown").then((m) => [m]),
    },
    [LANG_GRAPHQL]: {
        parser: "graphql",
        plugins: () => import("prettier/plugins/graphql").then((m) => [m]),
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

        const formatted = await prettier.format(code, {
            parser: config.parser,
            plugins: plugins,
            tabWidth: 4,
            printWidth: 120,
        });

        return formatted;
    }
}
