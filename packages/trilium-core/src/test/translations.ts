import i18next from "i18next";

/**
 * Runs `run` while the server catalogue of the current language holds `texts` instead of its own
 * strings, so that a spec can tell a message read through `t()` from a hardcoded one.
 */
export async function withServerTexts<T>(
    texts: Record<string, string>,
    run: () => T | Promise<T>
): Promise<T> {
    const language = i18next.language;
    const originals = Object.keys(texts).map((key) =>
        [ key, i18next.getResource(language, "server", key) as string ] as const);
    for (const [ key, text ] of Object.entries(texts)) {
        i18next.addResource(language, "server", key, text);
    }

    try {
        return await run();
    } finally {
        for (const [ key, original ] of originals) {
            i18next.addResource(language, "server", key, original);
        }
    }
}
