import type FNote from "../entities/fnote.js";
import { applyReferenceLinks } from "../widgets/type_widgets/text/read_only_helper.js";
import { getCurrentLanguage } from "./i18n.js";
import { formatCodeBlocks } from "./syntax_highlight.js";

export default function renderDoc(note: FNote) {
    return new Promise<JQuery<HTMLElement>>((resolve) => {
        let docName = note.getLabelValue("docName");
        const $content = $("<div>");

        if (docName) {
            // Sanitize docName to prevent path traversal attacks (e.g.,
            // "../../../../api/notes/_malicious/open?x=" escaping doc_notes).
            docName = sanitizeDocName(docName);
            if (!docName) {
                console.warn("Blocked potentially malicious docName attribute value.");
                resolve($content);
                return;
            }

            // find doc based on language
            const url = getUrl(docName, getCurrentLanguage());
            $content.load(url, async (response, status) => {
                // fallback to english doc if no translation available
                if (status === "error") {
                    const fallbackUrl = getUrl(docName, "en");
                    $content.load(fallbackUrl, async () => {
                        await processContent(fallbackUrl, $content)
                        resolve($content);
                    });
                    return;
                }

                await processContent(url, $content);
                resolve($content);
            });
        } else {
            resolve($content);
        }

        return $content;
    });
}

async function processContent(url: string, $content: JQuery<HTMLElement>) {
    const dir = url.substring(0, url.lastIndexOf("/"));

    // Images are relative to the docnote but that will not work when rendered in the application since the path breaks.
    $content.find("img").each((i, el) => {
        const $img = $(el);
        $img.attr("src", dir + "/" + $img.attr("src"));
    });

    formatCodeBlocks($content);

    // Apply reference links.
    await applyReferenceLinks($content[0]);
}

function sanitizeDocName(docNameValue: string): string | null {
    // Strip any path traversal sequences and dangerous URL characters.
    // Legitimate docName values are simple paths like "User Guide/Topic" or
    // "launchbar_intro" — they only contain alphanumeric chars, underscores,
    // hyphens, spaces, and forward slashes for subdirectories.
    // Reject values containing path traversal (../, ..\) or URL control
    // characters (?, #, :, @) that could be used to escape the doc_notes
    // directory or manipulate the resulting URL.
    if (/\.\.|[?#:@\\]/.test(docNameValue)) {
        return null;
    }

    // Remove any leading slashes to prevent absolute path construction.
    docNameValue = docNameValue.replace(/^\/+/, "");

    // After stripping, ensure only safe characters remain:
    // alphanumeric, spaces, underscores, hyphens, forward slashes, and periods
    // (periods are allowed for filenames but .. was already rejected above).
    if (!/^[a-zA-Z0-9 _\-/.']+$/.test(docNameValue)) {
        return null;
    }

    return docNameValue;
}

function getUrl(docNameValue: string, language: string) {
    // Cannot have spaces in the URL due to how JQuery.load works.
    docNameValue = docNameValue.replaceAll(" ", "%20");

    const basePath = window.glob.isDev ? window.glob.assetPath + "/.." : window.glob.assetPath;
    return `${basePath}/doc_notes/${language}/${docNameValue}.html`;
}
