import "./StatusBar.css";

import { Locale, NOTE_TYPE_ICONS, NoteType } from "@triliumnext/commons";
import { Dropdown as BootstrapDropdown } from "bootstrap";
import clsx from "clsx";
import { type ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import { ATTRIBUTE_HELP_PAGE } from "../../services/in_app_help";
import { ViewScope } from "../../services/link";
import { NOTE_TYPES } from "../../services/note_types";
import server from "../../services/server";
import { openInAppHelpFromUrl } from "../../services/utils";
import { formatDateTime } from "../../utils/formatters";
import { BacklinksWidget, useBacklinkCount } from "../FloatingButtonsDefinitions";
import Dropdown, { DropdownProps } from "../react/Dropdown";
import { FormDropdownDivider, FormListHeader, FormListItem } from "../react/FormList";
import HelpDropdown from "../react/HelpDropdown";
import { useActiveNoteContext, useLegacyImperativeHandlers, useNoteLabel, useNoteLabelInt, useNoteLabelOptionalBool, useNoteProperty, useStaticTooltip, useTriliumEvent, useTriliumEvents, useTriliumOptionBool, useTriliumOptionInt, useAttachments } from "../react/hooks";
import Icon from "../react/Icon";
import LinkButton from "../react/LinkButton";
import { ParentComponent } from "../react/react_utils";
import { ContentLanguagesModal, NoteTypeCodeNoteList, NoteTypeOptionsModal, useLanguageSwitcher, useMimeTypes } from "../ribbon/BasicPropertiesTab";
import AttributeEditor, { AttributeEditorImperativeHandlers } from "../ribbon/components/AttributeEditor";
import AttributeHelp from "../ribbon/components/AttributeHelp";
import InheritedAttributesTab from "../ribbon/InheritedAttributesTab";
import { NoteSizeWidget, useNoteMetadata } from "../ribbon/NoteInfoTab";
import { NotePathsWidget, useSortedNotePaths } from "../ribbon/NotePathsTab";
import SimilarNotesTab from "../ribbon/SimilarNotesTab";
import type { RightPaneTabId } from "../sidebar/RightPaneTabs";
import { useProcessedLocales } from "../type_widgets/options/components/LocaleSelector";
import Breadcrumb from "./Breadcrumb";
import { convertIndentation } from "./reindentation";

interface StatusBarContext {
    note: FNote;
    noteContext: NoteContext;
    viewScope?: ViewScope;
    hoistedNoteId?: string;
    notePath?: string | null;
}

export default function StatusBar() {
    const { note, noteContext, viewScope, hoistedNoteId, notePath } = useActiveNoteContext();
    // What the status bar shows in a panel rather than a dropdown is what wants the width of the
    // window: the attributes, which are edited rather than read, and the similar notes, which are set
    // as a cloud. One at a time — two of them stacked would take the note's place rather than sit
    // under it.
    const [ activePane, setActivePane ] = useState<"attributes" | "similar-notes" | false>(false);
    const context: StatusBarContext | undefined | null = note && noteContext && { note, noteContext, viewScope, hoistedNoteId, notePath };
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
    const isHiddenNote = note?.isHiddenCompletely();

    return (
        <div className={clsx("status-bar", {"status-bar-panel-open": !!activePane})}>
            {attributesContext && <AttributesPane {...attributesContext} />}
            {noteInfoContext && <SimilarNotesPane {...noteInfoContext} />}

            <div className="status-bar-main-row">
                {context && attributesContext && noteInfoContext && <>
                    <Breadcrumb />

                    <div className="actions-row">
                        <CodeNoteSwitcher {...context} />
                        <TabWidthSwitcher {...context} />
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

/**
 * The way from a panel of the status bar to the sidebar tab holding the fuller version of the same
 * thing: the attributes panel edits a note's attributes as a line of text, the sidebar's card as a
 * list with a control apiece. Worded as what is found there rather than as the pane it opens, and
 * shown in the panel's title bar beside its `?`.
 *
 * A pane the user keeps closed is peeked rather than docked — a glance asked for from the status bar
 * is no reason to reflow the content the note is read in.
 */
function SidebarLink({ text, tabId, onOpened }: { text: string; tabId: RightPaneTabId; onOpened?: () => void }) {
    return (
        <LinkButton
            className="status-bar-sidebar-link"
            text={<>
                <Icon icon="bx bx-sidebar" className="bx-flip-horizontal" />
                <span class="status-bar-sidebar-link-text">{text}</span>
            </>}
            onClick={() => {
                void appContext.triggerEvent("selectRightPaneTab", { tabId, peek: true });
                onOpened?.();
            }}
        />
    );
}

//#region Language Switcher
function LanguageSwitcher({ note }: StatusBarContext) {
    const [ modalShown, setModalShown ] = useState(false);
    const noteType = useNoteProperty(note, "type");
    const { locales, DEFAULT_LOCALE, effectiveLocale, currentNoteLanguage, setCurrentNoteLanguage } = useLanguageSwitcher(note);
    const { processedLocales } = useProcessedLocales(locales, DEFAULT_LOCALE, currentNoteLanguage ?? DEFAULT_LOCALE.id);

    return (
        <>
            {noteType === "text" && <StatusBarDropdown
                icon="bx bx-globe"
                title={t("status_bar.language_title")}
                text={<span dir={effectiveLocale?.rtl ? "rtl" : "ltr"}>{getLocaleName(effectiveLocale)}</span>}
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
    similarNotesShown?: boolean;
    setSimilarNotesShown?: (value: boolean) => void;
}

export function NoteInfoBadge(context: NoteInfoContext) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const [ dropdownShown, setDropdownShown ] = useState(false);
    const { note, similarNotesShown, setSimilarNotesShown } = context;
    const noteType = useNoteProperty(note, "type");
    const enabled = note && noteType;

    // Keyboard shortcuts.
    useTriliumEvent("toggleRibbonTabNoteInfo", () => enabled && dropdownRef.current?.show());
    useTriliumEvent("toggleRibbonTabSimilarNotes", () => setSimilarNotesShown?.(!similarNotesShown));

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

export function NoteInfoContent({ note, noteType, dropdownRef, setSimilarNotesShown }: Pick<NoteInfoContext, "note" | "setSimilarNotesShown"> & {
    dropdownRef?: RefObject<BootstrapDropdown>;
    noteType: NoteType;
}) {
    const { metadata, ...sizeProps } = useNoteMetadata(note);
    const [ originalFileName ] = useNoteLabel(note, "originalFileName");
    const noteTypeMapping = useMemo(() => NOTE_TYPES.find(t => t.type === noteType), [ noteType ]);

    return (
        <div className="note-info-content">
            <ul>
                {originalFileName && <NoteInfoValue text={t("file_properties.original_file_name")} value={originalFileName} />}
                <NoteInfoValue text={t("note_info_widget.created")} value={formatDateTime(metadata?.dateCreated)} />
                <NoteInfoValue text={t("note_info_widget.modified")} value={formatDateTime(metadata?.dateModified)} />
                {noteTypeMapping && <NoteInfoValue text={t("note_info_widget.type")} value={<><Icon icon={`bx ${noteTypeMapping.icon ?? NOTE_TYPE_ICONS[noteType]}`}/>{" "}{noteTypeMapping?.title}</>} />}
                {note.mime && <NoteInfoValue text={t("note_info_widget.mime")} value={note.mime} />}
                <NoteInfoValue text={t("note_info_widget.note_id")} value={<code>{note.noteId}</code>} />
                <NoteInfoValue text={t("note_info_widget.note_size")} title={t("note_info_widget.note_size_info")} value={<NoteSizeWidget {...sizeProps} />} />
            </ul>

            {setSimilarNotesShown && <LinkButton
                text={t("note_info_widget.show_similar_notes")}
                onClick={() => {
                    dropdownRef?.current?.hide();
                    setSimilarNotesShown(true);
                }}
            />}
        </div>
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
/**
 * What points at the note, in a dropdown of the badge naming them — the same list the sidebar's
 * connections tab holds, which stays the place to keep it open beside the note.
 */
function BacklinksBadge({ note, viewScope }: StatusBarContext) {
    const count = useBacklinkCount(note, viewScope?.viewMode === "default");

    return (note && count > 0 &&
        <StatusBarDropdown
            className="backlinks-badge"
            icon="bx bx-link"
            text={t("status_bar.backlinks", { count })}
            title={t("status_bar.backlinks_title", { count })}
            dropdownContainerClassName="dropdown-backlinks"
        >
            <BacklinksWidget note={note} />
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

    const getAttributeCount = useCallback((note: FNote) => {
        return note.getAttributes().filter(a => !a.isAutoLink).length;
    }, []);

    // React to note changes.
    useEffect(() => {
        setCount(getAttributeCount(note));
    }, [ note, getAttributeCount ]);

    // React to changes in count.
    useTriliumEvent("entitiesReloaded", (({loadResults}) => {
        if (loadResults.getAttributeRows().some(attr => attributes.isAffecting(attr, note))) {
            setCount(getAttributeCount(note));
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

    // The attribute editor pulls in CKEditor, so it is only mounted once the panel has been
    // opened (and stays mounted afterwards so the imperative handlers keep working).
    const [ editorMounted, setEditorMounted ] = useState(false);
    useEffect(() => {
        if (attributesShown) {
            setEditorMounted(true);
        }
    }, [ attributesShown ]);

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
            setVisible={setAttributesShown}
            buttons={<SidebarLink
                text={t("attributes_panel.edit_in_sidebar")}
                tabId="attributes"
                onOpened={() => setAttributesShown(false)}
            />}
            helpPage={ATTRIBUTE_HELP_PAGE}
            helpContent={<AttributeHelp />}>

            <span class="attributes-panel-label">{t("inherited_attribute_list.title")}</span>
            <InheritedAttributesTab {...context} emptyListString="inherited_attribute_list.none" />

            {editorMounted && <AttributeEditor
                {...context}
                api={api}
                ntxId={noteContext.ntxId}
                // The panel's title bar already carries the same help.
                hideHelpButton
            />}
        </BottomPanel>
    );
}
//#endregion

//#region Note paths
/**
 * Where the note sits in the tree, in a dropdown of the badge counting the places — the same list the
 * sidebar's connections tab holds, which stays the place to keep it open beside the note.
 */
function NotePaths({ note, hoistedNoteId, notePath }: StatusBarContext) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const count = sortedNotePaths?.length ?? 0;

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabNotePaths", () => dropdownRef.current?.show());

    return (
        <StatusBarDropdown
            className="note-paths-button"
            icon="bx bx-directions"
            title={t("status_bar.note_paths_title")}
            text={t("status_bar.note_paths", { count })}
            dropdownRef={dropdownRef}
            dropdownContainerClassName="dropdown-note-paths"
            noDropdownListStyle
        >
            <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />
        </StatusBarDropdown>
    );
}
//#endregion

//#region Tab width switcher
const TAB_WIDTH_OPTIONS = [1, 2, 3, 4, 6, 8] as const;

function TabWidthSwitcher({ note, noteContext }: StatusBarContext) {
    const noteType = useNoteProperty(note, "type");
    const [ globalTabWidth ] = useTriliumOptionInt("codeNoteTabWidth");
    const [ globalUseTabs ] = useTriliumOptionBool("codeNoteIndentWithTabs");
    const [ noteTabWidth, setNoteTabWidth ] = useNoteLabelInt(note, "tabWidth");
    const [ noteUseTabs, setNoteUseTabs ] = useNoteLabelOptionalBool(note, "indentWithTabs");
    const effectiveTabWidth = noteTabWidth ?? globalTabWidth ?? 4;
    const effectiveUseTabs = noteUseTabs ?? globalUseTabs;
    const hasWidthOverride = noteTabWidth != null;
    const hasStyleOverride = noteUseTabs != null;

    const reindentTo = async (targetUseTabs: boolean, targetWidth: number) => {
        const editor = await noteContext.getCodeEditor();
        if (!editor) return;
        const converted = convertIndentation(
            editor.getText(),
            { useTabs: effectiveUseTabs, width: effectiveTabWidth },
            { useTabs: targetUseTabs, width: targetWidth }
        );
        if (converted !== editor.getText()) {
            editor.setText(converted);
        }
        setNoteTabWidth(targetWidth);
        setNoteUseTabs(targetUseTabs);
    };

    const statusText = effectiveUseTabs
        ? t("status_bar.tab_width_tabs", { width: effectiveTabWidth })
        : t("status_bar.tab_width_spaces_short", { width: effectiveTabWidth });

    return (noteType === "code" &&
        <StatusBarDropdown
            icon="bx bx-right-indent"
            text={statusText}
            title={t("status_bar.tab_width_title")}
        >
            <FormListHeader text={t("status_bar.tab_width_style_header")} />
            <FormListItem
                checked={!effectiveUseTabs}
                onClick={() => setNoteUseTabs(false)}
            >
                {t("status_bar.tab_width_style_spaces")}
            </FormListItem>
            <FormListItem
                checked={effectiveUseTabs}
                onClick={() => setNoteUseTabs(true)}
            >
                {t("status_bar.tab_width_style_tabs")}
            </FormListItem>
            {hasStyleOverride &&
                <FormListItem icon="bx bx-x" onClick={() => setNoteUseTabs(null)}>
                    {t("status_bar.tab_width_use_default_style", {
                        style: globalUseTabs ? t("status_bar.tab_width_style_tabs") : t("status_bar.tab_width_style_spaces")
                    })}
                </FormListItem>
            }

            <FormListHeader text={t("status_bar.tab_width_display_header")} />
            {TAB_WIDTH_OPTIONS.map(size => (
                <FormListItem
                    key={`display-${size}`}
                    checked={effectiveTabWidth === size}
                    onClick={() => setNoteTabWidth(size)}
                >
                    {t("status_bar.tab_width_spaces", { count: size })}
                </FormListItem>
            ))}
            {hasWidthOverride &&
                <FormListItem icon="bx bx-x" onClick={() => setNoteTabWidth(null)}>
                    {t("status_bar.tab_width_use_default", { width: globalTabWidth })}
                </FormListItem>
            }

            <FormListHeader text={t("status_bar.tab_width_reindent_header")} />
            {TAB_WIDTH_OPTIONS.map(size => (
                <FormListItem
                    key={`reindent-spaces-${size}`}
                    disabled={!effectiveUseTabs && effectiveTabWidth === size}
                    onClick={() => reindentTo(false, size)}
                >
                    {t("status_bar.tab_width_spaces", { count: size })}
                </FormListItem>
            ))}
            <FormListItem
                disabled={effectiveUseTabs}
                onClick={() => reindentTo(true, effectiveTabWidth)}
            >
                {t("status_bar.tab_width_style_tabs")}
            </FormListItem>
        </StatusBarDropdown>
    );
}
//#endregion

//#region Code note switcher
function CodeNoteSwitcher({ note }: StatusBarContext) {
    const [ modalShown, setModalShown ] = useState(false);
    const noteType = useNoteProperty(note, "type");
    const currentNoteMime = useNoteProperty(note, "mime");
    const { enabledMimeTypes, allMimeTypes } = useMimeTypes();
    const correspondingMimeType = useMemo(() => (
        allMimeTypes.find(m => m.mime === currentNoteMime)
    ), [ allMimeTypes, currentNoteMime ]);

    return (noteType === "code" &&
        <>
            <StatusBarDropdown
                icon={correspondingMimeType?.icon ?? "bx bx-code-curly"}
                text={correspondingMimeType?.title}
                title={t("status_bar.code_note_switcher")}
                dropdownContainerClassName="dropdown-code-note-switcher tn-dropdown-menu-scrollable"
            >
                <NoteTypeCodeNoteList
                    currentMimeType={currentNoteMime}
                    mimeTypes={enabledMimeTypes}
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
    /**
     * What the panel offers besides being read and closed, shown in its title bar ahead of the `?`
     * and the `×` — the same place, and the same name, as a sidebar card's own (see RightPanelWidget).
     */
    buttons?: ComponentChildren;
    helpPage?: string;
    /** Inline help shown by the title bar's `?`; without it the `?` opens {@link helpPage} directly. */
    helpContent?: ComponentChildren;
}

function BottomPanel({ children, title, visible, setVisible, className, buttons, helpPage, helpContent }: BottomPanelParams) {
    return <div className={clsx("bottom-panel", className, {"hidden-ext": !visible})}>
        <div className="bottom-panel-title-bar">
            <span className="bottom-panel-title-bar-caption">{title}</span>
            {buttons}
            {helpContent
                ? <HelpDropdown helpPage={helpPage}>{helpContent}</HelpDropdown>
                : helpPage && <button class="icon-action bx bx-help-circle" onClick={() => openInAppHelpFromUrl(helpPage)} title={t("open-help-page")} />}
            <button class="icon-action bx bx-x" onClick={() => setVisible?.(false)} />
        </div>
        <div class={clsx("bottom-panel-content")}>
            {children}
        </div>
    </div>;
}
//#endregion
