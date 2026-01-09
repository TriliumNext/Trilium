import "./StatusBar.css";

import { Locale, NoteType } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import clsx from "clsx";
import { type ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { CommandNames } from "../../components/app_context";
import NoteContext from "../../components/note_context";
import FNote, { NOTE_TYPE_ICONS } from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import { ViewScope } from "../../services/link";
import { NOTE_TYPES } from "../../services/note_types";
import server from "../../services/server";
import { openInAppHelpFromUrl } from "../../services/utils";
import { formatDateTime } from "../../utils/formatters";
import { BacklinksList, useBacklinkCount } from "../FloatingButtonsDefinitions";
import Dropdown, { DropdownProps } from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useActiveNoteContext, useLegacyImperativeHandlers, useNoteLabel, useNoteProperty, useStaticTooltip, useTriliumEvent, useTriliumEvents } from "../react/hooks";
import Icon from "../react/Icon";
import LinkButton from "../react/LinkButton";
import { ParentComponent } from "../react/react_utils";
import { ContentLanguagesModal, NoteTypeCodeNoteList, NoteTypeOptionsModal, useLanguageSwitcher, useMimeTypes } from "../ribbon/BasicPropertiesTab";
import AttributeEditor, { AttributeEditorImperativeHandlers } from "../ribbon/components/AttributeEditor";
import InheritedAttributesTab from "../ribbon/InheritedAttributesTab";
import { NoteSizeWidget, useNoteMetadata } from "../ribbon/NoteInfoTab";
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";
import SimilarNotesTab from "../ribbon/SimilarNotesTab";
import { useAttachments } from "../type_widgets/Attachment";
import { useProcessedLocales } from "../type_widgets/options/components/LocaleSelector";
import Breadcrumb from "./Breadcrumb";

interface StatusBarContext {
    note: FNote;
    notePath: string | null | undefined;
    noteContext: NoteContext;
    viewScope?: ViewScope;
    hoistedNoteId?: string;
}

export default function StatusBar() {
    const { note, notePath, noteContext, viewScope, hoistedNoteId } = useActiveNoteContext();
    const [ activePane, setActivePane ] = useState<"attributes" | "similar-notes" | false>(false);
    const context: StatusBarContext | undefined | null = note && noteContext && { note, notePath, noteContext, viewScope, hoistedNoteId };
    const attributesContext: AttributesProps | undefined | null = context && {
        ...context,
        attributesShown: activePane === "attributes",
        setAttributesShown: (shown) => setActivePane(shown && "attributes")
    };
    const noteInfoContext: NoteInfoContext | undefined | null = context && {
        ...context,
        similarNotesShown: activePane === "similar-notes",
        setSimilarNotesShown: (shown) => setActivePane(shown && "similar-notes")
    };
    const isHiddenNote = note?.isInHiddenSubtree();

    return (
        <div className="status-bar">
            {attributesContext && <AttributesPane {...attributesContext} />}
            {noteInfoContext && <SimilarNotesPane {...noteInfoContext} />}

            <div className="status-bar-main-row">
                {context && attributesContext && noteInfoContext && <>
                    <Breadcrumb />

                    <div className="actions-row">
                        <CodeNoteSwitcher {...context} />
                        <LanguageSwitcher {...context} />
                        {!isHiddenNote && <NotePaths {...context} />}
                        <AttributesButton {...attributesContext} />
                        <AttachmentCount {...context} />
                        <BacklinksBadge {...context} />
                        <NoteInfoBadge {...noteInfoContext} />
                    </div>
                </>}
            </div>
        </div>
    );
}

function StatusBarDropdown({ children, icon, text, buttonClassName, titleOptions, dropdownOptions, ...dropdownProps }: Omit<DropdownProps, "hideToggleArrow" | "title" | "titlePosition"> & {
    title: string;
    icon?: string;
}) {
    return (
        <Dropdown
            buttonClassName={clsx("status-bar-dropdown-button", buttonClassName)}
            titlePosition="top"
            titleOptions={{
                popperConfig: {
                    ...titleOptions?.popperConfig,
                    strategy: "fixed"
                },
                animation: false,
                ...titleOptions
            }}
            dropdownOptions={{
                popperConfig: {
                    strategy: "fixed",
                    placement: "top"
                },
                ...dropdownOptions
            }}
            text={<>
                {icon && (<><Icon icon={icon} />&nbsp;</>)}
                <span className="text">{text}</span>
            </>}
            {...dropdownProps}
        >
            {children}
        </Dropdown>
    );
}

interface StatusBarButtonBaseProps {
    className?: string;
    icon: string;
    title: string;
    text: string | number;
    disabled?: boolean;
    active?: boolean;
}

type StatusBarButtonWithCommand = StatusBarButtonBaseProps & { triggerCommand: CommandNames; };
type StatusBarButtonWithClick = StatusBarButtonBaseProps & { onClick: () => void; };

function StatusBarButton({ className, icon, text, title, active, ...restProps }: StatusBarButtonWithCommand | StatusBarButtonWithClick) {
    const parentComponent = useContext(ParentComponent);
    const buttonRef = useRef<HTMLButtonElement>(null);
    useStaticTooltip(buttonRef, {
        placement: "top",
        fallbackPlacements: [ "top" ],
        popperConfig: { strategy: "fixed" },
        animation: false,
        title
    });

    return (
        <button
            ref={buttonRef}
            className={clsx("btn select-button focus-outline", className, active && "active")}
            type="button"
            onClick={() => {
                if ("triggerCommand" in restProps) {
                    parentComponent?.triggerCommand(restProps.triggerCommand);
                } else {
                    restProps.onClick();
                }
            }}
        >
            <Icon icon={icon} />&nbsp;<span className="text">{text}</span>
        </button>
    );
}

//#region Language Switcher
function LanguageSwitcher({ note }: StatusBarContext) {
    const [ modalShown, setModalShown ] = useState(false);
    const { locales, DEFAULT_LOCALE, currentNoteLanguage, setCurrentNoteLanguage } = useLanguageSwitcher(note);
    const { activeLocale, processedLocales } = useProcessedLocales(locales, DEFAULT_LOCALE, currentNoteLanguage ?? DEFAULT_LOCALE.id);

    return (
        <>
            {note.type === "text" && <StatusBarDropdown
                icon="bx bx-globe"
                title={t("status_bar.language_title")}
                text={<span dir={activeLocale?.rtl ? "rtl" : "ltr"}>{getLocaleName(activeLocale)}</span>}
            >
                {processedLocales.map((locale, index) =>
                    (typeof locale === "object") ? (
                        <FormListItem
                            key={locale.id}
                            rtl={locale.rtl}
                            checked={locale.id === currentNoteLanguage}
                            onClick={() => setCurrentNoteLanguage(locale.id)}
                        >{locale.name}</FormListItem>
                    ) : (
                        <FormDropdownDivider key={`divider-${index}`} />
                    )
                )}
                <FormDropdownDivider />
                <FormListItem
                    onClick={() => openInAppHelpFromUrl("veGu4faJErEM")}
                    icon="bx bx-help-circle"
                >{t("note_language.help-on-languages")}</FormListItem>
                <FormListItem
                    onClick={() => setModalShown(true)}
                    icon="bx bx-cog"
                >{t("note_language.configure-languages")}</FormListItem>
            </StatusBarDropdown>}
            {createPortal(
                <ContentLanguagesModal modalShown={modalShown} setModalShown={setModalShown} />,
                document.body
            )}
        </>
    );
}

export function getLocaleName(locale: Locale | null | undefined) {
    if (!locale) return "";
    if (!locale.id) return "-";
    if (locale.name.length <= 4 || locale.rtl) return locale.name;    // Some locales like Japanese and Chinese look better than their ID.
    return locale.id
        .replace("_", "-")
        .toLocaleUpperCase();
}
//#endregion

//#region Note info & Similar
interface NoteInfoContext extends StatusBarContext {
    similarNotesShown: boolean;
    setSimilarNotesShown: (value: boolean) => void;
}

export function NoteInfoBadge(context: NoteInfoContext) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const [ dropdownShown, setDropdownShown ] = useState(false);
    const { note, similarNotesShown, setSimilarNotesShown } = context;
    const noteType = useNoteProperty(note, "type");
    const enabled = note && noteType;

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabNoteInfo", () => enabled && dropdownRef.current?.show());
    useTriliumEvent("toggleRibbonTabSimilarNotes", () => setSimilarNotesShown(!similarNotesShown));

    return (enabled &&
        <StatusBarDropdown
            icon="bx bx-info-circle"
            title={t("status_bar.note_info_title")}
            dropdownRef={dropdownRef}
            dropdownContainerClassName="dropdown-note-info"
            dropdownOptions={{autoClose: "outside" }}
            onShown={() => setDropdownShown(true)}
            onHidden={() => setDropdownShown(false)}
        >
            {dropdownShown && <NoteInfoContent {...context} dropdownRef={dropdownRef} noteType={noteType} />}
        </StatusBarDropdown>
    );
}

function NoteInfoContent({ note, setSimilarNotesShown, noteType, dropdownRef }: NoteInfoContext & {
    dropdownRef: RefObject<BootstrapDropdown>;
    noteType: NoteType;
}) {
    const { metadata, ...sizeProps } = useNoteMetadata(note);
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const noteTypeMapping = useMemo(() => NOTE_TYPES.find(t => t.type === noteType), [ noteType ]);

    return (
        <>
            <ul>
                {originalFileName && <NoteInfoValue text={t("file_properties.original_file_name")} value={originalFileName} />}
                <NoteInfoValue text={t("note_info_widget.created")} value={formatDateTime(metadata?.dateCreated)} />
                <NoteInfoValue text={t("note_info_widget.modified")} value={formatDateTime(metadata?.dateModified)} />
                {noteTypeMapping && <NoteInfoValue text={t("note_info_widget.type")} value={<><Icon icon={`bx ${noteTypeMapping.icon ?? NOTE_TYPE_ICONS[noteType]}`}/>{" "}{noteTypeMapping?.title}</>} />}
                {note.mime && <NoteInfoValue text={t("note_info_widget.mime")} value={note.mime} />}
                <NoteInfoValue text={t("note_info_widget.note_id")} value={<code>{note.noteId}</code>} />
                <NoteInfoValue text={t("note_info_widget.note_size")} title={t("note_info_widget.note_size_info")} value={<NoteSizeWidget {...sizeProps} />} />
            </ul>

            <LinkButton
                text={t("note_info_widget.show_similar_notes")}
                onClick={() => {
                    dropdownRef.current?.hide();
                    setSimilarNotesShown(true);
                }}
            />
        </>
    );
}

function NoteInfoValue({ text, title, value }: { text: string; title?: string, value: ComponentChildren }) {
    return (
        <li>
            <strong title={title}>{text}{": "}</strong>
            <span>{value}</span>
        </li>
    );
}

function SimilarNotesPane({ note, similarNotesShown, setSimilarNotesShown }: NoteInfoContext) {
    return (similarNotesShown &&
        <BottomPanel title={t("similar_notes.title")}
            className="similar-notes-pane"
            visible={similarNotesShown}
            setVisible={setSimilarNotesShown}
        >
            <SimilarNotesTab note={note} />
        </BottomPanel>
    );
}
//#endregion

//#region Backlinks
function BacklinksBadge({ note, viewScope }: StatusBarContext) {
    const count = useBacklinkCount(note, viewScope?.viewMode === "default");
    return (note && count > 0 &&
        <StatusBarDropdown
            className="backlinks-badge backlinks-widget"
            icon="bx bx-link"
            text={t("status_bar.backlinks", { count })}
            title={t("status_bar.backlinks_title", { count })}
            dropdownContainerClassName="backlinks-items"
        >
            <BacklinksList note={note} />
        </StatusBarDropdown>
    );
}
//#endregion

//#region Attachment count
function AttachmentCount({ note }: StatusBarContext) {
    const attachments = useAttachments(note);
    const count = attachments.length;

    return (note && count > 0 &&
        <StatusBarButton
            className="attachment-count-button"
            icon="bx bx-paperclip"
            text={t("status_bar.attachments", { count })}
            title={t("status_bar.attachments_title", { count })}
            triggerCommand="showAttachments"
        />
    );
}
//#endregion

//#region Attributes
interface AttributesProps extends StatusBarContext {
    attributesShown: boolean;
    setAttributesShown: (shown: boolean) => void;
}

function AttributesButton({ note, attributesShown, setAttributesShown }: AttributesProps) {
    const [ count, setCount ] = useState(note.attributes.length);

    const refreshCount = useCallback((note: FNote) => {
        return note.getAttributes().filter(a => !a.isAutoLink).length;
    }, []);

    // React to note changes.
    useEffect(() => {
        setCount(refreshCount(note));
    }, [ note, refreshCount ]);

    // React to changes in count.
    useTriliumEvent("entitiesReloaded", (({loadResults}) => {
        if (loadResults.getAttributeRows().some(attr => attributes.isAffecting(attr, note))) {
            setCount(refreshCount(note));
        }
    }));

    return (
        <StatusBarButton
            className="attributes-button"
            icon="bx bx-list-check"
            title={t("status_bar.attributes_title")}
            text={t("status_bar.attributes", { count })}
            active={attributesShown}
            onClick={() => setAttributesShown(!attributesShown)}
        />
    );
}

function AttributesPane({ note, noteContext, attributesShown, setAttributesShown }: AttributesProps) {
    const parentComponent = useContext(ParentComponent);
    const api = useRef<AttributeEditorImperativeHandlers>(null);

    const context = parentComponent && {
        componentId: parentComponent.componentId,
        note,
        hidden: !note
    };

    // Show on keyboard shortcuts.
    useTriliumEvents([ "addNewLabel", "addNewRelation" ], () => setAttributesShown(true));
    useTriliumEvents([ "toggleRibbonTabOwnedAttributes", "toggleRibbonTabInheritedAttributes" ], () => setAttributesShown(!attributesShown));

    // Auto-focus the owned attributes.
    useEffect(() => api.current?.focus(), [ attributesShown ]);

    // Interaction with the attribute editor.
    useLegacyImperativeHandlers(useMemo(() => ({
        saveAttributesCommand: () => api.current?.save(),
        reloadAttributesCommand: () => api.current?.refresh(),
        updateAttributeListCommand: ({ attributes }) => api.current?.renderOwnedAttributes(attributes)
    }), [ api ]));

    return (context &&
        <BottomPanel title={t("attributes_panel.title")}
            className="attribute-list"
            visible={attributesShown}
            setVisible={setAttributesShown}>

            <span class="attributes-panel-label">{t("inherited_attribute_list.title")}</span>
            <InheritedAttributesTab {...context} emptyListString="inherited_attribute_list.none" />

            <AttributeEditor
                {...context}
                api={api}
                ntxId={noteContext.ntxId}
            />
        </BottomPanel>
    );
}
//#endregion

//#region Note paths
function NotePaths({ note, hoistedNoteId, notePath }: StatusBarContext) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const count = sortedNotePaths?.length ?? 0;
    const enabled = count > 1;

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabNotePaths", () => enabled && dropdownRef.current?.show());

    return (enabled &&
        <StatusBarDropdown
            title={t("status_bar.note_paths_title")}
            dropdownRef={dropdownRef}
            dropdownContainerClassName="dropdown-note-paths"
            icon="bx bx-directions"
            text={t("status_bar.note_paths", { count })}
        >
            <NotePathsWidget
                sortedNotePaths={sortedNotePaths}
                currentNotePath={notePath}
            />
        </StatusBarDropdown>
    );
}
//#endregion

//#region Code note switcher
function CodeNoteSwitcher({ note }: StatusBarContext) {
    const [ modalShown, setModalShown ] = useState(false);
    const currentNoteMime = useNoteProperty(note, "mime");
    const mimeTypes = useMimeTypes();
    const correspondingMimeType = useMemo(() => (
        mimeTypes.find(m => m.mime === currentNoteMime)
    ), [ mimeTypes, currentNoteMime ]);

    return (note.type === "code" &&
        <>
            <StatusBarDropdown
                icon={correspondingMimeType?.icon ?? "bx bx-code-curly"}
                text={correspondingMimeType?.title}
                title={t("status_bar.code_note_switcher")}
                dropdownContainerClassName="dropdown-code-note-switcher tn-dropdown-menu-scrollable"
            >
                <NoteTypeCodeNoteList
                    currentMimeType={currentNoteMime}
                    mimeTypes={mimeTypes}
                    changeNoteType={(type, mime) => server.put(`notes/${note.noteId}/type`, { type, mime })}
                    setModalShown={() => setModalShown(true)}
                />
            </StatusBarDropdown>
            {createPortal(
                <NoteTypeOptionsModal modalShown={modalShown} setModalShown={setModalShown} />,
                document.body
            )}
        </>
    );
}
//#endregion

//#region Bottom panel

interface BottomPanelParams {
    children: ComponentChildren;
    title: string;
    visible: boolean;
    setVisible?: (visible: boolean) => void;
    className?: string;
}

function BottomPanel({ children, title, visible, setVisible, className }: BottomPanelParams) {
    return <div className={clsx("bottom-panel", className, {"hidden-ext": !visible})}>
        <div className="bottom-panel-title-bar">
            <span className="bottom-panel-title-bar-caption">{title}</span>
            <button class="icon-action bx bx-x" onClick={() => setVisible?.(false)} />
        </div>
        <div class={clsx("bottom-panel-content")}>
            {children}
        </div>
    </div>;
}
//#endregion
