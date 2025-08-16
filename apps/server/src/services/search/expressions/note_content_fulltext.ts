"use strict";

import type { NoteRow } from "@triliumnext/commons";
import type SearchContext from "../search_context.js";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import log from "../../log.js";
import becca from "../../../becca/becca.js";
import protectedSessionService from "../../protected_session.js";
import striptags from "striptags";
import { normalize } from "../../utils.js";
import sql from "../../sql.js";
import blobStorageService from "../../blob-storage.js";

const ALLOWED_OPERATORS = new Set(["=", "!=", "*=*", "*=", "=*", "%="]);

const cachedRegexes: Record<string, RegExp> = {};

function getRegex(str: string): RegExp {
    if (!(str in cachedRegexes)) {
        cachedRegexes[str] = new RegExp(str, "ms"); // multiline, dot-all
    }

    return cachedRegexes[str];
}

interface ConstructorOpts {
    tokens: string[];
    raw?: boolean;
    flatText?: boolean;
}

type SearchRow = Pick<NoteRow, "noteId" | "type" | "mime" | "content" | "isProtected"> & { contentLocation: string };

class NoteContentFulltextExp extends Expression {
    private operator: string;
    tokens: string[];
    private raw: boolean;
    private flatText: boolean;

    constructor(operator: string, { tokens, raw, flatText }: ConstructorOpts) {
        super();

        this.operator = operator;
        this.tokens = tokens;
        this.raw = !!raw;
        this.flatText = !!flatText;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        if (!ALLOWED_OPERATORS.has(this.operator)) {
            searchContext.addError(`Note content can be searched only with operators: ${Array.from(ALLOWED_OPERATORS).join(", ")}, operator ${this.operator} given.`);

            return inputNoteSet;
        }

        const resultNoteSet = new NoteSet();

        for (const row of sql.iterateRows<SearchRow>(`
                SELECT noteId, type, mime, content, isProtected, contentLocation
                FROM notes JOIN blobs USING (blobId)
                WHERE type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap') AND isDeleted = 0`)) {
            this.findInText(row, inputNoteSet, resultNoteSet);
        }

        return resultNoteSet;
    }

    findInText({ noteId, isProtected, content, type, mime, contentLocation }: SearchRow, inputNoteSet: NoteSet, resultNoteSet: NoteSet) {
        if (!inputNoteSet.hasNoteId(noteId) || !(noteId in becca.notes)) {
            return;
        }

        let rawContent: string | Buffer | null = blobStorageService.getContent({ content: content ?? null, contentLocation });

        if (isProtected) {
            if (!protectedSessionService.isProtectedSessionAvailable() || !rawContent || typeof rawContent !== "string") {
                return;
            }

            try {
                rawContent = protectedSessionService.decrypt(rawContent);
            } catch (e) {
                log.info(`Cannot decrypt content of note ${noteId}`);
                return;
            }
        }

        if (!rawContent) {
            return;
        }

        rawContent = this.preprocessContent(rawContent, type, mime);

        if (this.tokens.length === 1) {
            const [token] = this.tokens;

            if (
                (this.operator === "=" && token === rawContent) ||
                (this.operator === "!=" && token !== rawContent) ||
                (this.operator === "*=" && rawContent.endsWith(token)) ||
                (this.operator === "=*" && rawContent.startsWith(token)) ||
                (this.operator === "*=*" && rawContent.includes(token)) ||
                (this.operator === "%=" && getRegex(token).test(rawContent))
            ) {
                resultNoteSet.add(becca.notes[noteId]);
            }
        } else {
            const nonMatchingToken = this.tokens.find(
                (token) =>
                    !rawContent?.includes(token) &&
                    // in case of default fulltext search, we should consider both title, attrs and content
                    // so e.g. "hello world" should match when "hello" is in title and "world" in content
                    (!this.flatText || !becca.notes[noteId].getFlatText().includes(token))
            );

            if (!nonMatchingToken) {
                resultNoteSet.add(becca.notes[noteId]);
            }
        }

        return rawContent;
    }

    preprocessContent(content: string | Buffer, type: string, mime: string) {
        content = normalize(content.toString());

        if (type === "text" && mime === "text/html") {
            if (!this.raw && content.length < 20000) {
                // striptags is slow for very large notes
                content = this.stripTags(content);
            }

            content = content.replace(/&nbsp;/g, " ");
        } else if (type === "mindMap" && mime === "application/json") {
            content = processMindmapContent(content);
        } else if (type === "canvas" && mime === "application/json") {
            interface Element {
                type: string;
                text?: string; // Optional since not all objects have a `text` property
                id: string;
                [key: string]: any; // Other properties that may exist
            }

            let canvasContent = JSON.parse(content);
            const elements: Element[] = canvasContent.elements;
            const texts = elements
                .filter((element: Element) => element.type === "text" && element.text) // Filter for 'text' type elements with a 'text' property
                .map((element: Element) => element.text!); // Use `!` to assert `text` is defined after filtering

            content = normalize(texts.toString());
        }

        return content.trim();
    }

    stripTags(content: string) {
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
}

export function processMindmapContent(content: string) {
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

export default NoteContentFulltextExp;
