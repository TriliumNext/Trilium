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
    const validDocNameRegex = /^[a-zA-Z0-9_/\- ()]+$/;
    return validDocNameRegex.test(docName);
}

export default function renderDoc(note: FNote) {
    return new Promise<JQuery<HTMLElement>>((resolve) => {
        const docName = note.getLabelValue("docName");
        const docUrl = note.getLabelValue("docUrl");
        const $content = $("<div>");

        // TODO: temporary diagnostics for the standalone blank-doc issue — remove once resolved.
        console.log(`[doc-render] renderDoc note=${note.noteId} docName=${JSON.stringify(docName)} docUrl=${JSON.stringify(docUrl)} isStandalone=${window.glob.isStandalone} isDev=${window.glob.isDev}`);

        // In the standalone client the User Guide HTML is not bundled (only its searchable text is).
        // Those notes carry a `docUrl` and are embedded in a web view by the Doc widget, so there's no
        // local HTML to render here — resolve empty rather than fetching a file that isn't there (a
        // fetch would hit the SPA fallback, load the app shell with HTTP 200, and render blank).
        if (window.glob.isStandalone && docUrl) {
            console.log(`[doc-render] standalone + docUrl → resolving empty (Doc widget embeds a web view)`);
            resolve($content);
            return;
        }

        // find doc based on language
        const url = getUrl(docName, getCurrentLanguage());
        console.log(`[doc-render] fetching url=${JSON.stringify(url)}`);

        if (url) {
            $content.load(url, async (response, status) => {
                console.log(`[doc-render] load(${url}) status=${status} responseLength=${(response ?? "").length}`);
                // fallback to english doc if no translation available
                if (status === "error") {
                    const fallbackUrl = getUrl(docName, "en");
                    console.log(`[doc-render] primary errored → fallbackUrl=${JSON.stringify(fallbackUrl)}`);

                    /* v8 ignore next 8 -- the else branch is unreachable: fallbackUrl only differs from the primary url by language, so if the primary url was valid (we got here from a successful .load call) the "en" fallback url is valid too and never null */
                    if (fallbackUrl) {
                        $content.load(fallbackUrl, async (fbResponse, fbStatus) => {
                            console.log(`[doc-render] fallback load(${fallbackUrl}) status=${fbStatus} responseLength=${(fbResponse ?? "").length}`);
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
            console.log(`[doc-render] no url (invalid/empty docName) → resolving empty`);
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

    // CKEditor's table content styles are scoped to `.ck-content .table` (i.e. `figure.table > table`).
    // Exported docs contain bare `<table>` elements, so wrap them to match the read-only text view and
    // pick up borders, header shading and centering.
    $content.find("table").each((_i, el) => {
        const $table = $(el);
        if ($table.closest("figure.table").length) return;
        $table.wrap(`<figure class="table"></figure>`);
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
