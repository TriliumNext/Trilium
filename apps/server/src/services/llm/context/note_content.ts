import { sanitize } from '@triliumnext/core';

import becca from '../../../becca/becca.js';

// Define interfaces for JSON structures
interface CanvasElement {
    type: string;
    text?: string;

}

interface CanvasContent {
    elements?: CanvasElement[];

}

interface MindMapNode {
    text?: string;
    children?: MindMapNode[];

}

interface MindMapContent {
    root?: MindMapNode;

}

interface RelationMapNote {
    noteId: string;
    title?: string;
    name?: string;

}

interface RelationMapRelation {
    sourceNoteId: string;
    targetNoteId: string;
    name?: string;

}

interface RelationMapContent {
    notes?: RelationMapNote[];
    relations?: RelationMapRelation[];

}

interface GeoMapMarker {
    title?: string;
    lat: number;
    lng: number;
    description?: string;

}

interface GeoMapContent {
    markers?: GeoMapMarker[];

}

interface ErrorWithMessage {
    message: string;
}

/**
 * Get the content of a note
 */
export async function getNoteContent(noteId: string): Promise<string | null> {
    // Use Becca API to get note data
    const note = becca.getNote(noteId);

    if (!note) {
        return null;
    }

    try {
        // Get content using Becca API
        const content = String(await note.getContent() || "");

        return formatNoteContent(
            content,
            note.type,
            note.mime,
            note.title
        );
    } catch (error) {
        console.error(`Error getting content for note ${noteId}:`, error);
        return null;
    }
}

/**
 * Format the content of a note based on its type
 * Enhanced with better handling for large and specialized content types
 */
export function formatNoteContent(content: string, type: string, mime: string, title: string): string {
    let formattedContent = `# ${title}\n\n`;

    switch (type) {
        case 'text':
            // Remove HTML formatting for text notes
            formattedContent += sanitize.sanitizeHtml(content);
            break;

        case 'code':
            // For code, we'll handle this in code_handlers.ts
            // Just use basic formatting here
            formattedContent += `\`\`\`\n${  content  }\n\`\`\``;
            break;

        case 'canvas':
            if (mime === 'application/json') {
                try {
                    // Parse JSON content
                    const jsonContent = JSON.parse(content) as CanvasContent;

                    // Extract text elements from canvas
                    if (jsonContent.elements && Array.isArray(jsonContent.elements)) {
                        const texts = jsonContent.elements
                            .filter((element) => element.type === 'text' && element.text)
                            .map((element) => element.text as string);

                        formattedContent += `Canvas content:\n${  texts.join('\n')}`;
                    } else {
                        formattedContent += '[Empty canvas]';
                    }
                }
                catch (e) {
                    const error = e as ErrorWithMessage;
                    formattedContent += `[Error parsing canvas content: ${error.message}]`;
                }
            } else {
                formattedContent += '[Canvas content]';
            }
            break;

        case 'mindMap':
            if (mime === 'application/json') {
                try {
                    // Parse JSON content
                    const jsonContent = JSON.parse(content) as MindMapContent;

                    // Extract node text from mind map
                    const extractMindMapNodes = (node: MindMapNode): string[] => {
                        let texts: string[] = [];
                        if (node.text) {
                            texts.push(node.text);
                        }
                        if (node.children && Array.isArray(node.children)) {
                            for (const child of node.children) {
                                texts = texts.concat(extractMindMapNodes(child));
                            }
                        }
                        return texts;
                    };

                    if (jsonContent.root) {
                        formattedContent += `Mind map content:\n${  extractMindMapNodes(jsonContent.root).join('\n')}`;
                    } else {
                        formattedContent += '[Empty mind map]';
                    }
                }
                catch (e) {
                    const error = e as ErrorWithMessage;
                    formattedContent += `[Error parsing mind map content: ${error.message}]`;
                }
            } else {
                formattedContent += '[Mind map content]';
            }
            break;

        case 'relationMap':
            if (mime === 'application/json') {
                try {
                    // Parse JSON content
                    const jsonContent = JSON.parse(content) as RelationMapContent;

                    // Extract relation map entities and connections
                    let result = 'Relation map content:\n';

                    if (jsonContent.notes && Array.isArray(jsonContent.notes)) {
                        result += `Notes: ${  jsonContent.notes
                            .map((note) => note.title || note.name)
                            .filter(Boolean)
                            .join(', ')  }\n`;
                    }

                    if (jsonContent.relations && Array.isArray(jsonContent.relations)) {
                        result += `Relations: ${  jsonContent.relations
                            .map((rel) => {
                                const sourceNote = jsonContent.notes?.find((n) => n.noteId === rel.sourceNoteId);
                                const targetNote = jsonContent.notes?.find((n) => n.noteId === rel.targetNoteId);
                                const source = sourceNote ? (sourceNote.title || sourceNote.name) : 'unknown';
                                const target = targetNote ? (targetNote.title || targetNote.name) : 'unknown';
                                return `${source} → ${rel.name || ''} → ${target}`;
                            })
                            .join('; ')}`;
                    }

                    formattedContent += result;
                }
                catch (e) {
                    const error = e as ErrorWithMessage;
                    formattedContent += `[Error parsing relation map content: ${error.message}]`;
                }
            } else {
                formattedContent += '[Relation map content]';
            }
            break;

        case 'geoMap':
            if (mime === 'application/json') {
                try {
                    // Parse JSON content
                    const jsonContent = JSON.parse(content) as GeoMapContent;

                    let result = 'Geographic map content:\n';

                    if (jsonContent.markers && Array.isArray(jsonContent.markers)) {
                        if (jsonContent.markers.length > 0) {
                            result += jsonContent.markers
                                .map((marker) => {
                                    return `Location: ${marker.title || ''} (${marker.lat}, ${marker.lng})${marker.description ? ` - ${  marker.description}` : ''}`;
                                })
                                .join('\n');
                        } else {
                            result += 'Empty geographic map';
                        }
                    } else {
                        result += 'Empty geographic map';
                    }

                    formattedContent += result;
                }
                catch (e) {
                    const error = e as ErrorWithMessage;
                    formattedContent += `[Error parsing geographic map content: ${error.message}]`;
                }
            } else {
                formattedContent += '[Geographic map content]';
            }
            break;

        case 'mermaid':
            // Format mermaid diagrams as code blocks
            formattedContent += `\`\`\`mermaid\n${  content  }\n\`\`\``;
            break;

        case 'image':
        case 'file':
            formattedContent += `[${type} attachment]`;
            break;

        default:
            // For other notes, just use the content as is
            formattedContent += sanitize.sanitizeHtml(content);
    }

    return formattedContent;
}

/**
 * Sanitize HTML content to plain text
 */
export function sanitizeHtmlContent(html: string): string {
    if (!html) return '';

    // Use sanitizeHtml to remove all HTML tags
    let content = sanitize.sanitizeHtmlCustom(html, {
        allowedTags: [],
        allowedAttributes: {},
        textFilter: (text) => {
            // Replace multiple newlines with a single one
            return text.replace(/\n\s*\n/g, '\n\n');
        }
    });

    // Additional cleanup for any remaining HTML entities
    content = content
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

    return content;
}
