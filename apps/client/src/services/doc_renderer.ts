import type FNote from "../entities/fnote.js";
import { applyReferenceLinks } from "../widgets/type_widgets/text/read_only_helper.js";
import { getCurrentLanguage } from "./i18n.js";
import { formatCodeBlocks } from "./syntax_highlight.js";

/**
 * Validates a docName to prevent path traversal attacks.
 * Allows forward slashes for subdirectories (e.g., "User Guide/Quick Start")
 * but blocks traversal sequences and URL manipulation characters.
 */
export function isValidDocName(docName: string): boolean {
    // Allow alphanumeric characters, spaces, underscores, hyphens, ampersands, and forward slashes.
    const validDocNameRegex = /^[a-zA-Z0-9_/\- ()&]+$/;
    return validDocNameRegex.test(docName);
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
                            await processContent(fallbackUrl, $content);
                            resolve($content);
                        });
                    } else {
                        resolve($content);
                    }
                    return;
                }

                await processContent(url, $content);
                resolve($content);
            });
        } else {
            resolve($content);
        }
    });
}

async function processContent(url: string, $content: JQuery<HTMLElement>) {
    const dir = url.substring(0, url.lastIndexOf("/"));

    // Images are relative to the docnote but that will not work when rendered in the application since the path breaks.
    $content.find("img").each((_i, el) => {
        const $img = $(el);
        $img.attr("src", `${dir}/${$img.attr("src")}`);
    });

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

    // Cannot have spaces in the URL due to how JQuery.load works.
    docNameValue = docNameValue.replaceAll(" ", "%20");
    // Percent-encode ampersands (e.g. in "Import & Export") so they aren't misread when fetching the doc.
    docNameValue = docNameValue.replaceAll("&", "%26");
    // The user guide is available only in English, so make sure we are requesting correctly since 404s in standalone client are treated differently.
    if (docNameValue.includes("User%20Guide")) language = "en";
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
