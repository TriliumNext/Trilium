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
    // Allow alphanumeric characters, spaces, underscores, hyphens, and forward slashes.
    const validDocNameRegex = /^[a-zA-Z0-9_/\- ]+$/;
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
    $content.find("img").each((i, el) => {
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

    const basePath = window.glob.isDev ? `${window.glob.assetPath  }/..` : window.glob.assetPath;
    return `${basePath}/doc_notes/${language}/${docNameValue}.html`;
}
