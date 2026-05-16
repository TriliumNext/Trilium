import { unescapeHtml } from "../utils";

function handleH1(content: string, title: string) {
    let isFirstH1Handled = false;

    return content.replace(/<h1[^>]*>([^<]*)<\/h1>/gi, (match, text) => {
        text = unescapeHtml(text);
        const convertedContent = `<h2>${text}</h2>`;

        // strip away very first found h1 tag, if it matches the title
        if (!isFirstH1Handled) {
            isFirstH1Handled = true;
            return title.trim() === text.trim() ? "" : convertedContent;
        }

        return convertedContent;
    });
}

function extractHtmlTitle(content: string): string | null {
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : null;
}

export default {
    handleH1,
    extractHtmlTitle
};
