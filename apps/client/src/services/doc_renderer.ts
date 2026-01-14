import type FNote from "../entities/fnote.js";
import { applyReferenceLinks } from "../widgets/type_widgets/text/read_only_helper.js";
import { getCurrentLanguage } from "./i18n.js";
import { formatCodeBlocks } from "./syntax_highlight.js";

export default function renderDoc(note: FNote) {
    return new Promise<JQuery<HTMLElement>>((resolve) => {
        const docName = note.getLabelValue("docName");
        const $content = $("<div>");

        if (docName) {
            // find doc based on language
            const url = getUrl(docName, getCurrentLanguage());
            $content.load(url, async (response, status) => {
                // fallback to english doc if no translation available
                if (status === "error") {
                    const fallbackUrl = getUrl(docName, "en");
                    $content.load(fallbackUrl, async () => {
                        await processContent(fallbackUrl, $content);
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
    $content.find("img").each((_i, el) => {
        const $img = $(el);
        $img.attr("src", `${dir}/${$img.attr("src")}`);
    });

    formatCodeBlocks($content);

    // Apply reference links.
    await applyReferenceLinks($content[0]);
}

function getUrl(docNameValue: string, language: string) {
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
        return `${window.glob.assetPath  }/..`;
    }
    return window.glob.assetPath;
}
