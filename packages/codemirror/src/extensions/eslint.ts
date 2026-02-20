import type { Linter } from "eslint-linter-browserify";

export async function lint(mimeType: string) {

    const Linter = (await import("eslint-linter-browserify")).Linter;
    const js = (await import("@eslint/js"));
    const globalDefinitions = (await import("globals"));

    let globals: Record<string, any> = {
        ...globalDefinitions.browser,
        api: "readonly",
        module: "readonly"
    };

    // Unsupported languages
    if (mimeType.startsWith("text/typescript")) {
        return [];
    }

    // Custom globals
    if (mimeType === "application/javascript;env=frontend") {
        globals = { ...globals, ...globalDefinitions.jquery };
    } else if (mimeType === "application/javascript;env=backend") {
        globals = { ...globals, ...globalDefinitions.nodeBuiltin };
    }

    const config: (Linter.LegacyConfig | Linter.Config | Linter.Config[]) = [
        js.configs.recommended,
        {
            languageOptions: {
                parserOptions: {
                    ecmaVersion: 2024
                },
                globals
            },
            rules: {
                "no-unused-vars": [ "warn", { vars: "local", args: "after-used" }]
            }
        }
    ];

    return {
        linter: new Linter(),
        config
    }
}
