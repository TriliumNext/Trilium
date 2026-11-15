import "./StatusBar.css";

import type { Tooltip } from "bootstrap";
import clsx from "clsx";
import { createPortal } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import type { CommandNames } from "../../components/app_context";
import type NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { t } from "../../services/i18n";
import type { ViewScope } from "../../services/link";
import { openInAppHelpFromUrl } from "../../services/utils";
import Dropdown, { type DropdownHandle, DropdownPanel, type DropdownPanelProps } from "../react/Dropdown";
import { FormDropdownDivider, FormListItem } from "../react/FormList";
import { useBodyClass } from "../react/hooks/dom";
import { useTriliumEvent, useTriliumEvents } from "../react/hooks/events";
import { useAttachments, useBacklinkCount, useNoteProperty, useSortedNotePaths } from "../react/hooks/note";
import { useGetContextDataFrom } from "../react/hooks/note_context";
import { useTriliumOptionBool } from "../react/hooks/options";
import { useStaticTooltip } from "../react/hooks/tooltip";
import { useActiveNoteContext } from "../react/hooks/tree";
import Icon from "../react/Icon";
import { preloadLazyModule, WithLazyModule } from "../react/LazyComponent";
import { ParentComponent } from "../react/react_utils";
import { useProcessedLocales } from "../type_widgets/options/components/LocaleSelector";
import Breadcrumb from "./Breadcrumb";
import { getLocaleName, useLanguageSwitcher } from "./language_switcher";
import {
    useVimStatus, VimCommandLineSlot, VimHintStrip, VimMessagePanel, VimModeBadge, VimStatusLine
} from "./VimStatus";

export interface StatusBarContext {
    note: FNote;
    noteContext: NoteContext;
    viewScope?: ViewScope;
    hoistedNoteId?: string;
    notePath?: string | null;
}

const loadPanels = () => import("./StatusBarPanels");
const loadAttributesPane = () => import("./StatusBarAttributes");
const loadCodeItems = () => import("./StatusBarCode");
const loadContentLanguages = () => import("../dialogs/content_languages");
const loadBacklinks = () => import("../sidebar/Backlinks");
const loadNotePaths = () => import("../sidebar/NotePaths");

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
    const noteType = useNoteProperty(note, "type");
    const isHiddenNote = note?.isHiddenCompletely();
    const canEditAttributes = note?.isContentWritable !== false;
    const vimStatus = useVimStatus(noteContext);
    const shownVim = useGetContextDataFrom(noteContext, "vimMode");
    const [ isVimModeOptionOn ] = useTriliumOptionBool("textNoteVimModeEnabled");
    const isVimBadgeShown = !!shownVim && isVimModeOptionOn;
    const vimMessage = vimStatus?.message;
    const vimHints = vimStatus?.hints;

    // The note split comes before the bar in the DOM, so its corner rule keys on a body class.
    useBodyClass("status-bar-panel-open", !!activePane);
    // Zen mode keeps the bar for Vim mode, and for its badge while the note has Vim mode off.
    useBodyClass("vim-status-shown", !!vimStatus || isVimBadgeShown);

    return (
        <div className={clsx("status-bar", vimStatus?.commandLine && "vim-command-line-open",
            vimHints && "vim-hints-shown")}>
            {attributesContext && canEditAttributes && <AttributesPane {...attributesContext} />}
            {noteInfoContext?.similarNotesShown && (
                <WithLazyModule load={loadPanels}>
                    {({ SimilarNotesPane }) => <SimilarNotesPane {...noteInfoContext} />}
                </WithLazyModule>
            )}
            {vimMessage?.isLong && <VimMessagePanel text={vimMessage.text} />}

            <div className="status-bar-main-row">
                {context && attributesContext && noteInfoContext && <>
                    <Breadcrumb />
                    {vimStatus && <VimCommandLineSlot />}
                    {vimHints && <VimHintStrip hints={vimHints} />}

                    <div className="actions-row">
                        {isVimBadgeShown && (
                            <VimModeBadge note={context.note} ntxId={context.noteContext.ntxId} />
                        )}
                        {vimStatus && <VimStatusLine status={vimStatus} vim={shownVim} />}
                        {noteType === "code" && (
                            <WithLazyModule load={loadCodeItems}>
                                {({ default: CodeItems }) => <CodeItems {...context} />}
                            </WithLazyModule>
                        )}
                        <LanguageSwitcher {...context} />
                        {!isHiddenNote && <NotePaths {...context} />}
                        {canEditAttributes && <AttributesButton {...attributesContext} />}
                        <AttachmentCount {...context} />
                        <BacklinksBadge {...context} />
                        <NoteInfoBadge {...noteInfoContext} />
                    </div>
                </>}
            </div>
        </div>
    );
}

export function StatusBarDropdown({ children, icon, text, buttonClassName, dropdownContainerClassName, titleOptions, panel, preload, ...dropdownProps }: Omit<DropdownPanelProps,"hideToggleArrow" | "title" | "titlePosition"> & {
    title: string;
    icon?: string;
    /** Opens a {@link DropdownPanel} rather than a menu, for content other than `FormList` rows. */
    panel?: boolean;
    /** Starts loading what the dropdown shows, as the pointer or the focus reaches its button. */
    preload?: () => void;
}) {
    const Component = panel ? DropdownPanel : Dropdown;
    return (
        <Component
            buttonClassName={clsx("status-bar-dropdown-button", buttonClassName)}
            dropdownContainerClassName={clsx("status-bar-dropdown-menu", dropdownContainerClassName)}
            titlePosition="top"
            titleOptions={{
                popperConfig: {
                    ...titleOptions?.popperConfig,
                    strategy: "fixed"
                },
                animation: false,
                ...titleOptions
            }}
            placement="top"
            text={<>
                {icon && (<><Icon icon={icon} />&nbsp;</>)}
                <span className="text">{text}</span>
            </>}
            buttonProps={preload && { onPointerEnter: preload, onFocus: preload }}
            {...dropdownProps}
        >
            {children}
        </Component>
    );
}

interface StatusBarButtonBaseProps {
    className?: string;
    icon: string;
    title: string;
    text: string | number;
    disabled?: boolean;
    active?: boolean;
    /** Starts loading what the button opens, as the pointer or the focus reaches it. */
    preload?: () => void;
}

type StatusBarButtonWithCommand = StatusBarButtonBaseProps & { triggerCommand: CommandNames; };
type StatusBarButtonWithClick = StatusBarButtonBaseProps & { onClick: () => void; };

/** The tooltip options of the status bar items, which open above the bar. */
export const TOOLTIP_OPTIONS: Partial<Tooltip.Options> = {
    placement: "top",
    fallbackPlacements: [ "top" ],
    popperConfig: { strategy: "fixed" },
    animation: false
};

function StatusBarButton({ className, icon, text, title, active, preload, ...restProps }: StatusBarButtonWithCommand | StatusBarButtonWithClick) {
    const parentComponent = useContext(ParentComponent);
    const buttonRef = useRef<HTMLButtonElement>(null);
    useStaticTooltip(buttonRef, { ...TOOLTIP_OPTIONS, title });

    return (
        <button
            ref={buttonRef}
            className={clsx("btn select-button focus-outline", className, active && "active")}
            type="button"
            onPointerEnter={preload}
            onFocus={preload}
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
    // The modal stays mounted once opened, so that it can animate its closing.
    const [ isModalMounted, setModalMounted ] = useState(false);
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
                    onClick={() => {
                        setModalMounted(true);
                        setModalShown(true);
                    }}
                    icon="bx bx-cog"
                >{t("note_language.configure-languages")}</FormListItem>
            </StatusBarDropdown>}
            {isModalMounted && createPortal(
                <WithLazyModule load={loadContentLanguages}>
                    {({ ContentLanguagesModal }) => (
                        <ContentLanguagesModal modalShown={modalShown} setModalShown={setModalShown} />
                    )}
                </WithLazyModule>,
                document.body
            )}
        </>
    );
}
//#endregion

//#region Note info & Similar
interface NoteInfoContext extends StatusBarContext {
    similarNotesShown?: boolean;
    setSimilarNotesShown?: (value: boolean) => void;
}

const preloadPanels = () => preloadLazyModule(loadPanels);

export function NoteInfoBadge(context: NoteInfoContext) {
    const dropdownRef = useRef<DropdownHandle>(null);
    const [ dropdownShown, setDropdownShown ] = useState(false);
    const { note, similarNotesShown, setSimilarNotesShown } = context;
    const noteType = useNoteProperty(note, "type");
    const enabled = note && noteType;

    // Keyboard shortcuts.
    useTriliumEvent("toggleRibbonTabNoteInfo", () => enabled && dropdownRef.current?.show());
    useTriliumEvent("toggleRibbonTabSimilarNotes", () => setSimilarNotesShown?.(!similarNotesShown));

    return (enabled &&
        <StatusBarDropdown
            panel
            icon="bx bx-info-circle"
            title={t("status_bar.note_info_title")}
            dropdownRef={dropdownRef}
            dropdownContainerClassName="dropdown-note-info"
            autoClose="outside"
            preload={preloadPanels}
            onShown={() => setDropdownShown(true)}
            onHidden={() => setDropdownShown(false)}
        >
            {dropdownShown && (
                <WithLazyModule load={loadPanels}>
                    {({ NoteInfoContent }) => (
                        <NoteInfoContent {...context} dropdownRef={dropdownRef} noteType={noteType} />
                    )}
                </WithLazyModule>
            )}
        </StatusBarDropdown>
    );
}
//#endregion

//#region Backlinks
const preloadBacklinks = () => preloadLazyModule(loadBacklinks);

/**
 * What points at the note, in a dropdown of the badge naming them — the same list the sidebar's
 * connections tab holds, which stays the place to keep it open beside the note.
 */
function BacklinksBadge({ note, viewScope }: StatusBarContext) {
    const count = useBacklinkCount(note, viewScope?.viewMode === "default");

    return (note && count > 0 &&
        <StatusBarDropdown
            panel
            className="backlinks-badge"
            icon="bx bx-link"
            text={t("status_bar.backlinks", { count })}
            title={t("status_bar.backlinks_title", { count })}
            dropdownContainerClassName="dropdown-backlinks"
            scrollable
            preload={preloadBacklinks}
        >
            <WithLazyModule load={loadBacklinks}>
                {({ BacklinksWidget }) => <BacklinksWidget note={note} />}
            </WithLazyModule>
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

const preloadAttributesPane = () => preloadLazyModule(loadAttributesPane);

function AttributesButton({ note, attributesShown, setAttributesShown }: AttributesProps) {
    const count = useAttributeCount(note);

    return (
        <StatusBarButton
            className="attributes-button"
            icon="bx bx-list-check"
            title={t("status_bar.attributes_title")}
            text={t("status_bar.attributes", { count })}
            active={attributesShown}
            preload={preloadAttributesPane}
            onClick={() => setAttributesShown(!attributesShown)}
        />
    );
}

/** The number of attributes of the note, owned and inherited, leaving out the links its content makes. */
export function useAttributeCount(note: FNote) {
    const [ count, setCount ] = useState(() => getAttributeCount(note));

    useEffect(() => setCount(getAttributeCount(note)), [ note ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows().some(attr => attributes.isAffecting(attr, note))) {
            setCount(getAttributeCount(note));
        }
    });

    return count;
}

function getAttributeCount(note: FNote) {
    return note.getAttributes().filter(a => !a.isAutoLink).length;
}

/**
 * Loads the attributes panel the first time it opens, and keeps it mounted afterwards so that the
 * imperative handlers of its editor keep working.
 */
function AttributesPane({ note, noteContext, attributesShown, setAttributesShown }: AttributesProps) {
    const [ isMounted, setMounted ] = useState(false);
    useEffect(() => {
        if (attributesShown) {
            setMounted(true);
        }
    }, [ attributesShown ]);

    // Show on keyboard shortcuts. The editor is not listening until it mounts, so it is handed the first one.
    const [ initialCommand, setInitialCommand ] = useState<"addNewLabel" | "addNewRelation">();
    useTriliumEvents([ "addNewLabel", "addNewRelation" ], (_, eventName) => {
        if (!isMounted) {
            setInitialCommand(eventName);
        }
        setAttributesShown(true);
    });
    useTriliumEvents([ "toggleRibbonTabOwnedAttributes", "toggleRibbonTabInheritedAttributes" ], () => setAttributesShown(!attributesShown));

    return (isMounted &&
        <WithLazyModule load={loadAttributesPane}>
            {({ default: Pane }) => (
                <Pane
                    note={note}
                    noteContext={noteContext}
                    attributesShown={attributesShown}
                    setAttributesShown={setAttributesShown}
                    initialCommand={initialCommand}
                />
            )}
        </WithLazyModule>
    );
}
//#endregion

//#region Note paths
const preloadNotePaths = () => preloadLazyModule(loadNotePaths);

/**
 * Where the note sits in the tree, in a dropdown of the badge counting the places — the same list the
 * sidebar's connections tab holds, which stays the place to keep it open beside the note.
 */
function NotePaths({ note, hoistedNoteId, notePath }: StatusBarContext) {
    const dropdownRef = useRef<DropdownHandle>(null);
    const sortedNotePaths = useSortedNotePaths(note, hoistedNoteId);
    const count = sortedNotePaths?.length ?? 0;

    // Keyboard shortcut.
    useTriliumEvent("toggleRibbonTabNotePaths", () => dropdownRef.current?.show());

    return (
        <StatusBarDropdown
            panel
            className="note-paths-button"
            icon="bx bx-directions"
            title={t("status_bar.note_paths_title")}
            text={t("status_bar.note_paths", { count })}
            dropdownRef={dropdownRef}
            dropdownContainerClassName="dropdown-note-paths"
            preload={preloadNotePaths}
        >
            <WithLazyModule load={loadNotePaths}>
                {({ NotePathsWidget }) => (
                    <NotePathsWidget sortedNotePaths={sortedNotePaths} currentNotePath={notePath} />
                )}
            </WithLazyModule>
        </StatusBarDropdown>
    );
}
//#endregion
