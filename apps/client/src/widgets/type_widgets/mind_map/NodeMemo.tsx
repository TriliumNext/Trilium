import "./NodeMemo.css";

import { AttributeEditor, type CKTextEditor, type EditorConfig, MEMO_PLUGINS } from "@triliumnext/ckeditor5";
import type { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import type { NodeObj, Topic } from "mind-elixir";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { escapeHtml } from "../../../services/utils";
import CKEditor, { type CKEditorApi } from "../../react/CKEditor";
import { useTriliumOption } from "../../react/hooks";

/**
 * The memo a node carries: text kept about it, which the map itself never shows.
 *
 * Written as the field is left rather than as it is typed, which is what the textarea it replaces
 * did: a memo is written a paragraph at a time, and taking every keystroke would mean a copy of the
 * whole map in the undo stack for each of them.
 */
export default function NodeMemo({ selectionKey, memo, readOnly, onCommit }: {
    /**
     * What the panel currently stands for. The field is one editor for however many nodes are
     * selected over its lifetime, so it is told when that changes: the memo shown is the memo of
     * whatever is selected now, and what was typed for what came before belongs to those nodes.
     */
    selectionKey: string;
    memo: string | null;
    readOnly: boolean;
    onCommit(html: string): void;
}) {
    const apiRef = useRef<CKEditorApi>();
    const editorRef = useRef<CKTextEditor>(null);
    const [ uiLanguage ] = useTriliumOption("locale");
    const html = toMemoHtml(memo);
    // Both are stamped with the selection they belong to: what the field was handed, and what it
    // holds now. The editor reports a change for a memo handed to it as readily as for one typed,
    // so without the stamp the memo of a node just selected passes for something typed for the one
    // just left — and is written over it.
    const shown = useRef({ key: selectionKey, html });
    const typed = useRef(shown.current);
    // The selection as it stands while the editor is reporting, which is a render behind the refs.
    const currentKey = useRef(selectionKey);
    currentKey.current = selectionKey;

    function commit(key: string) {
        if (readOnly || typed.current.key !== key || typed.current.html === shown.current.html) return;
        shown.current = typed.current;
        onCommit(typed.current.html);
    }

    /*
     * Taken up as the selection changes, and written back before it does.
     *
     * A layout effect rather than a plain one: its cleanup then runs within the same commit, ahead
     * of the editor being handed the new memo — which is a plain effect of the field below, and
     * would otherwise land first and take what was typed with it.
     */
    useLayoutEffect(() => {
        shown.current = { key: selectionKey, html };
        typed.current = shown.current;
        // Said outright rather than left to the field to notice: it sets what it is given only when
        // that differs from what it was given last, and two nodes carrying the same memo — no memo
        // at all, most of the time — are the same value. Whatever was typed for the node just left
        // would then simply stay on the page as the memo of the one just selected.
        apiRef.current?.setText(html);

        return () => commit(selectionKey);
    }, [ selectionKey ]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        if (readOnly) {
            editor.enableReadOnlyMode(MEMO_READ_ONLY_LOCK);
        } else {
            editor.disableReadOnlyMode(MEMO_READ_ONLY_LOCK);
        }
    }, [ readOnly ]);

    return (
        <CKEditor
            apiRef={apiRef}
            className="mind-map-node-memo"
            editor={AttributeEditor}
            config={buildMemoEditorConfig()}
            uiLanguage={uiLanguage as DISPLAYABLE_LOCALE_IDS}
            currentValue={html}
            onChange={(html) => (typed.current = { key: currentKey.current, html: html ?? "" })}
            onInitialized={(editor) => {
                editorRef.current = editor;
                if (readOnly) {
                    editor.enableReadOnlyMode(MEMO_READ_ONLY_LOCK);
                }

                // The editor's own account of being left: a `blur` of the box it writes into does
                // not reach the element around it, so there is nothing there to listen for.
                editor.ui.focusTracker.on("change:isFocused", (_event, _name, isFocused) => {
                    if (!isFocused) commit(currentKey.current);
                });
            }}
        />
    );
}

/**
 * Built where it is used rather than kept still beside the module: the hint is a translated string,
 * and the catalogue is not yet loaded when this module is. Nothing is spent on rebuilding it — an
 * editor is raised from the configuration it is handed as it mounts, and never reconfigured.
 *
 * The language is not among what is settled here: the strings on show are CKEditor's own, and their
 * dictionary has to be fetched, which is done for the field by the wrapper that raises the editor
 * (see the `uiLanguage` it is handed).
 */
function buildMemoEditorConfig(): EditorConfig {
    return {
        extraPlugins: MEMO_PLUGINS,
        toolbar: { items: MEMO_TOOLBAR_ITEMS },
        placeholder: t("mind-map.memo-placeholder"),
        licenseKey: "GPL"
    };
}

/**
 * What the toolbar over a selection offers. A memo is written in sentences, so what it holds is what
 * a sentence is marked up with and nothing beyond: no headings, which a pane this narrow has no use
 * for, and no colors, which are the map's business rather than the memo's.
 *
 * The toolbar itself is the editor's own. An {@link AttributeEditor} is a `BalloonEditor`, which
 * raises whatever it is configured with over the selection — this list is the whole of the feature,
 * the panel that shows it having been there, empty, all along.
 */
const MEMO_TOOLBAR_ITEMS = [
    "bold", "italic", "strikethrough", "code",
    "|", "link",
    "|", "bulletedList", "numberedList",
    "|", "blockQuote", "codeBlock"
];

/** Held while the selection disagrees, there being no one memo to write over the others. */
const MEMO_READ_ONLY_LOCK = "mind-map-node-memo";

/**
 * A node's memo: what the node menu Trilium used to carry wrote into `nodeObj.memo`, from a plain
 * textarea, and what maps made since then hold.
 *
 * Mind Elixir neither declares the field nor renders it — it survives only because everything but a
 * node's parent is serialized — and the `note` it does declare is a different field the menu never
 * wrote. Keeping to `memo` is what keeps those memos the ones being read and written here.
 */
export function getNodeMemo(node: NodeObj) {
    return (node as NodeObj & { memo?: string }).memo;
}

/**
 * The memo as the editor takes it.
 *
 * A memo written through the old textarea is plain text, so one carrying no markup at all is
 * escaped into paragraphs rather than read as HTML — otherwise a `<` someone typed would swallow
 * what follows it, and the memo would come back shorter than it was written.
 */
export function toMemoHtml(memo: string | null | undefined) {
    if (!memo) return "";
    if (/<[a-z][\s\S]*>/i.test(memo)) return memo;

    return memo.split(/\r?\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

/**
 * Worn on the map by a node there is a memo about, which is what draws the mark. See MindMap.css.
 *
 * An attribute rather than a class: selecting a node sets `className` outright — Mind Elixir writes
 * `"selected"` over whatever the node wore — and unselecting only takes that word off again, so a
 * class of ours would leave with the first click and stay gone until the map was next laid out.
 */
export const MEMO_MARKER_ATTRIBUTE = "data-has-memo";

/**
 * Marks every node on the map carrying a memo, and unmarks every node that no longer carries one.
 *
 * A memo is the one thing a node holds that the map draws nothing of — its colors, its icons, its
 * picture, its link and its tags are all on the node itself — so without a mark there is no telling
 * a node written about from a node not, short of selecting it and opening the tab. That matters most
 * on a map that can only be read, where a reader has no reason to click anything at all.
 *
 * The mark is left to CSS, this putting only the attribute on: drawn beside the text rather than in
 * the flow of it, it changes no box, so — unlike the icons, which are dressed in the same pass — it
 * costs the map no second measuring. It is out of an exported picture for the same reason, which is
 * where it belongs: a mark saying there is writing here to go and read means nothing in a picture
 * there is no reading it from.
 *
 * Called for the whole map after every layout, which is what follows any change to a node.
 *
 * @param container the element holding the rendered nodes.
 */
export function renderMemoMarkers(container: HTMLElement) {
    for (const topic of container.querySelectorAll<Topic>("me-tpc")) {
        // Anything written at all, as the panel's own tab reads it (see `getCommonValue`), so that
        // the two never disagree over a memo one of them counts and the other does not.
        const memo = topic.nodeObj && getNodeMemo(topic.nodeObj);
        topic.toggleAttribute(MEMO_MARKER_ATTRIBUTE, !!memo);
    }
}
