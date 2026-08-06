import "./NodePanel.css";

import { parseMindMapNoteLink } from "@triliumnext/commons";
import type { MindElixirInstance, NodeObj, TagObj } from "mind-elixir";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import { t } from "../../../services/i18n";
import tree from "../../../services/tree";
import ValuesInput from "../../attribute_widgets/values_input";
import ActionButton from "../../react/ActionButton";
import Button from "../../react/Button";
import ColorPicker, { DEFAULT_COLOR_PALETTE } from "../../react/ColorPicker";
import { FormFileUploadActionButton } from "../../react/FormFileUpload";
import { useNote, useNoteIcon, useNoteTitle } from "../../react/hooks";
import Icon from "../../react/Icon";
import { IconPickerButton } from "../../react/IconPicker";
import OverlayPanel, { OverlayPanelBody, OverlayPanelSection, OverlayPanelTitle } from "../../react/OverlayPanel";
import SegmentedChoice from "../../react/SegmentedChoice";
import TabStrip, { type TabStripTabDefinition } from "../../react/TabStrip";
import { fitNodeImage, getNodeImageShape, nearestNodeImageWidth, NODE_IMAGE_SHAPES, NODE_IMAGE_WIDTHS, type NodeImage as NodeImageData, type NodeImageShape, shapeNodeImage, uploadNodeImage } from "./images";
import { describeExternalLink, linkFromSuggestion, suggestionFromLink } from "./links";
import NodeMemo, { getNodeMemo } from "./NodeMemo";

/**
 * The hues offered by the panel: as many of the shared palette as fit on a single row next to the
 * clear and custom cells.
 */
export const NODE_COLORS = [0, 1, 2, 4, 7, 9].map((index) => DEFAULT_COLOR_PALETTE[index]);

/**
 * Backgrounds are the same hues at a quarter opacity. That keeps a node readable when its text and
 * its background are set to "the same" color, and lets a single set of swatches sit well on both
 * the light and the dark map theme, since the tint takes on whatever the canvas is.
 */
export const NODE_BACKGROUND_COLORS = NODE_COLORS.map((color) => `${color}40`);

interface NodePanelProps {
    mind: MindElixirInstance;
    /** The note the map belongs to, which is where a picture put on a node is stored. */
    noteId: string;
    /** The currently selected nodes; the panel edits all of them at once. */
    nodes: NodeObj[];
    /**
     * The map cannot be edited, which leaves the panel the memo alone: every other field either
     * edits a node or stands for something already drawn on it, while the memo is the one thing a
     * node carries that the map itself never shows.
     */
    readOnly?: boolean;
}

/**
 * Floating panel displayed over a mind map while at least one node is selected, holding the
 * formatting controls for the selection — or, where the map is only being read, the memo of the
 * selected node and nothing else (see {@link NodePanelProps.readOnly}).
 */
export default function NodePanel({ mind, noteId, nodes, readOnly }: NodePanelProps) {
    const fontSize = getCommonValue(nodes, (node) => node.style?.fontSize);
    const textColor = getCommonValue(nodes, (node) => node.style?.color);
    const backgroundColor = getCommonValue(nodes, (node) => node.style?.background);
    const branchColor = getCommonValue(nodes, (node) => node.branchColor);
    const icons = gatherListValues(nodes, (node) => node.icons ?? []);
    const image = getCommonValue(nodes, (node) => node.image?.url);
    const imageWidth = getCommonValue(nodes, (node) => node.image && String(node.image.width));
    const imageShape = getCommonValue(nodes, (node) => node.image && getNodeImageShape(node.image)) as NodeImageShape | null | typeof MIXED;
    const link = getCommonValue(nodes, (node) => node.hyperLink);
    const tags = gatherTags(nodes);
    const memo = getCommonValue(nodes, getNodeMemo);
    const [ activeTabId, setActiveTabId ] = useState<NodePanelTabId>("format");
    const selectionKey = nodes.map((node) => node.id).join(" ");

    // The panel can be sent away while the selection it stands for is kept, for the corner of the
    // map it covers. It is only sent away for as long as that selection lasts: what brings it back
    // is selecting something — anything, this node included, once something else has been selected
    // since — which is also what a panel put away by mistake is recovered by.
    const [ dismissed, setDismissed ] = useState(false);
    useEffect(() => setDismissed(false), [ selectionKey ]);

    // The memo is built when its tab is first opened and kept mounted from then on. The editor is
    // costly to raise, and it is also what writes a memo back as the selection moves on — which
    // happens just as often while the other tab is the one on show, and has to keep working there.
    const openedTabs = useRef(new Set<NodePanelTabId>());
    openedTabs.current.add(activeTabId);

    // A map that cannot be edited is shown the memo or nothing at all: a panel holding an empty pane
    // would only stand between the reader and the map. That takes in a selection whose memos differ
    // as well — there is no one memo to show, and nothing here to fill the pane with instead.
    if (readOnly && (memo === null || memo === MIXED)) {
        return null;
    }

    if (dismissed) {
        return null;
    }

    /**
     * Applies a patch to every selected node. The selection is read back from the instance rather
     * than taken from the props, so that the elements the patch is applied to are the live ones.
     * The patch may be derived per node, for what is written depending on what a node already has.
     */
    function patchSelectedNodes(patch: Partial<NodeObj> | ((node: NodeObj) => Partial<NodeObj>)) {
        for (const topic of mind.currentNodes) {
            mind.reshapeNode(topic, typeof patch === "function" ? patch(topic.nodeObj) : patch);
        }
    }

    /**
     * Applies a patch to the nodes the panel was handed rather than to the live selection, for the
     * fields whose value lands after the panel has had its say: a memo is written as the field is
     * left, and what a user leaves it with is often the very click that selects something else,
     * while a link comes back from a dialog opened over the map. The nodes are looked up again all
     * the same, the elements a patch is applied to having to be the ones on the map.
     */
    function patchGivenNodes(patch: Partial<NodeObj>) {
        for (const node of nodes) {
            try {
                void mind.reshapeNode(mind.findEle(node.id), patch);
            } catch (e) {
                // The node is no longer on the map, or is folded away inside one that is closed.
                console.warn("Could not change a mind map node:", e);
            }
        }
    }

    /** Stores a picture on the note and gives it to the selection, if it can be taken in at all. */
    async function takeInImage(file: File) {
        const image = await uploadNodeImage(noteId, file);
        if (image) {
            patchSelectedNodes({ image });
        }
    }

    /**
     * Draws the picture of every selected node in the given shape. Worked out before any node is
     * touched — a picture returning to its own shape has to be read again for it, and a patch is
     * applied as it is handed over.
     */
    async function shapeImages(shape: NodeImageShape) {
        const shaped = new Map<string, NodeImageData>();

        await Promise.all(mind.currentNodes.map(async ({ nodeObj }) => {
            if (nodeObj.image) {
                shaped.set(nodeObj.id, await shapeNodeImage(nodeObj.image, shape));
            }
        }));

        patchSelectedNodes((node) => ({ image: shaped.get(node.id) ?? node.image }));
    }

    return (
        <OverlayPanel
            className="mind-map-node-panel"
            /* With the memo the only thing on show there is no choice to offer, so the strip gives
               way to a plain heading — the panel still says what it is holding. */
            header={readOnly ? (
                <OverlayPanelTitle icon="bx bx-notepad" text={t("mind-map.memo")} />
            ) : (
                <TabStrip
                    // A selection whose memos differ carries one all the same, which is what the
                    // tab is saying: that there is something written to go and read.
                    tabs={buildTabs(memo !== null)}
                    activeTabId={activeTabId}
                    onSelect={setActiveTabId}
                />
            )}
            close={{ text: t("mind-map.hide-panel"), onClick: () => setDismissed(true) }}
        >
            {!readOnly && <OverlayPanelBody isTab hidden={activeTabId !== "format"}>
                <OverlayPanelSection label={t("mind-map.font-size")}>
                    <SegmentedChoice
                        options={buildFontSizeOptions()}
                        currentValue={fontSize !== MIXED ? fontSize ?? DEFAULT_FONT_SIZE : MIXED_FONT_SIZE}
                        onChange={(fontSize) => patchSelectedNodes({ style: { fontSize } })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection label={t("mind-map.text-color")}>
                    <ColorPicker
                        presets={NODE_COLORS}
                        {...toPickerValue(textColor)}
                        // Mind Elixir only ever assigns the style properties it is given and never
                        // resets the ones it isn't, so clearing has to blank the property explicitly.
                        onChange={(color) => patchSelectedNodes({ style: { color: color ?? "" } })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection label={t("mind-map.background-color")}>
                    <ColorPicker
                        presets={NODE_BACKGROUND_COLORS}
                        {...toPickerValue(backgroundColor)}
                        onChange={(color) => patchSelectedNodes({ style: { background: color ?? "" } })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection label={t("mind-map.branch-color")}>
                    <ColorPicker
                        presets={NODE_COLORS}
                        {...toPickerValue(branchColor)}
                        onChange={(color) => patchSelectedNodes({ branchColor: color ?? "" })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection
                    label={t("mind-map.icons")}
                    title={icons.readOnly ? t("mind-map.icons-differ") : undefined}
                >
                    <NodeIcons
                        icons={icons.values}
                        readOnly={icons.readOnly}
                        onChange={(icons) => patchSelectedNodes({ icons })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection
                    label={t("mind-map.image")}
                    title={image === MIXED ? t("mind-map.images-differ") : undefined}
                >
                    <NodeImage
                        hasImage={!!image}
                        indeterminate={image === MIXED}
                        width={imageWidth !== MIXED && imageWidth ? Number(imageWidth) : null}
                        shape={imageShape !== MIXED ? imageShape : null}
                        onShape={(shape) => void shapeImages(shape)}
                        // A node carries one picture, so what is taken in takes the place of what was
                        // there, at the size it comes in at.
                        onPick={(file) => void takeInImage(file)}
                        // Derived per node: the nodes are set to the same width, but each keeps the
                        // proportions of the picture it carries.
                        onResize={(width) => patchSelectedNodes((node) => ({
                            image: node.image && fitNodeImage(node.image, width)
                        }))}
                        onRemove={() => patchSelectedNodes({ image: undefined })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection
                    label={t("mind-map.node-link")}
                    title={link === MIXED ? t("mind-map.links-differ") : undefined}
                >
                    <NodeLink
                        currentValue={link !== MIXED ? link : null}
                        indeterminate={link === MIXED}
                        // A node carries one link, so what is picked takes the place of what was there.
                        // Clearing blanks the property, Mind Elixir only ever assigning the ones it is
                        // given (see the colors above).
                        onChange={(link) => patchGivenNodes({ hyperLink: link ?? "" })}
                    />
                </OverlayPanelSection>

                <OverlayPanelSection
                    label={t("mind-map.tags")}
                    title={tags.readOnly ? t("mind-map.tags-differ") : undefined}
                >
                    <ValuesInput
                        labelType="text"
                        values={tags.texts}
                        placeholder={t("mind-map.tags-placeholder")}
                        addButtonText={t("mind-map.add-tag")}
                        removeButtonText={t("mind-map.remove-tag")}
                        disabled={tags.readOnly}
                        // Derived per node: the nodes agree on the texts, but each may dress its own
                        // tags differently, and that is kept by reading from the node being written to.
                        onCommit={(texts) => patchSelectedNodes((node) => ({ tags: applyTagTexts(node.tags, texts) }))}
                    />
                </OverlayPanelSection>
            </OverlayPanelBody>}

            {/* The memo goes without a label of its own: what stands above it says what it is —
                the tab it fills, or the heading where there are no tabs — and the editor is the
                whole of the tab rather than a field within it. */}
            {(readOnly || openedTabs.current.has("memo")) && (
                <OverlayPanelBody
                    className="mind-map-node-panel-memo-body"
                    isTab={!readOnly}
                    hidden={activeTabId !== "memo"}
                    title={memo === MIXED ? t("mind-map.memos-differ") : undefined}
                >
                    <NodeMemo
                        selectionKey={selectionKey}
                        memo={memo !== MIXED ? memo : null}
                        readOnly={readOnly || memo === MIXED}
                        onCommit={(memo) => patchGivenNodes({ memo } as Partial<NodeObj>)}
                    />
                </OverlayPanelBody>
            )}
        </OverlayPanel>
    );
}

type NodePanelTabId = "format" | "memo";

/**
 * The groups the panel's fields are divided into, in the order they are offered: what a node is
 * made to look like, and what is written about it.
 *
 * The memo is a tab of its own rather than the last field under the others: it is written into
 * rather than picked from, and a paragraph of prose wants the room the whole panel has — which, at
 * the foot of eight other fields, meant scrolling to the bottom to reach a box three lines tall.
 */
function buildTabs(hasMemo: boolean): TabStripTabDefinition<NodePanelTabId>[] {
    return [
        { id: "format", title: t("mind-map.tab-format"), icon: "bx bx-palette" },
        { id: "memo", title: t("mind-map.memo"), icon: hasMemo ? MEMO_WRITTEN_ICON : MEMO_BLANK_ICON }
    ];
}

/**
 * What the memo's tab wears: a pad with writing on it where the selection carries a memo, and the
 * same pad blank where it carries none.
 *
 * The tab is the only place a memo is ever announced — the map draws every other thing a node holds,
 * and draws nothing of this — so whether there is one to read is worth saying before the tab is
 * opened. The two are one shape and differ only in that one has been written on, which is the whole
 * of what the pair has to say; the blank comes from the calendar, its outline being the pad's own.
 */
const MEMO_WRITTEN_ICON = "bx bx-notepad";
const MEMO_BLANK_ICON = "bx bx-calendar-alt";

/**
 * A node of medium size is one with no size of its own: that is what a node comes with, and it
 * leaves the root, which is larger by default, at the size its level implies rather than pinning
 * it to the size of an ordinary node.
 */
export const DEFAULT_FONT_SIZE = "";

/** Matches none of the sizes, for a selection whose nodes are not all of the same size. */
const MIXED_FONT_SIZE = "mixed";

/** The sizes a node can be given, after the ones the canvas note type offers. */
function buildFontSizeOptions() {
    return [
        { value: "12px", label: t("mind-map.font-size-small") },
        { value: DEFAULT_FONT_SIZE, label: t("mind-map.font-size-medium") },
        { value: "24px", label: t("mind-map.font-size-large") },
        { value: "32px", label: t("mind-map.font-size-extra-large") }
    ];
}

/**
 * What a field standing for a property a node holds several of — its tags, its icons — shows for
 * the selection.
 *
 * Such a property belongs to a node rather than to a shape the selection shares, so a field
 * standing for several of them can only be edited where they already agree — one node always does.
 * Where they don't, the field shows everything the selection carries between them, for reading:
 * taking one as read would mean writing one node's list over another's.
 */
export function gatherListValues(nodes: NodeObj[], read: (node: NodeObj) => string[]): { values: string[], readOnly: boolean } {
    const perNode = nodes.map(read);
    const [ first = [], ...rest ] = perNode;

    if (rest.every((values) => values.length === first.length && values.every((value) => first.includes(value)))) {
        return { values: first, readOnly: false };
    }

    // In the order they are first met, so that what the node selected first carries leads.
    return { values: [ ...new Set(perNode.flat()) ], readOnly: true };
}

/**
 * The icons a node wears once the one at `index` becomes `iconClass`, or is dropped where none is
 * given. An index past the end appends, which is what the button at the end of the row stands at.
 */
export function withIconAt(icons: string[], index: number, iconClass: string | null): string[] {
    if (iconClass === null) {
        return icons.filter((_, at) => at !== index);
    }
    if (index >= icons.length) {
        return [ ...icons, iconClass ];
    }
    return icons.map((held, at) => (at === index ? iconClass : held));
}

/** The tags of the selection, by the rule above. */
export function gatherTags(nodes: NodeObj[]): { texts: string[], readOnly: boolean } {
    const { values, readOnly } = gatherListValues(nodes, (node) => (node.tags ?? []).map(getTagText));
    return { texts: values, readOnly };
}

/** The text a tag reads as, whether it carries a style of its own or is only the text. */
export function getTagText(tag: string | TagObj) {
    return typeof tag === "string" ? tag : tag.text;
}

/**
 * Turns the texts a node is now tagged with back into tags. A tag that carries a style of its own
 * is kept as it was for as long as its text is, so that a map made elsewhere doesn't lose the
 * styling of its tags to one being added beside them.
 */
export function applyTagTexts(tags: NodeObj["tags"], texts: string[]): (string | TagObj)[] {
    return texts.map((text) => tags?.find((tag) => getTagText(tag) === text) ?? text);
}

/** Turns the outcome of {@link getCommonValue} into the matching {@link ColorPicker} state. */
function toPickerValue(value: string | null | typeof MIXED) {
    return {
        currentValue: (value !== MIXED ? value : null),
        indeterminate: (value === MIXED)
    };
}

/**
 * The icons a node wears, side by side, and a button adding one more.
 *
 * Each icon is its own picker: opening it swaps that icon for whichever is chosen next, and the
 * picker's own way back — the button offering to remove it — takes it out of the row. Nothing else
 * is needed to drop one, and with no icons at all the row is the adding button alone, which says
 * plainly enough what it is for.
 */
function NodeIcons({ icons, readOnly, onChange }: {
    icons: string[];
    readOnly: boolean;
    onChange(icons: string[]): void;
}) {
    return (
        <div className="mind-map-node-icons">
            {icons.map((iconClass, index) => (
                <NodeIcon
                    // By position: a node may wear the same icon twice over, and the row is built
                    // from what it holds rather than from a set.
                    key={index}
                    face={iconClass}
                    title={t("mind-map.change-icon")}
                    disabled={readOnly}
                    onSelect={(picked) => onChange(withIconAt(icons, index, picked))}
                    onRemove={() => onChange(withIconAt(icons, index, null))}
                />
            ))}

            {!readOnly && (
                // Standing one past the end, which is where what it takes is put.
                <NodeIcon
                    face="bx bx-plus"
                    title={t("mind-map.add-icon")}
                    onSelect={(picked) => onChange(withIconAt(icons, icons.length, picked))}
                />
            )}
        </div>
    );
}

/**
 * One icon of a node, chosen through the button every other icon in Trilium is chosen through —
 * the picker under it on a desktop, and on a phone the modal a note's icon is picked in as well
 * (see {@link IconPickerButton}), rather than a menu wider than the screen hung off a panel.
 */
function NodeIcon({ face, title, disabled, onSelect, onRemove }: {
    /** The class the button wears, whether an icon of the node or the invitation to add one. */
    face: string;
    title: string;
    disabled?: boolean;
    onSelect(iconClass: string): void;
    /** Offered inside the picker. Left out — as it is on the adding button — there is nothing yet
     *  to remove. */
    onRemove?(): void;
}) {
    return (
        <IconPickerButton
            className="mind-map-node-icon"
            icon={face}
            title={title}
            disabled={disabled}
            onSelect={onSelect}
            onReset={onRemove}
            resetText={t("mind-map.clear-icon")}
        />
    );
}

/**
 * The picture a node carries: how large it is drawn, and the way to another one or to none at all.
 *
 * The picture itself is not shown again here — it is on the node, at the very size these buttons
 * set, a hand's width from the panel. What the row says instead is whether there is one: a node
 * carrying none offers the one button that takes a picture in, and every other is only there once
 * there is something for it to act on.
 */
function NodeImage({ hasImage, indeterminate, width, shape, onPick, onResize, onShape, onRemove }: {
    /** Whether the selection carries a picture at all, which is what the row offers to do with. */
    hasImage: boolean;
    /**
     * The selected nodes carry different pictures. Nothing here shows which — the nodes do — and
     * one cannot be put in the place of them all: that is a removal in all but name, and the way
     * to it is to remove them and take one in, which the rest of the row offers plainly.
     */
    indeterminate: boolean;
    /** The width they are drawn at, or `null` where the nodes disagree on one. */
    width: number | null;
    /** The shape they are drawn in, or `null` where the nodes disagree on one. */
    shape: NodeImageShape | null;
    onPick(file: File): void;
    onResize(width: number): void;
    onShape(shape: NodeImageShape): void;
    onRemove(): void;
}) {
    return (
        <div className="mind-map-node-image">
            <div className="mind-map-node-image-actions">
                {hasImage && (
                    <SegmentedChoice
                        options={buildImageWidthOptions()}
                        // Nothing is highlighted where the nodes are drawn at different widths, or
                        // where a map made elsewhere carries a width of its own.
                        currentValue={width !== null ? String(nearestNodeImageWidth(width)) : ""}
                        onChange={(width) => onResize(Number(width))}
                    />
                )}

                <FormFileUploadActionButton
                    icon={hasImage ? "bx bx-repost" : "bx bx-image-add"}
                    text={hasImage ? t("mind-map.change-image") : t("mind-map.add-image")}
                    disabled={indeterminate}
                    onChange={(files) => {
                        const file = files?.[0];
                        if (file) onPick(file);
                    }}
                />

                {hasImage && (
                    <ActionButton
                        icon="bx bx-trash"
                        text={t("mind-map.remove-image")}
                        onClick={onRemove}
                    />
                )}
            </div>

            {hasImage && (
                <SegmentedChoice
                    className="mind-map-node-image-shapes"
                    options={buildImageShapeOptions()}
                    currentValue={shape ?? ""}
                    onChange={onShape}
                />
            )}
        </div>
    );
}

/** The widths a picture is drawn at, under the same labels the text sizes wear. */
function buildImageWidthOptions() {
    const labels = [ t("mind-map.font-size-small"), t("mind-map.font-size-medium"), t("mind-map.font-size-large") ];
    return NODE_IMAGE_WIDTHS.map((width, index) => ({ value: String(width), label: labels[index] }));
}

/**
 * The shapes a picture is cut to, its own among them — each drawn as the shape it stands for, which
 * says it more plainly than its name does and leaves the three of them room in a panel this narrow.
 */
function buildImageShapeOptions() {
    const icons: Record<NodeImageShape, string> = {
        original: "bx-image",
        square: "bx-square",
        wide: "bx-rectangle"
    };
    const titles: Record<NodeImageShape, string> = {
        original: t("mind-map.image-shape-original"),
        square: t("mind-map.image-shape-square"),
        wide: t("mind-map.image-shape-wide")
    };
    return NODE_IMAGE_SHAPES.map((shape) => ({ value: shape, icon: icons[shape], title: titles[shape] }));
}

/**
 * The link a node carries: a note, or a page outside Trilium — one field, a node carrying one link.
 *
 * What the field opens is the add-link dialog every other link in Trilium is picked through, asked
 * for the target alone (`targetOnly` among its options): a node reads as its own topic, so there is
 * no title to write beside it. A dialog rather than a menu hung off the field, which is where the
 * picker used to sit — the panel stands in the corner of the map, and a menu anchored there had a
 * strip of screen to search a whole tree in, growing and shrinking under the pointer as the results
 * came in. Where the node points somewhere already, the dialog opens on it, so that changing a link
 * starts from the one being changed rather than from an empty field.
 *
 * Unlinking stands beside the field rather than inside what it opens, as it does for the picture
 * above: dropping a link is not one more note to pick from.
 */
function NodeLink({ currentValue, indeterminate, onChange }: {
    currentValue: string | null;
    indeterminate: boolean;
    onChange(link: string | null): void;
}) {
    return (
        <div className="mind-map-node-link-row">
            <Button
                className="mind-map-node-link"
                text={<NodeLinkFace link={currentValue} indeterminate={indeterminate} />}
                title={t("mind-map.choose-link")}
                onClick={() => void appContext.triggerCommand("showAddLinkDialog", {
                    text: "",
                    hasSelection: false,
                    targetOnly: true,
                    // What the node points at now, so that the dialog opens on it and says it is
                    // being changed rather than made. A selection that disagrees points at nothing
                    // one dialog could open on, and asks to be linked afresh instead.
                    currentLink: !indeterminate ? suggestionFromLink(currentValue) : undefined,
                    async addLink(target, _linkTitle, externalLink) {
                        // Only a target we can store is worth taking, as it was when the field was
                        // picked through directly.
                        const link = linkFromSuggestion(externalLink ? { externalLink: target } : { notePath: target });
                        if (link) onChange(link);
                    }
                })}
            />

            {/* Only where there is a link to drop — as with the picture, what acts on one is there
                once there is something for it to act on. */}
            {(currentValue || indeterminate) && (
                <ActionButton
                    icon="bx bx-unlink"
                    text={t("mind-map.clear-link")}
                    onClick={() => onChange(null)}
                />
            )}
        </div>
    );
}

/** What the button says the selection is linked to. */
function NodeLinkFace({ link, indeterminate }: { link: string | null, indeterminate: boolean }) {
    if (indeterminate) {
        return <><Icon icon="bx bx-link" /><span className="mind-map-node-link-label mind-map-node-link-mixed">{t("mind-map.link-mixed")}</span></>;
    }

    const notePath = parseMindMapNoteLink(link)?.notePath;
    if (notePath) {
        return <LinkedNoteFace notePath={notePath} />;
    }

    if (link) {
        return <><Icon icon="bx bx-link-external" /><span className="mind-map-node-link-label">{describeExternalLink(link)}</span></>;
    }

    return <><Icon icon="bx bx-link" /><span className="mind-map-node-link-label mind-map-node-link-empty">{t("mind-map.add-link")}</span></>;
}

/** A linked note as it is named and dressed now, rather than as it was when it was linked. */
function LinkedNoteFace({ notePath }: { notePath: string }) {
    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    const note = useNote(noteId);
    const title = useNoteTitle(noteId, parentNoteId);
    const icon = useNoteIcon(note);

    // The title is read asynchronously; until it lands, what is already known of the note stands in
    // for it, rather than the address the panel would otherwise have to show.
    return <><Icon icon={icon} /><span className="mind-map-node-link-label">{title ?? note?.title ?? ""}</span></>;
}

/** Returned instead of a value when the selected nodes don't agree on one. */
export const MIXED = Symbol("mixed");

/**
 * Reads one property off every given node, returning the value they share, `null` if none of them
 * has one, or {@link MIXED} if they disagree. Values that are unset and values that were blanked
 * out (see {@link NodePanel}) count as the same thing.
 */
export function getCommonValue(nodes: NodeObj[], read: (node: NodeObj) => string | undefined): string | null | typeof MIXED {
    let common: string | null | undefined;

    for (const node of nodes) {
        const value = read(node) || null;
        if (common === undefined) {
            common = value;
        } else if (common !== value) {
            return MIXED;
        }
    }

    return common ?? null;
}
