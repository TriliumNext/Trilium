import { ButtonView, Command, type DowncastAttributeEvent, type Editor, type ModelElement, type ModelWriter, Plugin, uid } from "ckeditor5";

import copyIcon from "../icons/copy.svg?raw";
import { escapeHtml } from "../utils";

/** Model attribute holding a block's stable identity. */
export const BLOCK_ID_ATTRIBUTE = "blockId";

/** How {@link BLOCK_ID_ATTRIBUTE} is serialized. `data-*` passes the note sanitizer on every element. */
export const BLOCK_ID_VIEW_ATTRIBUTE = "data-block-id";

/**
 * Gives a block (paragraph, heading, list item, …) a stable identity so a link can point at it and
 * still resolve after the note is reloaded — the substrate under "copy link to this block".
 *
 * Three decisions are worth stating, because each one removes a problem rather than solving it:
 *
 * - **`data-block-id`, not `id`.** The note sanitizer allows `id` only on `a`, `h2` and `li`
 *   (`sanitizer.ts`), but allows `data-*` on everything, so this round-trips with no sanitizer
 *   change. It also stays out of the document-global `id` namespace.
 * - **Assigned lazily.** An ID is minted only when someone copies a link to the block. Blocks
 *   nobody references never get one, which is what keeps exported HTML clean — the reason
 *   CKEditor's always-on list item IDs are not persisted here.
 * - **Skipped on the clipboard pipeline.** Copied HTML carries no IDs, so a paste can never
 *   duplicate an ID that something already links to. `cuttonote.ts` relies on the same CKEditor
 *   behaviour for list item IDs. That leaves block *split* as the only duplication vector, which
 *   {@link dedupeBlockIds} handles.
 */
export default class BlockId extends Plugin {

    public static get pluginName() {
        return "BlockId" as const;
    }

    public init() {
        const editor = this.editor;

        editor.model.schema.extend("$block", { allowAttributes: BLOCK_ID_ATTRIBUTE });

        editor.conversion.for("upcast").attributeToAttribute({
            view: BLOCK_ID_VIEW_ATTRIBUTE,
            model: BLOCK_ID_ATTRIBUTE
        });

        // Registered for both pipelines: the editing view needs the attribute so the scroll-to
        // handler can find the block while the note is open in the editor, and the data view
        // needs it so the link survives a save. The clipboard pipeline is the one that opts out.
        editor.conversion.for("downcast").add((dispatcher) => {
            dispatcher.on<DowncastAttributeEvent>(`attribute:${BLOCK_ID_ATTRIBUTE}`, (evt, data, conversionApi) => {
                if (conversionApi.options?.isClipboardPipeline) {
                    return;
                }

                if (!conversionApi.consumable.consume(data.item, evt.name)) {
                    return;
                }

                const viewElement = conversionApi.mapper.toViewElement(data.item as ModelElement);
                /* v8 ignore next 3 -- a block carrying the attribute always maps to a view element */
                if (!viewElement) {
                    return;
                }

                if (typeof data.attributeNewValue === "string" && data.attributeNewValue) {
                    conversionApi.writer.setAttribute(BLOCK_ID_VIEW_ATTRIBUTE, data.attributeNewValue, viewElement);
                } else {
                    conversionApi.writer.removeAttribute(BLOCK_ID_VIEW_ATTRIBUTE, viewElement);
                }
            });
        });

        editor.model.document.registerPostFixer((writer) => dedupeBlockIds(editor, writer));

        editor.commands.add("copyBlockLink", new CopyBlockLinkCommand(editor));

        editor.ui.componentFactory.add("copyBlockLink", (locale) => {
            const button = new ButtonView(locale);
            const command = editor.commands.get("copyBlockLink");
            const t = locale.t;

            button.set({
                label: t("Copy link to this block"),
                icon: copyIcon,
                tooltip: true
            });

            if (command) {
                button.bind("isEnabled").to(command, "isEnabled");
            }

            this.listenTo(button, "execute", () => editor.execute("copyBlockLink"));

            return button;
        });
    }

}

/**
 * Copies a reference link addressing the selected block, minting the block's ID if it does not
 * have one yet.
 *
 * Minting on copy is what keeps IDs off every other block, but it does mean this command edits the
 * note — a gesture the user reads as read-only produces a content change, and therefore possibly a
 * revision. That trade is deliberate; the alternative is stamping every block up front.
 */
class CopyBlockLinkCommand extends Command {

    public override refresh() {
        this.isEnabled = !!getSelectedBlock(this.editor) && !!glob.getActiveContextNote()?.noteId;
    }

    public override execute() {
        const editor = this.editor;
        const block = getSelectedBlock(editor);
        const noteId = glob.getActiveContextNote()?.noteId;

        if (!block || !noteId) {
            return;
        }

        const existingId = block.getAttribute(BLOCK_ID_ATTRIBUTE);
        let blockId = typeof existingId === "string" ? existingId : "";

        if (!blockId) {
            blockId = uid();
            editor.model.change((writer) => writer.setAttribute(BLOCK_ID_ATTRIBUTE, blockId, block));
        }

        const href = `#root/${noteId}?blockId=${encodeURIComponent(blockId)}`;
        const title = glob.getReferenceLinkTitleSync(href);
        const html = `<a class="reference-link" href="${escapeHtml(href)}">${escapeHtml(title)}</a>`;

        navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([href], { type: "text/plain" })
            })
        ]);
    }

}

/** The block the selection sits in, or `null` when the selection spans none. */
function getSelectedBlock(editor: Editor): ModelElement | null {
    const [first] = editor.model.document.selection.getSelectedBlocks();
    return first ?? null;
}

/**
 * Keeps block IDs unique within the document.
 *
 * Splitting a block (Enter mid-paragraph) copies its attributes onto both halves, so the ID would
 * otherwise address two blocks at once. Document order decides who keeps it: the first occurrence
 * wins and later duplicates are reissued, so splitting a linked paragraph leaves existing links
 * pointing at the top half.
 *
 * Gated on insertions — an attribute-only change cannot introduce a duplicate, since the only
 * writer of this attribute mints a fresh value.
 */
function dedupeBlockIds(editor: Editor, writer: ModelWriter): boolean {
    const document = editor.model.document;

    if (!document.differ.getChanges().some((change) => change.type === "insert")) {
        return false;
    }

    const seen = new Set<string>();
    const duplicates: ModelElement[] = [];

    for (const root of document.getRoots()) {
        // `ignoreElementEnd` is load-bearing, not tidiness: the default walker visits an element
        // twice, as `elementStart` and again as `elementEnd`, handing back the same element both
        // times. Without it every ID collides with itself, gets reissued, and returning `true`
        // re-runs the post-fixer over a document that still looks equally broken — an endless loop
        // that hangs the editor as soon as any block carries an ID.
        for (const { item } of writer.createRangeIn(root).getWalker({ ignoreElementEnd: true })) {
            if (!item.is("element")) {
                continue;
            }

            const blockId = item.getAttribute(BLOCK_ID_ATTRIBUTE);
            if (typeof blockId !== "string" || !blockId) {
                continue;
            }

            if (seen.has(blockId)) {
                duplicates.push(item);
            } else {
                seen.add(blockId);
            }
        }
    }

    // Applied after the walk rather than during it, so the tree is never mutated mid-iteration.
    for (const element of duplicates) {
        writer.setAttribute(BLOCK_ID_ATTRIBUTE, uid(), element);
    }

    return duplicates.length > 0;
}
