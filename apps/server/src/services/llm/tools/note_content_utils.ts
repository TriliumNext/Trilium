import markdownService from '../../import/markdown.js';

const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i;
const MARKDOWN_PATTERNS: RegExp[] = [
    /^#{1,6}\s+/m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /```[\s\S]*```/m,
    /\[[^\]]+\]\([^)]+\)/m,
    /^\s*>\s+/m
];

export function normalizeTextNoteContent(
    content: string,
    title: string,
    noteType: string,
    noteMime: string
): { content: string; converted: boolean } {
    if (noteType !== 'text' || noteMime !== 'text/html') {
        return { content, converted: false };
    }

    const trimmed = content.trim();
    if (!trimmed || HTML_TAG_PATTERN.test(trimmed)) {
        return { content, converted: false };
    }

    const looksLikeMarkdown = MARKDOWN_PATTERNS.some((pattern) => pattern.test(trimmed));
    if (!looksLikeMarkdown) {
        return { content, converted: false };
    }

    return {
        content: markdownService.renderToHtml(content, title),
        converted: true
    };
}
