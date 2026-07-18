import type { LinkEmbedMetadata } from "@triliumnext/commons";
import { BlockQuote, ClassicEditor, Essentials, Heading, Link, List, Paragraph, Undo, _setModelData as setModelData } from "ckeditor5";
import { vi } from "vitest";

import LinkEmbed, { CHANGE_LINK_DISPLAY_COMMAND } from "../src/plugins/link_embed/link_embed.js";
import { createTestEditor } from "./editor-kit.js";
import { installGlobMock } from "./globals-test-kit.js";

export { createTestEditor } from "./editor-kit.js";

/**
 * Shared fixtures for the link_embed specs: the mocked host component, the editor plugin list, and
 * the model-manipulation helpers that simulate what AutoLink does.
 */

export const META = {
    url: "https://example.com/",
    // The host only ever reports "youtube" or "opengraph". It matters here that this is the real
    // thing: chooseLinkPreviewKind() treats anything other than "opengraph" as embeddable, so a made-up
    // type would send a URL standing alone in its block down the block-embed path instead of the mention one.
    embedType: "opengraph",
    title: "Example title",
    description: "Some description",
    favicon: "https://example.com/favicon.ico",
    siteName: "Example",
    image: "https://example.com/image.png"
} satisfies LinkEmbedMetadata;

export interface LinkEmbedComponentMocks {
    triggerCommand: ReturnType<typeof vi.fn>;
    renderLinkEmbed: ReturnType<typeof vi.fn>;
    renderLinkMention: ReturnType<typeof vi.fn>;
    fetchLinkMetadata: ReturnType<typeof vi.fn>;
    detectEmbedType: ReturnType<typeof vi.fn>;
}

/**
 * Installs the glob mock every link_embed editor resolves its host component from, and returns the
 * individual mocks for assertions. Call from `beforeEach`, before creating the editor.
 */
export function installLinkEmbedComponentMock(): LinkEmbedComponentMocks {
    const mocks: LinkEmbedComponentMocks = {
        triggerCommand: vi.fn(),
        renderLinkEmbed: vi.fn(),
        renderLinkMention: vi.fn(),
        fetchLinkMetadata: vi.fn(async (url: string) => ({ ...META, url })),
        // YouTube-like URLs => "youtube" (embeddable); everything else => "opengraph".
        detectEmbedType: vi.fn((url: string) => (url.includes("youtube") ? "youtube" : "opengraph"))
    };

    installGlobMock({
        getComponentByEl: () => mocks
    });

    return mocks;
}

/**
 * The plugin list the link_embed specs build their editors from. Heading, List and BlockQuote are
 * loaded so the placement rules (which keep a URL inline inside a heading, list item, table cell or
 * quote) can be exercised against a real schema.
 */
export const LINK_EMBED_TEST_PLUGINS = [Essentials, Paragraph, Heading, List, BlockQuote, Link, Undo, LinkEmbed];

/**
 * Editor config entries the host supplies but the CKEditor config type does not declare — the host
 * sets them through the same kind of cast (see the client's `buildConfig`).
 */
export function hostConfig(entries: Record<string, unknown>): Parameters<typeof createTestEditor>[1] {
    return entries as Parameters<typeof createTestEditor>[1];
}

export function changeCommand(editor: ClassicEditor): {
    isEnabled: boolean;
    value: string | null;
    embedAvailable: boolean;
    url: string | null;
} {
    const command = editor.commands.get(CHANGE_LINK_DISPLAY_COMMAND);
    if (!command) {
        throw new Error("changeLinkDisplay command is not registered.");
    }
    return command as unknown as { isEnabled: boolean; value: string | null; embedAvailable: boolean; url: string | null };
}

export function findElement(editor: ClassicEditor, name: string) {
    const root = editor.model.document.getRoot();
    if (!root) {
        return undefined;
    }
    const range = editor.model.createRangeIn(root);
    for (const item of range.getWalker()) {
        if (item.item.is("element", name)) {
            return item.item;
        }
    }
    return undefined;
}

/**
 * Sets up `modelData` and then, in a separate change, applies `linkHref` to the text node holding
 * `href` — exactly what AutoLink does. Where `modelData` leaves the caret *is* the gesture under
 * test: still inside the URL's block (the user typed a space and may keep going), or in the block
 * after it (the user pressed Enter, which splits the paragraph and carries the caret onward).
 */
export function autoLinkIn(editor: ClassicEditor, modelData: string, href: string): void {
    setModelData(editor.model, modelData);

    editor.model.change((writer) => {
        const root = editor.model.document.getRoot();
        if (!root) {
            throw new Error("Expected a document root.");
        }

        for (const item of writer.createRangeIn(root).getWalker()) {
            if (!item.item.is("$textProxy")) continue;

            // AutoLink links the URL itself, not the whole text node it happens to share with the
            // words around it — so link exactly the URL's slice of the node.
            const index = item.item.data.indexOf(href);
            if (index < 0) continue;

            const parent = item.item.parent;
            if (!parent || !parent.is("element") || item.item.startOffset === null) continue;

            const start = item.item.startOffset + index;
            writer.setAttribute("linkHref", href, writer.createRange(
                writer.createPositionAt(parent, start),
                writer.createPositionAt(parent, start + href.length)
            ));
            return;
        }

        throw new Error(`No text node holds ${href}.`);
    });
}

/** The model data for a URL left alone on its own line, with the caret carried to the next one. */
export function urlLeftAloneOnItsOwnLine(url: string): string {
    return `<paragraph>${url}</paragraph><paragraph>[]</paragraph>`;
}

/**
 * Inserts text into the paragraph and applies a `linkHref` attribute to it via a
 * writer change (null -> url), exactly as CKEditor's AutoLink plugin does when a
 * raw URL is pasted/typed. This drives the `AutoLinkToMention` `change:data` listener.
 * The caret is left in the block, as it is when the user types a space after the URL.
 */
export function addLinkedText(editor: ClassicEditor, href: string, text = href): void {
    // First insert the plain text in its own batch.
    setModelData(editor.model, `<paragraph>${text}[]</paragraph>`);
    // Then, in a SEPARATE change, apply the linkHref attribute (null -> url).
    // AutoLink does exactly this, producing an attribute diff (not a text insert)
    // which is what AutoLinkToMention listens for.
    editor.model.change((writer) => {
        const paragraph = editor.model.document.getRoot()?.getChild(0);
        if (!paragraph?.is("element")) {
            throw new Error("Expected a paragraph block.");
        }
        writer.setAttribute("linkHref", href, writer.createRangeIn(paragraph));
    });
}

/**
 * Lets the `fetchLinkMetadata().then(...)` chain resolve and the resulting model change apply.
 * A task turn is awaited rather than a fixed number of microtasks: the latter is a guess at the
 * chain's depth that silently under-waits, which makes a conversion test fail and — worse — makes a
 * test asserting that NO conversion happened pass for the wrong reason.
 */
export async function flushFetch(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Replaces the fetch mock's implementation with one that hangs until the returned resolver is
 * called, so a test can interleave model edits between the fetch starting and resolving.
 */
export function useDeferredFetch(fetchLinkMetadata: ReturnType<typeof vi.fn>) {
    let resolveFetch: (metadata: LinkEmbedMetadata) => void = () => {};
    fetchLinkMetadata.mockImplementation(
        () => new Promise<LinkEmbedMetadata>((resolve) => {
            resolveFetch = resolve;
        })
    );
    return { resolveFetch: (metadata: LinkEmbedMetadata) => resolveFetch(metadata) };
}
