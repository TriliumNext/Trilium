interface PrettierParserConfig {
    parser: string;
    plugins: () => Promise<unknown[]>;
}

export function getPrettierConfig(
    language: string,
): PrettierParserConfig | undefined {
    if (
        language.startsWith("application-javascript") ||
        language === "text-jsx"
    ) {
        return {
            parser: "babel",
            plugins: () =>
                Promise.all([
                    import("prettier/plugins/babel"),
                    import("prettier/plugins/estree"),
                ]),
        };
    }

    if (language.startsWith("text-typescript") || language === "text-tsx") {
        return {
            parser: "typescript",
            plugins: () =>
                Promise.all([
                    import("prettier/plugins/typescript"),
                    import("prettier/plugins/estree"),
                ]),
        };
    }

    const LANGUAGE_MAP: Record<string, PrettierParserConfig> = {
        "application-json": {
            parser: "json",
            plugins: () =>
                Promise.all([
                    import("prettier/plugins/babel"),
                    import("prettier/plugins/estree"),
                ]),
        },
        "text-css": {
            parser: "css",
            plugins: () => import("prettier/plugins/postcss").then((m) => [m]),
        },
        "text-x-less": {
            parser: "less",
            plugins: () => import("prettier/plugins/postcss").then((m) => [m]),
        },
        "text-x-scss": {
            parser: "scss",
            plugins: () => import("prettier/plugins/postcss").then((m) => [m]),
        },
        "text-html": {
            parser: "html",
            plugins: () => import("prettier/plugins/html").then((m) => [m]),
        },
        "text-xml": {
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
        "text-x-graphql": {
            parser: "graphql",
            plugins: () => import("prettier/plugins/graphql").then((m) => [m]),
        },
    };

    return LANGUAGE_MAP[language];
}

const STATIC_SUPPORTED_LANGUAGES = new Set([
    "application-json",
    "text-css",
    "text-x-less",
    "text-x-scss",
    "text-html",
    "text-xml",
    "text-x-yaml",
    "text-x-markdown",
    "text-x-graphql",
    "text-jsx",
    "text-tsx",
]);

export function isSupportedLanguage(language: string): boolean {
    if (STATIC_SUPPORTED_LANGUAGES.has(language)) {
        return true;
    }
    if (
        language.startsWith("application-javascript") ||
        language.startsWith("text-typescript")
    ) {
        return true;
    }
    return false;
}
