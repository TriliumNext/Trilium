import hljs from "highlight.js";
import { normalizeMimeTypeForCKEditor, type MimeType } from "@triliumnext/commons";
import syntaxDefinitions from "./syntax_highlighting.js";
import { type Theme } from "./themes.js";
import { type HighlightOptions } from "highlight.js";
export type { HighlightResult, AutoHighlightResult } from "highlight.js";

export { default as Themes, type Theme } from "./themes.js";

const registeredMimeTypes = new Set<string>();
const unsupportedMimeTypes = new Set<string>();
let highlightingThemeEl: HTMLStyleElement | null = null;

export async function ensureMimeTypes(mimeTypes: MimeType[]) {
    for (const mimeType of mimeTypes) {
        if (!mimeType.enabled) {
            continue;
        }

        const mime = normalizeMimeTypeForCKEditor(mimeType.mime);
        if (registeredMimeTypes.has(mime)) {
            continue;
        }

        registeredMimeTypes.add(mime);
        const loader = syntaxDefinitions[mime];
        if (!loader) {
            unsupportedMimeTypes.add(mime);
            continue;
        }

        const language = (await loader()).default;
        hljs.registerLanguage(mime, language);
    }
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

    let themeCss = (await theme.load()).default as string;

    // Increase the specificity of the HLJS selector to render properly within CKEditor without the need of patching the library.
    themeCss = themeCss.replace(/^.hljs {/m, ".hljs, .ck-content pre.hljs {");

    highlightingThemeEl.textContent = themeCss;
}

export const { highlightAuto } = hljs;
