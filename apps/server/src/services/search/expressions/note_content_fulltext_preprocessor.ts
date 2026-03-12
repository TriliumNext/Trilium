import striptags from "striptags";

import { normalize } from "../../utils.js";

export default function preprocessContent(content: string | Buffer, type: string, mime: string, raw?: boolean) {
    content = normalize(content.toString());

    if (type === "text" && mime === "text/html") {
        if (!raw) {
            // Content size already filtered at DB level, safe to process
            content = stripTags(content);
        }

        content = content.replace(/&nbsp;/g, " ");
    } else if (type === "mindMap" && mime === "application/json") {
        content = processMindmapContent(content);
    } else if (type === "canvas" && mime === "application/json") {
        content = processCanvasContent(content);
    }

    return content.trim();
}

function processMindmapContent(content: string) {
    let mindMapcontent;

    try {
        mindMapcontent = JSON.parse(content);
    } catch (e) {
        return "";
    }

    // Define interfaces for the JSON structure
    interface MindmapNode {
        id: string;
        topic: string;
        children: MindmapNode[]; // Recursive structure
        direction?: number;
        expanded?: boolean;
    }

    interface MindmapData {
        nodedata: MindmapNode;
        arrows: any[]; // If you know the structure, replace `any` with the correct type
        summaries: any[];
        direction: number;
        theme: {
            name: string;
            type: string;
            palette: string[];
            cssvar: Record<string, string>; // Object with string keys and string values
        };
    }

    // Recursive function to collect all topics
    function collectTopics(node?: MindmapNode): string[] {
        if (!node) {
            return [];
        }

        // Collect the current node's topic
        let topics = [node.topic];

        // If the node has children, collect topics recursively
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                topics = topics.concat(collectTopics(child));
            }
        }

        return topics;
    }

    // Start extracting from the root node
    const topicsArray = collectTopics(mindMapcontent.nodedata);

    // Combine topics into a single string
    const topicsString = topicsArray.join(", ");

    return normalize(topicsString.toString());
}

function processCanvasContent(content: string) {
    interface Element {
        type: string;
        text?: string; // Optional since not all objects have a `text` property
        id: string;
        [key: string]: any; // Other properties that may exist
    }

    let canvasContent;
    try {
        canvasContent = JSON.parse(content);
    } catch (e) {
        return "";
    }
    const elements = canvasContent.elements;

    if (Array.isArray(elements)) {
        const texts = elements
            .filter((element: Element) => element.type === "text" && element.text) // Filter for 'text' type elements with a 'text' property
            .map((element: Element) => element.text!); // Use `!` to assert `text` is defined after filtering

        content = normalize(texts.join(" "));
    } else {
        content = "";
    }
    return content;
}

function stripTags(content: string) {
    // we want to allow link to preserve URLs: https://github.com/zadam/trilium/issues/2412
    // we want to insert space in place of block tags (because they imply text separation)
    // but we don't want to insert text for typical formatting inline tags which can occur within one word
    const linkTag = "a";
    const inlineFormattingTags = ["b", "strong", "em", "i", "span", "big", "small", "font", "sub", "sup"];

    // replace tags which imply text separation with a space
    content = striptags(content, [linkTag, ...inlineFormattingTags], " ");

    // replace the inline formatting tags (but not links) without a space
    content = striptags(content, [linkTag], "");

    // at least the closing link tag can be easily stripped
    return content.replace(/<\/a>/gi, "");
}
