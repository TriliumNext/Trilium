/**
 * Derived from `BlockQuoteCommand` in `@ckeditor/ckeditor5-block-quote`.
 * Copyright (c) 2003-2026, CKSource Holding sp. z o.o. All rights reserved.
 * Used under the GPL-2.0-or-later arm of CKEditor 5's dual license; see
 * https://ckeditor.com/legal/ckeditor-licensing-options.
 *
 * Modified by the Trilium Notes contributors: the model element is `<aside>` rather than
 * `<blockQuote>` and carries an `admonitionType` attribute, so `value` reports the admonition's
 * type instead of a boolean, `execute()` takes `forceValue`/`usePreviousChoice` options resolved
 * by `_getType()`, and `_applyQuote()` retypes an admonition the selection already sits in. The
 * block grouping, splitting and merging logic is upstream's.
 */

import { Command, first } from "ckeditor5";
import type { ModelElement, ModelPosition, ModelRange, ModelSchema, ModelWriter } from "ckeditor5";

/**
 * The admonition type names, in the order they are offered in the UI.
 *
 * The user-facing titles come from `getAdmonitionTitle()` in `admonition_ui.ts`; this is the bare
 * list of names, used wherever a title is not needed (autoformat, upcast) and to drive the order of
 * the type lists that do show titles.
 */
export const ADMONITION_TYPE_NAMES = ["note", "tip", "important", "caution", "warning"] as const;
export const ADMONITION_TYPE_ATTRIBUTE = "admonitionType";
export const DEFAULT_ADMONITION_TYPE = ADMONITION_TYPE_NAMES[0];
export type AdmonitionType = typeof ADMONITION_TYPE_NAMES[number];

interface ExecuteOpts {
    /**
     * If set, it will force the command behavior: the given type is applied. If not set, the
     * command toggles — it removes the admonition when the selection already sits in one, and
     * otherwise applies {@link DEFAULT_ADMONITION_TYPE} (or the previous choice, see
     * {@link ExecuteOpts.usePreviousChoice}).
     */
    forceValue?: AdmonitionType;
    /**
     * If set to true and `forceValue` is not specified, the command will apply the previous
     * admonition type (if the command was already executed).
     */
    usePreviousChoice?: boolean;
}

/**
 * Wraps the selected blocks in an `<aside>` admonition, or unwraps them when the selection already
 * sits inside one.
 *
 * Adapted from CKEditor 5's `BlockQuoteCommand`, with the admonition type carried on the element as
 * the `admonitionType` attribute.
 */
export default class AdmonitionCommand extends Command {

    /**
     * The type of the admonition the selection sits in, or `false` when it sits in none.
     *
     * @observable
     * @readonly
     */
    declare public value: AdmonitionType | false;

    private _lastType?: AdmonitionType;

    /**
     * @inheritDoc
     */
    public override refresh(): void {
        this.value = this._getValue();
        this.isEnabled = this._checkEnabled();
    }

    /**
     * Executes the command. When the command {@link #value is on}, all top-most admonitions within
     * the selection will be removed. If it is off, all selected blocks will be wrapped with an
     * admonition.
     *
     * @fires execute
     * @param options Command options.
     */
    public override execute(options: ExecuteOpts = {}): void {
        const model = this.editor.model;
        const schema = model.schema;
        const selection = model.document.selection;

        const blocks = Array.from(selection.getSelectedBlocks());

        const value = this._getType(options);

        model.change((writer) => {
            if (!value) {
                this._removeQuote(writer, blocks.filter(findQuote));
            } else {
                const blocksToQuote = blocks.filter((block) => {
                    // Already quoted blocks needs to be considered while quoting too
                    // in order to reuse their <aside> elements.
                    return findQuote(block) || checkCanBeQuoted(schema, block);
                });

                this._applyQuote(writer, blocksToQuote, value);
            }
        });
    }

    private _getType(options: ExecuteOpts): AdmonitionType | false {
        const value = (options.forceValue === undefined) ? !this.value : options.forceValue;

        // Allow removing the admonition.
        if (!value) {
            return false;
        }

        // Prefer the type from the command, if any.
        if (typeof value === "string") {
            return value;
        }

        // See if we can restore the previous choice.
        if (options.usePreviousChoice && this._lastType) {
            return this._lastType;
        }

        // Otherwise return a default.
        return DEFAULT_ADMONITION_TYPE;
    }

    /**
     * Checks the command's {@link #value}.
     */
    private _getValue(): AdmonitionType | false {
        const selection = this.editor.model.document.selection;
        const firstBlock = first(selection.getSelectedBlocks());
        if (!firstBlock) {
            return false;
        }

        // In the current implementation, the admonition must be an immediate parent of a block element.
        const firstQuote = findQuote(firstBlock);
        if (firstQuote) {
            return firstQuote.getAttribute(ADMONITION_TYPE_ATTRIBUTE) as AdmonitionType;
        }

        return false;
    }

    /**
     * Checks whether the command can be enabled in the current context.
     *
     * @returns Whether the command should be enabled.
     */
    private _checkEnabled(): boolean {
        if (this.value) {
            return true;
        }

        const selection = this.editor.model.document.selection;
        const schema = this.editor.model.schema;

        const firstBlock = first(selection.getSelectedBlocks());

        if (!firstBlock) {
            return false;
        }

        return checkCanBeQuoted(schema, firstBlock);
    }

    /**
     * Removes the admonition from given blocks.
     *
     * If blocks which are supposed to be "unquoted" are in the middle of an admonition, start it or
     * end it, then the admonition will be split (if needed) and the blocks will be moved out of it,
     * so other quoted blocks remained quoted.
     */
    private _removeQuote(writer: ModelWriter, blocks: Array<ModelElement>): void {
        // Unquote all groups of block. Iterate in the reverse order to not break following ranges.
        getRangesOfBlockGroups(writer, blocks).reverse().forEach((groupRange) => {
            if (groupRange.start.isAtStart && groupRange.end.isAtEnd) {
                writer.unwrap(groupRange.start.parent as ModelElement);

                return;
            }

            // The group of blocks are at the beginning of an <aside> so let's move them left (out of it).
            if (groupRange.start.isAtStart) {
                const positionBefore = writer.createPositionBefore(groupRange.start.parent as ModelElement);

                writer.move(groupRange, positionBefore);

                return;
            }

            // The blocks are in the middle of an <aside> so we need to split it after the last block
            // so we move the items there.
            if (!groupRange.end.isAtEnd) {
                writer.split(groupRange.end);
            }

            // Now we are sure that groupRange.end.isAtEnd is true, so let's move the blocks right.

            const positionAfter = writer.createPositionAfter(groupRange.end.parent as ModelElement);

            writer.move(groupRange, positionAfter);
        });
    }

    /**
     * Applies the admonition to given blocks.
     */
    private _applyQuote(writer: ModelWriter, blocks: Array<ModelElement>, type?: AdmonitionType): void {
        this._lastType = type;
        const quotesToMerge: Array<ModelElement> = [];

        // Quote all groups of block. Iterate in the reverse order to not break following ranges.
        getRangesOfBlockGroups(writer, blocks).reverse().forEach((groupRange) => {
            let quote = findQuote(groupRange.start);

            if (!quote) {
                const attributes: Record<string, unknown> = {};
                attributes[ADMONITION_TYPE_ATTRIBUTE] = type;
                quote = writer.createElement("aside", attributes);

                writer.wrap(groupRange, quote);
            } else {
                writer.setAttribute(ADMONITION_TYPE_ATTRIBUTE, type, quote);
            }

            quotesToMerge.push(quote);
        });

        // Merge subsequent <aside> elements. Reverse the order again because this time we want to go
        // through them in the source order (due to how merge works – it moves the right element's
        // content to the first element and removes the right one. Since we may need to merge a couple
        // of subsequent `<aside>` elements we want to keep the reference to the first (furthest left) one.
        quotesToMerge.reverse().reduce((currentQuote, nextQuote) => {
            if (currentQuote.nextSibling == nextQuote) {
                writer.merge(writer.createPositionAfter(currentQuote));

                return currentQuote;
            }

            return nextQuote;
        });
    }

}

function findQuote(elementOrPosition: ModelElement | ModelPosition): ModelElement | null {
    const parent = elementOrPosition.parent;
    return parent?.is("element", "aside") ? parent : null;
}

/**
 * Returns a minimal array of ranges containing groups of subsequent blocks.
 *
 * content:         abcdefgh
 * blocks:          [ a, b, d, f, g, h ]
 * output ranges:   [ab]c[d]e[fgh]
 */
function getRangesOfBlockGroups(writer: ModelWriter, blocks: Array<ModelElement>): Array<ModelRange> {
    let startPosition: ModelPosition | null = null;
    let i = 0;
    const ranges: Array<ModelRange> = [];

    while (i < blocks.length) {
        const block = blocks[i];
        const nextBlock = blocks[i + 1];

        if (!startPosition) {
            startPosition = writer.createPositionBefore(block);
        }

        if (!nextBlock || block.nextSibling != nextBlock) {
            ranges.push(writer.createRange(startPosition, writer.createPositionAfter(block)));
            startPosition = null;
        }

        i++;
    }

    return ranges;
}

/**
 * Checks whether an `<aside>` can wrap the block.
 */
function checkCanBeQuoted(schema: ModelSchema, block: ModelElement): boolean {
    const isAsideAllowed = schema.checkChild(block.parent as ModelElement, "aside");
    const isBlockAllowedInAside = schema.checkChild(["$root", "aside"], block);

    return isAsideAllowed && isBlockAllowedInAside;
}
