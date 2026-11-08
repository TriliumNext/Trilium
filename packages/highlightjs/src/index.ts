import hljs from "highlight.js/lib/core";
import { normalizeMimeTypeForCKEditor, type MimeType } from "@triliumnext/commons";
import syntaxDefinitions from "./syntax_highlighting.js";
import { type Theme } from "./themes.js";
import { type HighlightOptions } from "highlight.js";
export type { HighlightResult, AutoHighlightResult } from "highlight.js";

export { default as Themes, type Theme, type ThemeVariant, getThemeVariant } from "./themes.js";

const registeredMimeTypes = new Set<string>();
const unsupportedMimeTypes = new Set<string>();
let highlightingThemeEl: HTMLStyleElement | null = null;
let lastSync: Promise<void> = Promise.resolve();

export async function ensureMimeTypes(mimeTypes: MimeType[]) {
    for (const mimeType of mimeTypes) {
        if (!mimeType.enabled) {
            continue;
        }

        const mime = normalizeMimeTypeForCKEditor(mimeType.mime);
        if (registeredMimeTypes.has(mime)) {
            continue;
        }

        const loader = syntaxDefinitions[mime];
        if (!loader) {
            unsupportedMimeTypes.add(mime);
            continue;
        }

        const language = (await loader()).default;
        hljs.registerLanguage(mime, language);
        registeredMimeTypes.add(mime);
    }
}

/**
 * Makes the registered languages match `mimeTypes`: registers the enabled ones, like
 * {@link ensureMimeTypes}, and unregisters the disabled ones that are registered. Calls run one
 * after another, so a language import still pending from an earlier call cannot register a
 * language that a later call disabled.
 */
export function syncMimeTypes(mimeTypes: MimeType[]): Promise<void> {
    const sync = lastSync.then(() => applyMimeTypes(mimeTypes));
    lastSync = sync.catch(() => undefined);
    return sync;
}

async function applyMimeTypes(mimeTypes: MimeType[]) {
    for (const mimeType of mimeTypes) {
        const mime = normalizeMimeTypeForCKEditor(mimeType.mime);
        if (!mimeType.enabled && registeredMimeTypes.has(mime)) {
            hljs.unregisterLanguage(mime);
            registeredMimeTypes.delete(mime);
        }
    }

    await ensureMimeTypes(mimeTypes);
}

export function highlight(code: string, options: HighlightOptions) {
    if (unsupportedMimeTypes.has(options.language)) {
        return null;
    }

    if (!registeredMimeTypes.has(options.language)) {
        console.warn(`Unable to find highlighting for ${options.language}.`);
        return null;
    }

    return hljs.highlight(code, options);
}

export function normalizeThemeCss(themeCss: string): string {
    const themeSelectorScopedToCodeTag = /\bcode\s+\.hljs-/.test(themeCss);
    if (themeSelectorScopedToCodeTag) {
        themeCss = themeCss.replace(/\bcode\.hljs/g, ".hljs");
        themeCss = themeCss.replace(/\bcode\s+\.hljs-/g, ".hljs .hljs-");
    }

    // Increase the specificity of the HLJS selector to render properly within CKEditor without the need of patching the library.
    themeCss = themeCss.replace(
        /^\.hljs\s*\{/m,
        ".hljs, .ck-content pre.hljs {",
    );

    return themeCss;
}

export async function loadTheme(theme: "none" | Theme) {
    if (theme === "none") {
        if (highlightingThemeEl) {
            highlightingThemeEl.remove();
            highlightingThemeEl = null;
        }
        return;
    }

    if (!highlightingThemeEl) {
        highlightingThemeEl = document.createElement("style");
        document.querySelector("head")?.append(highlightingThemeEl);
    }

    const themeCss = (await theme.load()).default as string;
    highlightingThemeEl.textContent = normalizeThemeCss(themeCss);
}

export const { getLanguage, highlightAuto } = hljs;
