import { AttributeEditor as CKEditorAttributeEditor, MentionFeed, ModelElement, ModelNode, ModelPosition } from "@triliumnext/ckeditor5";
import { AttributeType } from "@triliumnext/commons";
import { MutableRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "preact/hooks";

import type { CommandData, FilteredCommandNames } from "../../../components/app_context";
import FAttribute from "../../../entities/fattribute";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import attribute_parser, { Attribute } from "../../../services/attribute_parser";
import attribute_renderer from "../../../services/attribute_renderer";
import attributes from "../../../services/attributes";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import note_autocomplete, { Suggestion } from "../../../services/note_autocomplete";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import { isIMEComposing } from "../../../services/shortcuts";
import { escapeQuotes, getErrorMessage } from "../../../services/utils";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import ActionButton from "../../react/ActionButton";
import CKEditor, { CKEditorApi } from "../../react/CKEditor";
import { useLegacyImperativeHandlers, useLegacyWidget, useTooltip, useTriliumEvent, useTriliumOption } from "../../react/hooks";

type AttributeCommandNames = FilteredCommandNames<CommandData>;

const HELP_TEXT = `
<p>${t("attribute_editor.help_text_body1")}</p>

<p>${t("attribute_editor.help_text_body2")}</p>

<p>${t("attribute_editor.help_text_body3")}</p>`;

const mentionSetup: MentionFeed[] = [
    {
        marker: "@",
        feed: (queryText) => note_autocomplete.autocompleteSourceForCKEditor(queryText),
        itemRenderer: (_item) => {
            const item = _item as Suggestion;
            const itemElement = document.createElement("button");

            itemElement.innerHTML = `${item.highlightedNotePathTitle} `;

            return itemElement;
        },
        minimumCharacters: 0
    },
    {
        marker: "#",
        feed: async (queryText) => {
            const names = await server.get<string[]>(`attribute-names/?type=label&query=${encodeURIComponent(queryText)}`);

            return names.map((name) => {
                return {
                    id: `#${name}`,
                    name
                };
            });
        },
        minimumCharacters: 0
    },
    {
        marker: "~",
        feed: async (queryText) => {
            const names = await server.get<string[]>(`attribute-names/?type=relation&query=${encodeURIComponent(queryText)}`);

            return names.map((name) => {
                return {
                    id: `~${name}`,
                    name
                };
            });
        },
        minimumCharacters: 0
    }
];


interface AttributeEditorProps {
    api: MutableRef<AttributeEditorImperativeHandlers | null>;
    note: FNote;
    componentId: string;
    notePath?: string | null;
    ntxId?: string | null;
    hidden?: boolean;
}

export interface AttributeEditorImperativeHandlers {
    save(): Promise<void>;
    refresh(): void;
    focus(): void;
    renderOwnedAttributes(ownedAttributes: FAttribute[]): Promise<void>;
}

export default function AttributeEditor({ api, note, componentId, notePath, ntxId, hidden }: AttributeEditorProps) {
    const [ currentValue, setCurrentValue ] = useState("");
    const [ state, setState ] = useState<"normal" | "showHelpTooltip" | "showAttributeDetail">();
    const [ error, setError ] = useState<unknown>();
    const [ needsSaving, setNeedsSaving ] = useState(false);

    const lastSavedContent = useRef<string>();
    const currentValueRef = useRef(currentValue);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<CKEditorApi>();
    const [ locale ] = useTriliumOption("locale");

    const { showTooltip, hideTooltip } = useTooltip(wrapperRef, {
        trigger: "focus",
        html: true,
        title: HELP_TEXT,
        placement: "bottom",
        offset: "0,30"
    });

    const [ attributeDetailWidgetEl, attributeDetailWidget ] = useLegacyWidget(() => new AttributeDetailWidget());

    useEffect(() => {
        if (state === "showHelpTooltip") {
            showTooltip();
        } else {
            hideTooltip();
        }
    }, [ state ]);

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
        if (wrapperRef.current) {
            wrapperRef.current.style.opacity = "0";
            setTimeout(() => {
                if (wrapperRef.current) {
                    wrapperRef.current.style.opacity = "1";
                }
            }, 100);
        }
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

        setTimeout(() => {
            // showing a little bit later because there's a conflict with outside click closing the attr detail
            attributeDetailWidget.showAttributeDetail({
                allAttributes: attrs,
                attribute: attrs[attrs.length - 1],
                isOwned: true,
                x: rect ? (rect.left + rect.right) / 2 : 0,
                y: rect?.bottom ?? 0,
                focus: "name"
            });
        }, 100);
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
        createNoteForReferenceLink: async (title: string) => {
            let result;
            if (notePath) {
                result = await note_create.createNoteWithTypePrompt(notePath, {
                    activate: false,
                    title
                });
            }

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
                className="attribute-list-editor-wrapper"
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
                    <CKEditor
                        apiRef={editorRef}
                        className="attribute-list-editor"
                        tabIndex={200}
                        editor={CKEditorAttributeEditor}
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
                                    if (attr.startIndex && clickIndex > attr.startIndex && attr.endIndex && clickIndex <= attr.endIndex) {
                                        matchedAttr = attr;
                                        break;
                                    }
                                }

                                setTimeout(() => {
                                    if (matchedAttr) {
                                        attributeDetailWidget.showAttributeDetail({
                                            allAttributes: parsedAttrs,
                                            attribute: matchedAttr,
                                            isOwned: true,
                                            x: e.pageX,
                                            y: e.pageY
                                        });
                                        setState("showAttributeDetail");
                                    } else {
                                        setState("showHelpTooltip");
                                    }
                                }, 100);
                            } else {
                                setState("showHelpTooltip");
                            }
                        }}
                        onKeyDown={() => attributeDetailWidget.hide()}
                        onBlur={() => save()}
                        onInitialized={() => editorRef.current?.focus()}
                        disableNewlines disableSpellcheck
                    />

                    <div className="attribute-editor-buttons">
                        { needsSaving && <ActionButton
                            icon="bx bx-save"
                            className="save-attributes-button tn-tool-button"
                            text={escapeQuotes(t("attribute_editor.save_attributes"))}
                            onClick={save}
                        /> }

                        <ActionButton
                            icon="bx bx-plus"
                            className="add-new-attribute-button tn-tool-button"
                            text={escapeQuotes(t("attribute_editor.add_a_new_attribute"))}
                            onClick={(e) => {
                                // Prevent automatic hiding of the context menu due to the button being clicked.
                                e.stopPropagation();

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
                                    selectMenuItemHandler: (item) => handleAddNewAttributeCommand(item.command)
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

            {attributeDetailWidgetEl}
        </>
    );
}

function getPreprocessedData(currentValue: string) {
    const str = currentValue
        .replace(/<a[^>]+href="(#[A-Za-z0-9_/]*)"[^>]*>[^<]*<\/a>/g, "$1")
        .replace(/&nbsp;/g, " "); // otherwise .text() below outputs non-breaking space in unicode

    return $("<div>").html(str).text();
}

function getClickIndex(pos: ModelPosition) {
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
