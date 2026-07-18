import { chooseLinkPreviewKind, isUrlAloneInBlock, type BlockChildLike } from '@triliumnext/commons';
import { Plugin } from 'ckeditor5';
import { EMBEDDABLE_URL_REGEX } from './link_embed_commands.js';

/**
 * Auto-converts typed/pasted URLs to link preview widgets.
 *
 * Piggybacks on CKEditor's AutoLink plugin: when AutoLink sets `linkHref` on text whose content
 * matches the href (i.e. a raw URL, not "[label](url)"), we fetch metadata and replace it with a
 * preview widget.
 *
 * The shape follows the gesture (see chooseLinkPreviewKind):
 *   - a URL left alone on its own line — sole content of a plain paragraph, then Enter — becomes a
 *     block preview: a player if the URL is embeddable (YouTube), a card otherwise;
 *   - anything else — text either side of it, a list/table/quote/heading, or a caret still in the
 *     block because the user is mid-sentence — becomes an inline linkMention.
 *
 * The user can Ctrl+Z to revert back to a plain link.
 */
export default class AutoLinkToMention extends Plugin {
    /** Guard against re-entrant changes triggered by our own model writes. */
    private _converting = false;
    /** URLs that were undone — don't re-convert these. */
    private _dismissed = new Set<string>();

    init() {
        const editor = this.editor;

        editor.model.document.on('change:data', (_evt, batch) => {
            if (this._converting) return;
            if (!this._autoDetectEnabled()) return;

            // When the user undoes our conversion, the undo batch re-inserts
            // the original linked text. Record its URL so we don't re-convert.
            if (batch.isUndo) {
                for (const change of editor.model.document.differ.getChanges()) {
                    if (change.type !== 'attribute' || change.attributeKey !== 'linkHref') continue;
                    if (typeof change.attributeNewValue === 'string') {
                        this._dismissed.add(change.attributeNewValue);
                    }
                }
                return;
            }

            // Detect AutoLink setting `linkHref` on existing text (paste + Space).
            // AutoLink calls writer.setAttribute('linkHref', url, range) which
            // shows up as an attribute change, not a text insertion.
            for (const change of editor.model.document.differ.getChanges()) {
                if (change.type !== 'attribute' || change.attributeKey !== 'linkHref') continue;
                // Only react to newly added links (null → url), not modifications.
                if (change.attributeOldValue !== null) continue;

                const href = change.attributeNewValue as string;
                if (!EMBEDDABLE_URL_REGEX.test(href)) continue;
                if (this._dismissed.has(href)) continue;

                // Walk the affected range to verify the text IS the URL
                // (raw pasted URL, not a labeled link like "click here").
                for (const item of change.range.getWalker()) {
                    if (!item.item.is('$textProxy')) continue;
                    if (item.item.data.trim() !== href) continue;

                    const parent = item.item.parent;
                    /* v8 ignore next -- a $textProxy always has an element parent, so this guard never fires */
                    if (!parent?.is('element')) continue;

                    this._replaceWithPreview(href, parent.getPath());
                    return;
                }
            }
        });
    }

    /**
     * Whether auto-detection is on (Options → Text Notes → Features). Consulted on every detected
     * URL rather than once at startup, so the host can supply a getter and have the option apply to
     * already-open editors. A plain boolean is honoured too, and an absent config means enabled.
     *
     * Only auto-detection is gated: inserting a preview from the toolbar dialog goes through
     * InsertLinkEmbedCommand and stays available either way.
     */
    private _autoDetectEnabled(): boolean {
        const setting = this.editor.config.get('autoLinkPreviewsEnabled') as boolean | (() => boolean) | undefined;
        return (typeof setting === 'function' ? setting() : setting) !== false;
    }

    private _replaceWithPreview(url: string, parentPath: number[]) {
        const editor = this.editor;
        const editorEl = editor.editing.view.getDomRoot();
        const component = glob.getComponentByEl<EditorComponent>(editorEl);

        component.fetchLinkMetadata(url).then((metadata: LinkEmbedMetadata) => {
            // The page told us nothing (bot challenge, network error, no title of its own): leave the
            // plain link AutoLink already created. A preview built from a hostname placeholder would
            // show strictly less than the URL it replaced.
            if (metadata.unresolved) {
                // The URL is left out on purpose — a browser console gets screenshotted and pasted
                // into bug reports too, and the link is right there in the note anyway.
                console.warn('Link preview dropped: no metadata could be read from the page (the link was kept as a plain link).');
                return;
            }

            // Restored in the `finally`: were a model change ever to throw, a flag left raised would
            // silently switch auto-detection off for the rest of the session.
            this._converting = true;

            try {
                editor.model.change((writer) => {
                    const root = editor.model.document.getRoot();
                    /* v8 ignore next -- the document always has a root once the editor is created */
                    if (!root) return;

                    // Re-resolve the parent from the stored path.
                    let parentEl: any = root;
                    for (const idx of parentPath) {
                        if (!parentEl || typeof parentEl.getChild !== 'function') return;
                        parentEl = parentEl.getChild(idx);
                    }
                    if (!parentEl || !parentEl.is('element')) return;

                    // Find the text node that still contains the URL.
                    const range = writer.createRangeIn(parentEl);
                    for (const item of range.getWalker()) {
                        if (!item.item.is('$textProxy')) continue;
                        if (item.item.data.trim() !== url) continue;
                        if (item.item.getAttribute('linkHref') !== url) continue;

                        // Where the URL sits decides its shape. Evaluated here — at insertion time, not
                        // when the URL was detected — because the metadata fetch is async and the user
                        // may have kept typing meanwhile. Also before deleting anything, since deletion
                        // would empty the block and make it look like the URL was never alone.
                        const kind = chooseLinkPreviewKind(metadata.embedType, {
                            urlAloneInBlock: isUrlAloneInBlock(this._blockChildren(parentEl), url),
                            blockIsStandalone: this._isStandaloneBlock(parentEl),
                            caretLeftBlock: this._caretLeftBlock(parentEl)
                        });

                        const attributes = {
                            url: metadata.url,
                            embedType: metadata.embedType,
                            title: metadata.title,
                            description: metadata.description,
                            favicon: metadata.favicon,
                            siteName: metadata.siteName,
                            image: metadata.image
                        };

                        if (kind === 'mention') {
                            // The URL's own range is passed to insertContent rather than selected
                            // first: the fetch was async and the caret may be words away by now, so
                            // the replacement must not drag it back to the mention.
                            const urlRange = writer.createRangeOn(item.item);
                            editor.model.insertContent(writer.createElement('linkMention', attributes), urlRange);
                            return;
                        }

                        // A card or an embed takes over the whole paragraph, which by now holds nothing
                        // but the URL. Swapped with writer.insert/remove rather than insertContent: the
                        // caret has moved on to the next line (that is what made this a block preview in
                        // the first place) and may already be mid-word, so it must not be dragged back.
                        // 'card' vs 'embed' needs no branch here — the renderer keys off embedType,
                        // which is "opengraph" for a card and the provider's own type for an embed.
                        writer.insert(writer.createElement('linkEmbed', attributes), parentEl, 'before');
                        writer.remove(parentEl);
                        return;
                    }
                });
            } finally {
                this._converting = false;
            }
        });
    }

    /**
     * True for a plain top-level paragraph — the only block a card or an embed may take over.
     * A list item is a paragraph carrying list attributes; a table cell, a quote and every other
     * container nest their paragraphs below the root; a heading is not a paragraph at all. In each
     * of those the URL keeps its inline mention, since a block preview there reads as an accident.
     */
    private _isStandaloneBlock(blockEl: any): boolean {
        if (blockEl.name !== 'paragraph') return false;
        if (blockEl.hasAttribute('listItemId')) return false;

        return blockEl.parent === this.editor.model.document.getRoot();
    }

    /**
     * True when the caret is no longer in the block — which is exactly what pressing Enter after the
     * URL does. While it is still there the user may yet type on that line, so the URL has not been
     * *left* alone and stays an inline mention.
     */
    private _caretLeftBlock(blockEl: any): boolean {
        const position = this.editor.model.document.selection.getFirstPosition();

        /* v8 ignore next -- the document selection always has a position */
        return position?.parent !== blockEl;
    }

    /**
     * Maps a model block's children to the runtime-neutral shape consumed by
     * {@link isUrlAloneInBlock}, keeping the decision logic pure and testable.
     */
    private _blockChildren(blockEl: any): BlockChildLike[] {
        const children: BlockChildLike[] = [];
        for (const child of blockEl.getChildren()) {
            const isText = child.is('$text');
            children.push({ isText, data: isText ? child.data : undefined });
        }
        return children;
    }
}
