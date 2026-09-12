import "../../attribute_widgets/attribute_name_suggestion.css";
import "./AttributeEditor.css";

import type { AttributeEditor as CKEditorAttributeEditor, ModelElement, ModelNode, ModelPosition, TriliumMentionFeed } from "@triliumnext/ckeditor5";
import { AttributeType } from "@triliumnext/commons";
import clsx from "clsx";
import { createPortal } from "preact/compat";
import { MutableRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "preact/hooks";

import type { CommandData, FilteredCommandNames } from "../../../components/app_context";
import FAttribute from "../../../entities/fattribute";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import attribute_parser, { Attribute } from "../../../services/attribute_parser";
import attribute_renderer from "../../../services/attribute_renderer";
import attributes, { isBuiltinAttribute } from "../../../services/attributes";
import dateNoteService from "../../../services/date_notes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { ATTRIBUTE_HELP_PAGE } from "../../../services/in_app_help";
import link from "../../../services/link";
import note_autocomplete, { Suggestion } from "../../../services/note_autocomplete";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import { isIMEComposing } from "../../../services/shortcuts";
import { escapeQuotes, getErrorMessage } from "../../../services/utils";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import ActionButton from "../../react/ActionButton";
import CKEditor, { CKEditorApi } from "../../react/CKEditor";
import HelpDropdown from "../../react/HelpDropdown";
import { useLegacyImperativeHandlers, useLegacyWidget, useTriliumEvent } from "../../react/hooks";
import AttributeHelp from "./AttributeHelp";

type AttributeCommandNames = FilteredCommandNames<CommandData>;

/**
 * How long the post-save blink runs for. Matches the animation in the CSS, and only serves to take the
 * class back off again — shortening it would cut the animation short.
 */
const BLINK_DURATION = 300;

// `preselectFirstItem: false` throughout: in this editor Enter means "save the attributes", so an
// open panel must not silently swallow it into committing whichever suggestion happens to be first.
const mentionSetup: TriliumMentionFeed[] = [
    {
        marker: "@",
        feed: (queryText) => note_autocomplete.autocompleteSourceForCKEditor(queryText),
        itemRenderer: (_item) => {
            const item = _item as Suggestion;
            const itemElement = document.createElement("button");

            itemElement.innerHTML = `${item.highlightedNotePathTitle} `;

            return itemElement;
        },
        minimumCharacters: 0,
        // Relation targets are note titles, which contain spaces.
        allowSpaces: true,
        preselectFirstItem: false
    },
    {
        marker: "#",
        feed: (queryText) => fetchAttributeNames("label", queryText),
        itemRenderer: (item) => renderAttributeName("label", (item as AttributeNameItem).name),
        minimumCharacters: 0,
        preselectFirstItem: false
    },
    {
        marker: "~",
        feed: (queryText) => fetchAttributeNames("relation", queryText),
        itemRenderer: (item) => renderAttributeName("relation", (item as AttributeNameItem).name),
        minimumCharacters: 0,
        preselectFirstItem: false
    }
];


interface AttributeEditorProps {
    api: MutableRef<AttributeEditorImperativeHandlers | null>;
    note: FNote;
    componentId: string;
    notePath?: string | null;
    ntxId?: string | null;
    hidden?: boolean;
    /**
     * Suppresses the editor's own `?` button, for hosts that already offer the same help elsewhere
     * (the new layout's attributes panel carries it in its title bar).
     */
    hideHelpButton?: boolean;
}

export interface AttributeEditorImperativeHandlers {
    save(): Promise<void>;
    refresh(): void;
    focus(): void;
    renderOwnedAttributes(ownedAttributes: FAttribute[]): Promise<void>;
}

export default function AttributeEditor({ api, note, componentId, notePath, ntxId, hidden, hideHelpButton }: AttributeEditorProps) {
    const [ currentValue, setCurrentValue ] = useState("");
    const [ error, setError ] = useState<unknown>();
    const [ needsSaving, setNeedsSaving ] = useState(false);
    const [ isBlinking, setIsBlinking ] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const suppressNextOnHide = useRef(false);

    const blinkTimeout = useRef<ReturnType<typeof setTimeout>>();
    const lastSavedContent = useRef<string>();
    const currentValueRef = useRef(currentValue);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<CKEditorApi>();

    // The CKEditor bundle is heavy and this component mounts in always-visible containers
    // (e.g. the status bar), so the editor class is loaded on demand to keep CKEditor out
    // of the startup module graph.
    const [ editorClass, setEditorClass ] = useState<typeof CKEditorAttributeEditor>();
    useEffect(() => {
        let active = true;
        void import("@triliumnext/ckeditor5").then((ckeditor) => {
            // Avoid a state update if the editor unmounted before the bundle finished loading.
            if (active) {
                setEditorClass(() => ckeditor.AttributeEditor);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    const [ attributeDetailWidgetEl, attributeDetailWidget ] = useLegacyWidget(() => new AttributeDetailWidget());

    useEffect(() => () => clearTimeout(blinkTimeout.current), []);

    async function renderOwnedAttributes(ownedAttributes: FAttribute[], saved: boolean) {
        // attrs are not resorted if position changes after the initial load
        ownedAttributes.sort((a, b) => a.position - b.position);

        let htmlAttrs = (`<p>${(await attribute_renderer.renderAttributes(ownedAttributes, true)).html()}</p>`);

        if (saved) {
            lastSavedContent.current = htmlAttrs;
            setNeedsSaving(false);
        }

        if (htmlAttrs.length > 0) {
            htmlAttrs += "&nbsp;";
        }

        editorRef.current?.setText(htmlAttrs);
        setCurrentValue(htmlAttrs);
    }

    function parseAttributes() {
        try {
            return attribute_parser.lexAndParse(getPreprocessedData(currentValueRef.current));
        } catch (e: unknown) {
            setError(e);
        }
    }

    async function save() {
        const attributes = parseAttributes();
        if (!attributes || !needsSaving) {
            // An error occurred and will be reported to the user, or nothing to save.
            return;
        }

        await server.put(`notes/${note.noteId}/attributes`, attributes, componentId);
        setNeedsSaving(false);

        // blink the attribute text to give a visual hint that save has been executed
        setIsBlinking(true);
        clearTimeout(blinkTimeout.current);
        blinkTimeout.current = setTimeout(() => setIsBlinking(false), BLINK_DURATION);
    }

    async function handleAddNewAttributeCommand(command: AttributeCommandNames | undefined) {
        // TODO: Not sure what the relation between FAttribute[] and Attribute[] is.
        const attrs = parseAttributes() as FAttribute[];

        if (!attrs) {
            return;
        }

        let type: AttributeType;
        let name;
        let value;

        if (command === "addNewLabel") {
            type = "label";
            name = "myLabel";
            value = "";
        } else if (command === "addNewRelation") {
            type = "relation";
            name = "myRelation";
            value = "";
        } else if (command === "addNewLabelDefinition") {
            type = "label";
            name = "label:myLabel";
            value = "promoted,single,text";
        } else if (command === "addNewRelationDefinition") {
            type = "label";
            name = "relation:myRelation";
            value = "promoted,single";
        } else {
            return;
        }

        //@ts-expect-error TODO: Incomplete type
        attrs.push({
            type,
            name,
            value,
            isInheritable: false
        });

        await renderOwnedAttributes(attrs, false);

        // this.$editor.scrollTop(this.$editor[0].scrollHeight);
        const rect = wrapperRef.current?.getBoundingClientRect();

        attributeDetailWidget.showAttributeDetail({
            allAttributes: attrs,
            attribute: attrs[attrs.length - 1],
            isOwned: true,
            x: rect ? (rect.left + rect.right) / 2 : 0,
            y: rect?.bottom ?? 0,
            focus: "name",
            parent: wrapperRef.current ?? undefined
        });
    }

    // Refresh with note
    function refresh() {
        renderOwnedAttributes(note.getOwnedAttributes(), true);
    }

    useEffect(() => refresh(), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    // Interaction with CKEditor.
    useLegacyImperativeHandlers(useMemo(() => ({
        loadReferenceLinkTitle: async ($el: JQuery<HTMLElement>, href: string) => {
            const { noteId } = link.parseNavigationStateFromUrl(href);
            const note = noteId ? await froca.getNote(noteId, true) : null;
            const title = note ? note.title : "[missing]";

            $el.text(title);
        },
        createNoteForReferenceLink: async (title: string, intoInbox: boolean) => {
            const parentNotePath = intoInbox ? await dateNoteService.getInboxNotePath() : notePath;
            if (!parentNotePath) return;

            const result = await note_create.createNoteWithTypePrompt(parentNotePath, {
                activate: false,
                title
            });

            return result?.note?.getBestNotePathString();
        }
    }), [ notePath ]));

    // Keyboard shortcuts
    useTriliumEvent("addNewLabel", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        handleAddNewAttributeCommand("addNewLabel");
    });
    useTriliumEvent("addNewRelation", ({ ntxId: eventNtxId }) => {
        if (eventNtxId !== ntxId) return;
        handleAddNewAttributeCommand("addNewRelation");
    });

    // Imperative API
    useImperativeHandle(api, () => ({
        save,
        refresh,
        renderOwnedAttributes: (attributes) => renderOwnedAttributes(attributes as FAttribute[], false),
        focus: () => editorRef.current?.focus()
    }), [ save, refresh, renderOwnedAttributes ]);

    return (
        <>
            {!hidden && <div
                className={clsx("attribute-list-editor-wrapper", isBlinking && "blink")}
                ref={wrapperRef}
                style="position: relative; padding-top: 10px; padding-bottom: 10px"
                onKeyDown={(e) => {
                    // Skip processing during IME composition
                    if (isIMEComposing(e)) {
                        return;
                    }

                    if (e.key === "Enter") {
                        // allow autocomplete to fill the result textarea
                        setTimeout(() => save(), 100);
                    }
                }}
            >   <div style="position: relative;">
                    {editorClass && <CKEditor
                        apiRef={editorRef}
                        className="attribute-list-editor"
                        tabIndex={200}
                        editor={editorClass}
                        currentValue={currentValue}
                        config={{
                            toolbar: { items: [] },
                            placeholder: t("attribute_editor.placeholder"),
                            mention: { feeds: mentionSetup },
                            licenseKey: "GPL",
                            language: "en"
                        }}
                        onChange={(currentValue) => {
                            currentValueRef.current = currentValue ?? "";

                            const oldValue = getPreprocessedData(lastSavedContent.current ?? "").trimEnd();
                            const newValue = getPreprocessedData(currentValue ?? "").trimEnd();
                            setNeedsSaving(oldValue !== newValue);
                            setError(undefined);
                        }}
                        onClick={(e, pos) => {
                            if (pos && pos.textNode && pos.textNode.data) {
                                const clickIndex = getClickIndex(pos);

                                let parsedAttrs: Attribute[];

                                try {
                                    parsedAttrs = attribute_parser.lexAndParse(getPreprocessedData(currentValueRef.current), true);
                                } catch (e: unknown) {
                                    // the input is incorrect because the user messed up with it and now needs to fix it manually
                                    console.log(e);
                                    return null;
                                }

                                let matchedAttr: Attribute | null = null;

                                for (const attr of parsedAttrs) {
                                    if (attr.startIndex !== undefined && clickIndex > attr.startIndex &&
                                        attr.endIndex !== undefined && clickIndex <= attr.endIndex) {
                                        matchedAttr = attr;
                                        break;
                                    }
                                }

                                if (matchedAttr) {
                                    attributeDetailWidget.showAttributeDetail({
                                        allAttributes: parsedAttrs,
                                        attribute: matchedAttr,
                                        isOwned: true,
                                        x: e.pageX,
                                        y: e.pageY,
                                        parent: wrapperRef.current ?? undefined
                                    });
                                } else {
                                    // Presses inside the editor no longer dismiss the popup, so
                                    // clicking next to an attribute has to close it explicitly.
                                    attributeDetailWidget.hide();
                                }
                            } else {
                                attributeDetailWidget.hide();
                            }
                        }}
                        onKeyDown={() => attributeDetailWidget.hide()}
                        onBlur={() => save()}
                        onInitialized={() => editorRef.current?.focus()}
                        disableNewlines disableSpellcheck
                    />}

                    <div className="attribute-editor-buttons">
                        { needsSaving && <ActionButton
                            icon="bx bx-save"
                            className="save-attributes-button tn-tool-button"
                            text={escapeQuotes(t("attribute_editor.save_attributes"))}
                            onClick={save}
                        /> }

                        { !hideHelpButton && (
                            // This button lives inside the wrapper the detail popup treats as its
                            // spawner, so its outside-click dismissal exempts it. Close it by hand to
                            // match the hosts whose help button sits outside (the attributes panel).
                            <HelpDropdown
                                helpPage={ATTRIBUTE_HELP_PAGE}
                                onShown={() => attributeDetailWidget.hide()}
                            >
                                <AttributeHelp />
                            </HelpDropdown>
                        ) }

                        <ActionButton
                            icon="bx bx-plus"
                            className="add-new-attribute-button tn-tool-button"
                            text={escapeQuotes(t("attribute_editor.add_a_new_attribute"))}
                            onClick={(e) => {
                                // Prevent automatic hiding of the context menu due to the button being clicked.
                                e.stopPropagation();
                                if (isMenuOpen) {
                                // If we re-show the menu, ContextMenu.show() will call hide()
                                // and immediately trigger onHide. Suppress that transient hide.
                                    suppressNextOnHide.current = true;
                                }
                                setIsMenuOpen(true);

                                contextMenu.show<AttributeCommandNames>({
                                    x: e.pageX,
                                    y: e.pageY,
                                    orientation: "left",
                                    items: [
                                        { title: t("attribute_editor.add_new_label"), command: "addNewLabel", uiIcon: "bx bx-hash" },
                                        { title: t("attribute_editor.add_new_relation"), command: "addNewRelation", uiIcon: "bx bx-transfer" },
                                        { kind: "separator" },
                                        { title: t("attribute_editor.add_new_label_definition"), command: "addNewLabelDefinition", uiIcon: "bx bx-empty" },
                                        { title: t("attribute_editor.add_new_relation_definition"), command: "addNewRelationDefinition", uiIcon: "bx bx-empty" }
                                    ],
                                    selectMenuItemHandler: (item) => handleAddNewAttributeCommand(item.command),
                                    onHide: () => {
                                        if (suppressNextOnHide.current) {
                                            suppressNextOnHide.current = false;
                                            return;
                                        }
                                        setIsMenuOpen(false);
                                    },
                                });
                            }}
                        />
                    </div>
                </div>

                { error && (
                    <div className="attribute-errors">
                        {getErrorMessage(error)}
                    </div>
                )}
            </div>}

            {createPortal(attributeDetailWidgetEl, document.body)}
        </>
    );
}

interface AttributeNameItem {
    /** The marker and the name, which is what committing the suggestion inserts. */
    id: string;
    name: string;
}

export async function fetchAttributeNames(type: "label" | "relation", queryText: string): Promise<AttributeNameItem[]> {
    const names = await server.get<string[]>(`attribute-names/?type=${type}&query=${encodeURIComponent(queryText)}`);
    const marker = type === "label" ? "#" : "~";

    return names.map((name) => ({ id: `${marker}${name}`, name }));
}

/**
 * One completed attribute name, marking the ones Trilium itself attaches a meaning to — the same
 * distinction the detail popup's name field draws, on the same names, so that the two agree.
 *
 * Built as DOM rather than rendered from the popup's `AttributeNameSuggestion` component: the mention
 * panel drops and rebuilds its rows on every keystroke with no unmount hook to run, so a Preact root
 * per row would leak. The badge markup is mirrored from `Badge` rather than restyled, so that both
 * surfaces still take their look from the one stylesheet.
 */
export function renderAttributeName(type: "label" | "relation", name: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    // `ck-button_with-text` is load-bearing, not cosmetic: the base button styles hide
    // `.ck-button__label` outright without it, leaving the row showing nothing but its badge.
    button.classList.add("ck", "ck-button", "ck-button_with-text", "attr-name-suggestion-button");

    const row = document.createElement("span");
    // The balloon hosting the panel resets everything inside it (`.ck-reset_all` zeroes borders,
    // padding, width, colour and font on every descendant), which would strip the badge back to bare
    // text. `ck-reset_all-excluded` is CKEditor's opt-out for embedded content and covers the whole
    // subtree, so the row is styled by the client's stylesheets exactly as the popup's row is.
    row.classList.add("attr-name-suggestion", "ck-reset_all-excluded");
    button.append(row);

    const label = document.createElement("span");
    label.classList.add("ck", "ck-button__label", "attr-name-suggestion-name");
    label.textContent = name;
    row.append(label);

    if (isBuiltinAttribute(type, name)) {
        const badge = document.createElement("span");
        badge.classList.add("ext-badge", "outline");
        row.append(badge);

        const badgeText = document.createElement("span");
        badgeText.classList.add("text");
        badgeText.textContent = t("attribute_names.system");
        badge.append(badgeText);
    }

    return button;
}

/** The attributes as plain text: reference links back down to their note path, entities resolved. */
export function getPreprocessedData(currentValue: string) {
    const str = currentValue
        .replace(/<a[^>]+href="(#[A-Za-z0-9_/]*)"[^>]*>[^<]*<\/a>/g, "$1")
        .replace(/&nbsp;/g, " "); // otherwise .text() below outputs non-breaking space in unicode

    return $("<div>").html(str).text();
}

/**
 * Where the press landed in {@link getPreprocessedData}'s text, which is what the parsed attributes
 * carry their offsets in: the editor's own offset counts a reference link as one node, so every
 * sibling before the pressed one is measured as the text it stands for.
 */
export function getClickIndex(pos: ModelPosition) {
    let clickIndex = pos.offset - (pos.textNode?.startOffset ?? 0);

    let curNode: ModelNode | Text | ModelElement | null = pos.textNode;

    while (curNode?.previousSibling) {
        curNode = curNode.previousSibling;

        if ((curNode as ModelElement).name === "reference") {
            clickIndex += (curNode.getAttribute("href") as string).length + 1;
        } else if ("data" in curNode) {
            clickIndex += (curNode.data as string).length;
        }
    }

    return clickIndex;
}
