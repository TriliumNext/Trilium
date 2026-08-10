import type FNote from "../entities/fnote.js";
import { applyReferenceLinks } from "../widgets/type_widgets/text/read_only_helper.js";
import { getCurrentLanguage } from "./i18n.js";
import { formatCodeBlocks } from "./syntax_highlight.js";

/**
 * Validates a docName to prevent path traversal attacks.
 *
 * A docName names one file directly under `doc_notes/<language>/`, so it is a plain slug with no
 * separators of any kind. The label is note data rather than trusted input, so anything else is
 * turned away instead of being reached for on disk.
 */
export function isValidDocName(docName: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(docName);
}

export default function renderDoc(note: FNote) {
    return new Promise<JQuery<HTMLElement>>((resolve) => {
        const docName = note.getLabelValue("docName");
        const $content = $("<div>");

        // find doc based on language
        const url = getUrl(docName, getCurrentLanguage());

        if (url) {
            $content.load(url, async (response, status) => {
                // fallback to english doc if no translation available
                if (status === "error") {
                    const fallbackUrl = getUrl(docName, "en");

                    /* v8 ignore next 8 -- the else branch is unreachable: fallbackUrl only differs from the primary url by language, so if the primary url was valid (we got here from a successful .load call) the "en" fallback url is valid too and never null */
                    if (fallbackUrl) {
                        $content.load(fallbackUrl, async () => {
                            await processContent($content);
                            resolve($content);
                        });
                    } else {
                        resolve($content);
                    }
                    return;
                }

                await processContent($content);
                resolve($content);
            });
        } else {
            resolve($content);
        }
    });
}

async function processContent($content: JQuery<HTMLElement>) {
    formatCodeBlocks($content);

    // Apply reference links.
    await applyReferenceLinks($content[0]);
}

function getUrl(docNameValue: string | null, language: string) {
    if (!docNameValue) return;

    if (!isValidDocName(docNameValue)) {
        console.error(`Invalid docName: ${docNameValue}`);
        return null;
    }

    return `${getBasePath()}/doc_notes/${language}/${docNameValue}.html`;
}

function getBasePath() {
    if (window.glob.isStandalone) {
        return `server-assets`;
    }
    if (window.glob.isDev) {
        return `${window.glob.assetPath}/..`;
    }
    return window.glob.assetPath;
}
