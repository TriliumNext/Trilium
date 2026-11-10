import "../theme/hidden_blocks.css";

import {
    type ClipboardInputEventData, type DeleteEventData, type DifferItem, env, type EventInfo,
    type Mapper, type ModelElement, type ModelNode, type ModelPosition, type ModelRange,
    type ModelWriter, Plugin, priorities, type ViewDocumentClipboardInputEvent,
    type ViewDocumentDeleteEvent, type ViewDocumentDragStartEvent, type ViewDowncastWriter,
    type ViewElement, type ViewRange
} from "ckeditor5";

import FindReveal from "./find_reveal.js";
import { addEditingKeydownCapture } from "./move_block_updown.js";

/** The class of the view elements of hidden blocks, and of the list wrappers around them. */
export const HIDDEN_BLOCK_CLASS = "trilium-hidden-block";

/** The class of a collapsed owner whose blocks show for the moment. */
export const TEMPORARILY_EXPANDED_CLASS = "trilium-temporarily-expanded";

/** A collapsed owner and the sibling blocks after it that it hides. */
export interface CollapsedSection {
    owner: ModelElement;
    blocks: ModelElement[];
}

/** A kind of block that hides the blocks after it while it is collapsed, such as a heading. */
export interface HiddenBlocksProvider {
    /** The model attribute that marks a collapsed owner. */
    readonly attribute: string;
    /** Whether `owner` has blocks to hide. */
    canCollapse(owner: ModelElement): boolean;
    /** The sections of the collapsed owners among the children of `parent`, in document order. */
    getCollapsedSections(parent: ModelElement): CollapsedSection[];
    /** Shows the blocks of `owner` for good. */
    expand(writer: ModelWriter, owner: ModelElement): void;
}

/**
 * Blocks that stay in the model but are hidden in the editing view, such as the section of a
 * collapsed heading. Providers say which blocks a collapsed owner hides. This plugin hides them,
 * keeps the caret and the edits out of them, moves them with their owner, and shows them for the
 * moment for Search in note and for jumps to a place in the note.
 */
export default class HiddenBlocks extends Plugin {

    private readonly providers: HiddenBlocksProvider[] = [];
    /** The elements with a collapse attribute, with their provider. Can have stale entries. */
    private readonly collapsedOwners = new Map<ModelElement, HiddenBlocksProvider>();
    /** The blocks hidden in the model, reveals left out, as of the end of the last change. */
    private hiddenInModel: HiddenMap = new Map();
    /** The elements that the last change inserted. */
    private lastInserted = new Set<ModelNode | null>();
    /** The blocks hidden in the editing view, for the document version they were found for. */
    private hiddenCache: { version: number; hidden: HiddenMap } | null = null;
    /** The owners that Search in note shows for the moment. */
    private findRevealed = new Set<ModelElement>();
    /** The owners that a jump shows until they are toggled, edited or loaded again. */
    private readonly jumpRevealed = new Set<ModelElement>();
    private markedHidden = new Set<ViewElement>();
    private markedRevealed = new Set<ViewElement>();
    private isViewStale = false;
    private isSelectionChanged = false;
    /** True for the microtask in which Search in note closes and puts the caret on its match. */
    private isFindClosing = false;
    /** Whether the elements of each name contain text, and so no blocks. */
    private readonly textHolders = new Map<string, boolean>();

    static get pluginName() {
        return "HiddenBlocks" as const;
    }

    static get requires() {
        return [ FindReveal ] as const;
    }

    init() {
        const editor = this.editor;
        const document = editor.model.document;
        const viewDocument = editor.editing.view.document;

        document.registerPostFixer((writer) => this.fixCollapsedOwners(writer));
        this.listenTo(document, "change", () => this.updateHiddenInModel(), { priority: "high" });
        this.listenTo(document.selection, "change:range", () => {
            this.isSelectionChanged = true;
        });
        viewDocument.registerPostFixer((writer) => this.syncView(writer));

        // The capture phase runs before `Widget`, which selects a widget next to the caret.
        this.listenTo<ViewDocumentDeleteEvent>(viewDocument, "delete", (evt, data) => {
            this.deleteAtHiddenRun(evt, data);
        }, { context: "$capture", priority: "high" });
        addEditingKeydownCapture(this, (event) => this.moveOverHiddenRun(event));
        this.listenTo<ViewDocumentDragStartEvent>(viewDocument, "dragstart", () => {
            this.widenSelectionForDrag();
        });
        this.listenTo<ViewDocumentClipboardInputEvent>(viewDocument, "clipboardInput",
            (_evt, data) => this.moveDropAfterHiddenRun(data),
            { priority: priorities.get("high") - 1 });
        this.listenTo(editor.plugins.get(FindReveal), "change:position",
            (_evt, _name, position) => this.followFind(position));
    }

    /** Adds `provider`, whose collapsed owners then hide their blocks. */
    register(provider: HiddenBlocksProvider) {
        this.providers.push(provider);
    }

    /** Whether `node` is hidden in the editing view, as a hidden block or inside one. */
    isHidden(node: ModelNode): boolean {
        return isInOrUnder(node, this.getHidden());
    }

    /**
     * A test for whether a block is one of the hidden blocks, answered as of now: later changes do
     * not change its answers. A change that moves several blocks reads the blocks that move
     * together from it, since each move can hide or show blocks.
     */
    getHiddenSnapshot(): (block: ModelNode) => boolean {
        // `getHidden()` replaces its map on a change instead of changing it.
        const hidden = this.getHidden();
        return (block) => hidden.has(block as ModelElement);
    }

    /** The blocks hidden right after `block`, which move with it. */
    getHiddenRunAfter(block: ModelElement): ModelElement[] {
        const hidden = this.getHidden();
        const run: ModelElement[] = [];
        for (let node = block.nextSibling; node && hidden.has(node as ModelElement);
            node = node.nextSibling) {
            run.push(node as ModelElement);
        }
        return run;
    }

    /** `range`, which ends after a block, widened over the blocks hidden right after it. */
    widenOverHiddenRun(range: ModelRange): ModelRange {
        const last = this.getHiddenRunAfter(range.end.nodeBefore as ModelElement).at(-1);
        const model = this.editor.model;
        return last ? model.createRange(range.start, model.createPositionAfter(last)) : range;
    }

    /** Whether the blocks of `owner` show only for the moment. */
    isRevealed(owner: ModelElement): boolean {
        return this.findRevealed.has(owner) || this.jumpRevealed.has(owner);
    }

    /** Hides the blocks of `owner` again after Search in note or a jump showed them. */
    conceal(owner: ModelElement) {
        this.findRevealed.delete(owner);
        this.jumpRevealed.delete(owner);
        this.refreshView();
    }

    /** Shows the hidden blocks around `domNode`, a node of the editing view. */
    revealAroundDomNode(domNode: Node) {
        const editing = this.editor.editing;
        const viewPosition = editing.view.domConverter.domPositionToView(domNode, 0);
        if (viewPosition) {
            this.revealAround(editing.mapper.toModelPosition(viewPosition));
        }
    }

    /**
     * Shows the hidden blocks around `position` without changing the model, until their owner is
     * toggled, the caret enters them or the content loads again. Renders at once, so that a scroll
     * that follows measures the blocks.
     */
    revealAround(position: ModelPosition) {
        let isChanged = false;
        for (const { owner } of this.getOwnersAt(position)) {
            if (!this.jumpRevealed.has(owner)) {
                this.jumpRevealed.add(owner);
                isChanged = true;
            }
        }
        if (isChanged) {
            this.refreshView();
        }
    }

    /**
     * Drops the collapsed state of the owners that have nothing to hide, and expands the owners
     * whose blocks a change hid. After a change, a block can be hidden only if it was hidden
     * before, its owner was collapsed in the change, or both came in with the change.
     */
    private fixCollapsedOwners(writer: ModelWriter): boolean {
        const changes = this.editor.model.document.differ.getChanges();
        if (!changes.some(isBlockChange)) {
            return false;
        }

        this.addCollapsedOwners(changes);
        let isFixed = false;
        for (const [ owner, provider ] of this.getCollapsedOwners()) {
            if (!provider.canCollapse(owner)) {
                provider.expand(writer, owner);
                isFixed = true;
            }
        }
        return isFixed || this.expandNewlyHidden(writer, changes);
    }

    private expandNewlyHidden(writer: ModelWriter, changes: DifferItem[]) {
        const inserted = new Set<ModelNode | null>();
        const collapsed = new Set<ModelNode | null>();
        for (const change of changes) {
            if (change.type === "insert" && change.name !== "$text") {
                inserted.add(change.position.nodeAfter);
            } else if (change.type === "attribute" && change.attributeNewValue
                && this.isCollapseAttribute(change.attributeKey)) {
                collapsed.add(change.range.start.nodeAfter);
            }
        }

        const owners = new Map<ModelElement, HidingOwner>();
        for (const [ block, hidingOwner ] of this.collect(NOTHING_REVEALED)) {
            const { owner } = hidingOwner;
            const isAllowed = isInOrUnder(block, this.hiddenInModel) || collapsed.has(owner)
                || (isInOrUnder(block, inserted) && isInOrUnder(owner, inserted));
            if (!isAllowed) {
                owners.set(owner, hidingOwner);
            }
        }
        for (const { owner, provider } of owners.values()) {
            provider.expand(writer, owner);
        }
        return owners.size > 0;
    }

    /**
     * Keeps the blocks that the model hides for the next change, after a change of blocks. A
     * change of text hides nothing new, so the blocks hidden in the editing view stay valid. Then
     * checks a selection that the change moved.
     */
    private updateHiddenInModel() {
        const document = this.editor.model.document;
        const changes = document.differ.getChanges();
        this.lastInserted = new Set(changes.map((change) => (
            change.type === "insert" && change.name !== "$text" ? change.position.nodeAfter : null
        )));
        if (changes.some(isBlockChange)) {
            this.hiddenInModel = this.collect(NOTHING_REVEALED);
            this.hiddenCache = null;
            this.isViewStale = true;
        } else if (this.hiddenCache) {
            this.hiddenCache.version = document.version;
        }

        if (this.isSelectionChanged && this.collapsedOwners.size) {
            this.queueSelectionCheck();
        }
        this.isSelectionChanged = false;
    }

    /** Checks the selection once the current change is done. */
    private queueSelectionCheck() {
        this.editor.model.enqueueChange({ isUndoable: false },
            (writer) => this.showSelection(writer));
    }

    /**
     * Expands the owners that hide an end of the selection, or the element it selects. The caret
     * goes to the end of the outermost owner instead while Search in note closes, which puts the
     * caret on its match, and when the owner came with the last change, as a pasted or dropped
     * collapsed heading does, which leaves the caret after it.
     */
    private showSelection(writer: ModelWriter) {
        const selection = this.editor.model.document.selection;
        const owners = new Map<ModelElement, HidingOwner>();
        const last = selection.getLastPosition() as ModelPosition;
        const nodes = [
            (selection.getFirstPosition() as ModelPosition).parent as ModelElement,
            selection.getSelectedElement()
        ];
        // A range can end right after hidden blocks, as one that takes a collapsed section does.
        if (!selection.isCollapsed && !this.isAfterHiddenRun(last)) {
            nodes.push(last.parent as ModelElement);
        }
        for (const node of nodes) {
            if (node && isInOrUnder(node, this.hiddenInModel)) {
                for (const hidingOwner of this.getOwnersAround(node)) {
                    owners.set(hidingOwner.owner, hidingOwner);
                }
            }
        }

        const [ outermost ] = owners.values();
        const isArrived = !!outermost && isInOrUnder(outermost.owner, this.lastInserted);
        if (outermost && (this.isFindClosing || isArrived)) {
            writer.setSelection(outermost.owner, "end");
            return;
        }
        for (const { owner, provider } of owners.values()) {
            provider.expand(writer, owner);
        }
    }

    /**
     * Puts a class on the view elements of each hidden block, and on each owner whose blocks show
     * for the moment. Runs only after a change of blocks or of the reveals, and puts the classes
     * back on view elements that were converted again.
     */
    private syncView(writer: ViewDowncastWriter): boolean {
        if (!this.isViewStale) {
            return false;
        }
        this.isViewStale = false;

        const mapper = this.editor.editing.mapper;
        const hidden = new Set<ViewElement>();
        for (const block of this.getHidden().keys()) {
            let element = mapper.toViewElement(block);
            while (element) {
                hidden.add(element);
                element = getWrapper(element, mapper);
            }
        }
        const revealed = new Set<ViewElement>();
        for (const owner of this.getRevealed()) {
            revealed.add(mapper.toViewElement(owner) as ViewElement);
        }

        const isHiddenChanged = syncClass(writer, HIDDEN_BLOCK_CLASS, this.markedHidden, hidden);
        const isRevealedChanged = syncClass(writer, TEMPORARILY_EXPANDED_CLASS, this.markedRevealed,
            revealed);
        this.markedHidden = hidden;
        this.markedRevealed = revealed;
        return isHiddenChanged || isRevealedChanged;
    }

    /**
     * Keeps a delete from a caret out of the hidden blocks it reaches. When the block right after
     * the hidden blocks is empty, the delete removes that block: Backspace in it, or Delete before
     * the hidden blocks. Otherwise the delete expands the owners of the hidden blocks and deletes
     * nothing, and the next press works on the shown blocks.
     */
    private deleteAtHiddenRun(evt: EventInfo, data: DeleteEventData) {
        const model = this.editor.model;
        const selection = model.document.selection;
        if (!selection.isCollapsed || !this.collapsedOwners.size) {
            return;
        }

        const probe = model.createSelection(selection);
        model.modifySelection(probe, { direction: data.direction, unit: "character" });
        const hiddenNode = this.findHiddenNode(probe.getFirstRange() as ModelRange);
        if (!hiddenNode) {
            return;
        }

        data.preventDefault();
        evt.stop();
        const isForward = data.direction === "forward";
        const blockAfterRun = (isForward
            ? getRunEdge(hiddenNode, this.getHidden(), "nextSibling").nextSibling
            : (selection.focus as ModelPosition).parent) as ModelElement | null;
        if (blockAfterRun && blockAfterRun.isEmpty && this.holdsText(blockAfterRun)) {
            // Backspace removes the block of the caret, which goes before the hidden blocks.
            const target = isForward ? null : this.getRangePastRun(hiddenNode, false);
            model.change((writer) => {
                // Undo restores the selection of the first operation, so the removal goes first.
                writer.remove(blockAfterRun);
                if (target) {
                    writer.setSelection(target);
                }
            });
            this.editor.editing.view.scrollToTheSelection();
            return;
        }
        model.enqueueChange({ isUndoable: false }, (writer) => {
            for (const { owner, provider } of this.getOwnersAround(hiddenNode)) {
                provider.expand(writer, owner);
            }
        });
    }

    /**
     * Moves the caret over a run of hidden blocks when an arrow key moves it into one: to the first
     * position after the run, or to the last one before it. With Shift, only the focus moves. The
     * up and down arrows are checked on the first and last line of a block only.
     */
    private moveOverHiddenRun(event: KeyboardEvent) {
        const move = this.getArrowMove(event);
        const model = this.editor.model;
        const selection = model.document.selection;
        if (!move || !this.collapsedOwners.size || (!selection.isCollapsed && !event.shiftKey)) {
            return;
        }

        let start = selection.focus as ModelPosition;
        if (move.isVertical) {
            const block = start.parent as ModelElement;
            if (!this.isOnEdgeLine(start, block, move.isForward)) {
                return;
            }
            start = model.createPositionAt(block, move.isForward ? "end" : 0);
        }

        const probe = model.createSelection(start);
        const direction = move.isForward ? "forward" : "backward";
        model.modifySelection(probe, { direction, unit: move.unit });
        const hiddenNode = this.findHiddenNode(probe.getFirstRange() as ModelRange);
        if (!hiddenNode) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        const target = this.getRangePastRun(hiddenNode, move.isForward);
        if (!target) {
            return;
        }
        model.change((writer) => {
            if (event.shiftKey) {
                writer.setSelectionFocus(move.isForward ? target.end : target.start);
            } else {
                writer.setSelection(target);
            }
        });
    }

    /** What an arrow key moves the caret by, or `null` for the keys that are left to others. */
    private getArrowMove(event: KeyboardEvent): ArrowMove | null {
        const hasModifier = event.altKey || event.ctrlKey || event.metaKey;
        // The keys that move by word: Option with an arrow on macOS, Ctrl elsewhere.
        const isWordMove = env.isMac
            ? event.altKey && !event.ctrlKey && !event.metaKey
            : event.ctrlKey && !event.altKey && !event.metaKey;
        const isRtl = this.editor.locale.contentLanguageDirection === "rtl";
        switch (event.key) {
            case "ArrowUp":
            case "ArrowDown":
                return hasModifier
                    ? null
                    : { isForward: event.key === "ArrowDown", isVertical: true, unit: "character" };
            case "ArrowLeft":
            case "ArrowRight":
                return hasModifier && !isWordMove
                    ? null
                    : {
                        isForward: (event.key === "ArrowRight") !== isRtl,
                        isVertical: false,
                        unit: isWordMove ? "word" : "character"
                    };
            default:
                return null;
        }
    }

    /** Whether `position`, in `block`, is on the first line of the block, or on the last one. */
    private isOnEdgeLine(position: ModelPosition, block: ModelElement, isLast: boolean) {
        const { mapper, view } = this.editor.editing;
        const domPosition = view.domConverter
            .viewPositionToDom(mapper.toViewPosition(position)) as DomPosition;
        const domBlock = view.domConverter
            .mapViewToDom(mapper.toViewElement(block) as ViewElement) as HTMLElement;
        const range = domBlock.ownerDocument.createRange();
        range.setStart(domPosition.parent, domPosition.offset);
        const caret = range.getBoundingClientRect();
        // A caret beside no text, as in an empty block, has no box.
        if (!caret.height) {
            return true;
        }
        const box = domBlock.getBoundingClientRect();
        return isLast
            ? caret.bottom > box.bottom - caret.height / 2
            : caret.top < box.top + caret.height / 2;
    }

    /** The selection past the hidden blocks in a row with `node`, or `null` at an end. */
    private getRangePastRun(node: ModelElement, isForward: boolean) {
        const hidden = this.getHidden();
        const model = this.editor.model;
        return isForward
            ? model.schema.getNearestSelectionRange(
                model.createPositionAfter(getRunEdge(node, hidden, "nextSibling")), "forward")
            : model.schema.getNearestSelectionRange(
                model.createPositionBefore(getRunEdge(node, hidden, "previousSibling")),
                "backward");
    }

    /** Whether `position` is at the end of blocks that the model hides, with nothing between. */
    private isAfterHiddenRun(position: ModelPosition) {
        const hidden = this.hiddenInModel;
        const block = (position.parent as ModelElement).getAncestors({ includeSelf: true })
            .find((ancestor) => hidden.has(ancestor as ModelElement)) as ModelElement | undefined;
        return !!block && position.isTouching(
            this.editor.model.createPositionAfter(getRunEdge(block, hidden, "nextSibling")));
    }

    /**
     * Makes a drag of whole blocks take along the blocks hidden after the last of them. `DragDrop`
     * reads the dragged blocks from the selection after this listener.
     */
    private widenSelectionForDrag() {
        const model = this.editor.model;
        const selection = model.document.selection;
        const blocks = [ ...selection.getSelectedBlocks() ];
        const last = blocks.at(-1);
        const range = selection.getFirstRange() as ModelRange;
        if (!last || selection.isCollapsed) {
            return;
        }

        // `DragDrop` drags whole blocks when several are selected, or one from end to end.
        const isWholeBlocks = blocks.length > 1
            || (range.start.isTouching(model.createPositionAt(last, 0))
                && range.end.isTouching(model.createPositionAt(last, "end")));
        const lastHidden = this.getHiddenRunAfter(last).at(-1);
        if (isWholeBlocks && lastHidden) {
            model.change((writer) => {
                writer.setSelection(
                    model.createRange(range.start, model.createPositionAfter(lastHidden)));
            });
        }
    }

    /**
     * Moves a drop between an owner and its hidden blocks, or among them, to after them. Runs after
     * `DragDrop` has set the target range of the drop.
     */
    private moveDropAfterHiddenRun(data: ClipboardInputEventData) {
        if (data.method !== "drop" || !this.collapsedOwners.size) {
            return;
        }

        const model = this.editor.model;
        const mapper = this.editor.editing.mapper;
        const position = mapper.toModelRange((data.targetRanges as ViewRange[])[0]).start;
        const hiddenNode = this.findHiddenNode(model.createRange(position, position),
            position.nodeAfter);
        if (hiddenNode) {
            const last = getRunEdge(hiddenNode, this.getHidden(), "nextSibling");
            const target = model.createPositionAfter(last);
            data.targetRanges = [ mapper.toViewRange(model.createRange(target)) ];
        }
    }

    /** Shows the blocks that contain the match of Search in note, and hides them again after. */
    private followFind(position: ModelPosition | null) {
        if (!position) {
            this.isFindClosing = true;
            void Promise.resolve().then(() => {
                this.isFindClosing = false;
            });
        }

        const owners = new Set(position && this.collapsedOwners.size
            ? this.getOwnersAt(position).map(({ owner }) => owner)
            : []);
        const isSame = owners.size === this.findRevealed.size
            && [ ...owners ].every((owner) => this.findRevealed.has(owner));
        if (!isSame) {
            this.findRevealed = owners;
            this.refreshView();
        }
    }

    /** Applies a change of the reveals to the editing view. */
    private refreshView() {
        this.hiddenCache = null;
        this.isViewStale = true;
        this.editor.editing.view.forceRender();
    }

    /**
     * The outermost hidden node that `range` reaches: a hidden ancestor of one of its ends, a
     * hidden element inside it, or `extra`.
     */
    private findHiddenNode(range: ModelRange, extra: ModelNode | null = null): ModelElement | null {
        const hidden = this.getHidden();
        const candidates = [ range.start.parent, range.end.parent, ...range.getItems(), extra ];
        for (const candidate of candidates) {
            const ancestors = candidate?.is("element")
                ? candidate.getAncestors({ includeSelf: true })
                : [];
            const hiddenAncestor = ancestors.find(
                (ancestor) => hidden.has(ancestor as ModelElement));
            if (hiddenAncestor) {
                return hiddenAncestor as ModelElement;
            }
        }
        return null;
    }

    /** The collapsed owners around the block at `position`, outermost first. */
    private getOwnersAt(position: ModelPosition): HidingOwner[] {
        const node = position.nodeAfter?.is("element") ? position.nodeAfter : position.parent;
        return this.getOwnersAround(node as ModelElement);
    }

    /** The collapsed owners whose sections contain `node` or an ancestor, outermost first. */
    private getOwnersAround(node: ModelElement): HidingOwner[] {
        const owners: HidingOwner[] = [];
        for (const ancestor of node.getAncestors({ includeSelf: true })) {
            const parent = ancestor.parent as ModelElement | null;
            if (!parent) {
                continue;
            }
            for (const provider of this.providers) {
                for (const { owner, blocks } of provider.getCollapsedSections(parent)) {
                    if (blocks.includes(ancestor as ModelElement)) {
                        owners.push({ owner, provider });
                    }
                }
            }
        }
        return owners;
    }

    /** The blocks hidden in the editing view. */
    private getHidden(): HiddenMap {
        const version = this.editor.model.document.version;
        if (this.hiddenCache?.version !== version) {
            this.hiddenCache = { version, hidden: this.collect(this.getRevealed()) };
        }
        return this.hiddenCache.hidden;
    }

    /** The owners whose blocks show for the moment. Forgets those expanded or removed since. */
    private getRevealed(): Set<ModelElement> {
        const revealed = new Set<ModelElement>();
        for (const owners of [ this.findRevealed, this.jumpRevealed ]) {
            for (const owner of owners) {
                const isCollapsed = this.providers.some(
                    ({ attribute }) => owner.hasAttribute(attribute));
                if (isInDocument(owner) && isCollapsed) {
                    revealed.add(owner);
                } else {
                    owners.delete(owner);
                }
            }
        }
        return revealed;
    }

    /** The hidden blocks of the document, leaving out those of the owners in `revealed`. */
    private collect(revealed: ReadonlySet<ModelElement>): HiddenMap {
        const hidden: HiddenMap = new Map();
        if (this.getCollapsedOwners().size) {
            for (const root of this.editor.model.document.getRoots()) {
                this.collectIn(root, revealed, hidden);
            }
        }
        return hidden;
    }

    private collectIn(
        parent: ModelElement,
        revealed: ReadonlySet<ModelElement>,
        hidden: HiddenMap
    ) {
        for (const provider of this.providers) {
            for (const { owner, blocks } of provider.getCollapsedSections(parent)) {
                // The blocks of an owner hidden by an owner before it are hidden already.
                if (revealed.has(owner) || hidden.has(owner)) {
                    continue;
                }
                const hidingOwner = { owner, provider };
                for (const block of blocks) {
                    hidden.set(block, hidingOwner);
                }
            }
        }
        for (const child of parent.getChildren()) {
            if (child.is("element") && !this.holdsText(child)) {
                this.collectIn(child, revealed, hidden);
            }
        }
    }

    /** The collapsed owners in the document. Forgets those expanded or removed since. */
    private getCollapsedOwners() {
        for (const [ owner, provider ] of this.collapsedOwners) {
            if (!isInDocument(owner) || !owner.hasAttribute(provider.attribute)) {
                this.collapsedOwners.delete(owner);
            }
        }
        return this.collapsedOwners;
    }

    /** Adds the collapsed owners that `changes` inserted or collapsed. */
    private addCollapsedOwners(changes: DifferItem[]) {
        for (const change of changes) {
            if (change.type === "insert" && change.name !== "$text") {
                this.addCollapsedOwnersIn(change.position.nodeAfter as ModelElement);
            } else if (change.type === "attribute" && change.attributeNewValue) {
                const owner = change.range.start.nodeAfter as ModelElement;
                const provider = this.providers.find(
                    ({ attribute }) => attribute === change.attributeKey);
                if (provider) {
                    this.collapsedOwners.set(owner, provider);
                }
            }
        }
    }

    private addCollapsedOwnersIn(element: ModelElement) {
        for (const provider of this.providers) {
            if (element.hasAttribute(provider.attribute)) {
                this.collapsedOwners.set(element, provider);
            }
        }
        if (!this.holdsText(element)) {
            for (const child of element.getChildren()) {
                this.addCollapsedOwnersIn(child as ModelElement);
            }
        }
    }

    private isCollapseAttribute(key: string) {
        return this.providers.some(({ attribute }) => attribute === key);
    }

    /** Whether elements named like `element` contain text, and so no blocks. */
    private holdsText(element: ModelElement) {
        let holdsText = this.textHolders.get(element.name);
        if (holdsText === undefined) {
            holdsText = this.editor.model.schema.checkChild(element, "$text");
            this.textHolders.set(element.name, holdsText);
        }
        return holdsText;
    }

}

/** A collapsed owner with the provider that collapses it. */
interface HidingOwner {
    owner: ModelElement;
    provider: HiddenBlocksProvider;
}

/** The hidden blocks, each with the owner that hides it. */
type HiddenMap = Map<ModelElement, HidingOwner>;

interface ArrowMove {
    isForward: boolean;
    isVertical: boolean;
    unit: "character" | "word";
}

interface DomPosition {
    parent: Node;
    offset: number;
}

const NOTHING_REVEALED: ReadonlySet<ModelElement> = new Set();

/** Whether `change` inserts, removes or changes an element, as opposed to only text. */
function isBlockChange(change: DifferItem) {
    return change.type === "attribute"
        ? !!change.range.start.nodeAfter?.is("element")
        : change.name !== "$text";
}

/** The first or the last of the hidden blocks in a row with `block`. */
function getRunEdge(
    block: ModelNode,
    hidden: HiddenMap,
    side: "previousSibling" | "nextSibling"
) {
    let edge = block;
    for (let node = block[side]; node && hidden.has(node as ModelElement); node = node[side]) {
        edge = node;
    }
    return edge;
}

/** Whether `node` or one of its ancestors is in `nodes`. */
function isInOrUnder(
    node: ModelNode,
    nodes: ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>
) {
    return node.getAncestors({ includeSelf: true }).some((ancestor) => nodes.has(ancestor));
}

/**
 * The view element around `element` that wraps only it, which must be hidden with it: a list
 * wrapper, as `<li>` and `<ul>` around a list item, or a container of no model element, as `<pre>`
 * around the `<code>` of a code block.
 */
function getWrapper(element: ViewElement, mapper: Mapper): ViewElement | undefined {
    const parent = element.parent as ViewElement;
    const isWrapper = parent.is("attributeElement") || (!parent.is("editableElement")
        && parent.childCount === 1 && !mapper.toModelElement(parent));
    return isWrapper ? parent : undefined;
}

function isInDocument(element: ModelElement) {
    const root = element.root;
    return root.is("rootElement") && root.rootName !== "$graveyard";
}

/** Gives `className` to the elements of `wanted`, and takes it from the others of `marked`. */
function syncClass(
    writer: ViewDowncastWriter,
    className: string,
    marked: ReadonlySet<ViewElement>,
    wanted: ReadonlySet<ViewElement>
) {
    let isChanged = false;
    for (const element of marked) {
        if (!wanted.has(element)) {
            writer.removeClass(className, element);
            isChanged = true;
        }
    }
    for (const element of wanted) {
        if (!element.hasClass(className)) {
            writer.addClass(className, element);
            isChanged = true;
        }
    }
    return isChanged;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [HiddenBlocks.pluginName]: HiddenBlocks;
    }
}
