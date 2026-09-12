import "./OptionsDialog.css";

import type { RefObject } from "preact";
import { useCallback, useContext, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import NoteContext from "../../components/note_context";
import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import utils, { isElectron, isStandalone } from "../../services/utils";
import NoteDetail from "../NoteDetail";
import FormList, { FormListItem } from "../react/FormList";
import HelpButton from "../react/HelpButton";
import { useChildNotes, useContainedLinkNavigation, useNoteContext, useTriliumEvent } from "../react/hooks";
import { DetailPane, MasterDetailHeader, MasterPane, useMobileMasterDetail } from "../react/master_detail";
import Modal from "../react/Modal";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { PageHelpSlot } from "../type_widgets/options/components/OptionsPageHeader";
import SettingsNavigation from "../type_widgets/options/components/SettingsNavigation";
import SettingsSearch from "../type_widgets/options/components/SettingsSearch";
import OptionsSearchPage, { hasSearchTerms } from "../type_widgets/options/search_page";

/** The settings page shown when no specific section was requested and none was viewed yet this session. */
const DEFAULT_SECTION = "_optionsAppearance";

/**
 * The settings dialog, opened via the `showOptions` command. Settings open in a dialog rather than
 * a hoisted tab (which confused users by seemingly hiding the note tree): the full-height sidebar
 * lists the settings pages while the body renders the active one through a dedicated note context.
 *
 * On mobile the sidebar and the page become a master-detail flow instead: the dialog first shows
 * only the list of pages, tapping one reveals it full-screen with a back button in the header.
 */
export default function OptionsDialog() {
    const [ shown, setShown ] = useState(false);
    const parentComponent = useContext(ParentComponent);
    const [ noteContext, setNoteContext ] = useState(() => new NoteContext("_options-dialog"));
    // Remembers the page last viewed this session so reopening the dialog lands there instead of
    // always on Appearance. Kept in component state (resets on reload), not persisted.
    const [ lastSection, setLastSection ] = useState<string | null>(null);
    // What is being looked for across the pages, and whether the search is what the dialog is
    // showing. The two are apart because focusing the field opens the search before anything is
    // typed, and picking a page closes it again without emptying the field.
    const [ searchQuery, setSearchQuery ] = useState("");
    const [ searching, setSearching ] = useState(false);
    // Where the page on show keeps its help mark while the master-detail header carries its name.
    const [ pageHelpUrl, setPageHelpUrl ] = useState<string>();
    const modalRef = useRef<HTMLDivElement>(null);
    const isMobile = utils.isMobile();
    const { isMasterDetail, mobileView, switchMobileView, resetMobileView } = useMobileMasterDetail(modalRef);
    // On a phone the results take the place of the list of pages, which is where the field sits, so
    // they wait for a search to have begun rather than for the field to have been tapped.
    const showsMobileResults = searching && hasSearchTerms(searchQuery);

    useTriliumEvent("showOptions", async ({ section }) => {
        const noteContext = new NoteContext("_options-dialog");
        await noteContext.setNote(section ?? lastSection ?? DEFAULT_SECTION, { keepActiveDialog: true });
        setSearchQuery("");
        setSearching(false);

        // Events triggered at note context level (e.g. the save indicator) would not work since the note context has no parent component. Propagate events to parent component so that they can be handled properly.
        noteContext.triggerEvent = (name, data) => parentComponent?.handleEventInChildren(name, data);
        setNoteContext(noteContext);
        // Requesting a specific section (e.g. "set up a password") skips the mobile master list.
        resetMobileView(section ? "page" : "list");
        setShown(true);
    });

    // Keep navigation between settings pages (sidebar entries, "Related settings" links) inside the
    // dialog; links to regular notes open in the quick-edit popup instead.
    useContainedLinkNavigation(modalRef, useCallback((notePath, viewScope) => {
        if (notePath.split("/").at(-1)?.startsWith("_options")) {
            void noteContext.setNote(notePath, { viewScope, keepActiveDialog: true });
            setSearching(false);
            switchMobileView("page");
        } else {
            void appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
        }
    }, [ noteContext, switchMobileView ]));

    return (
        <NoteContextContext.Provider value={noteContext}>
            <Modal
                modalRef={modalRef}
                title={t("options.title")}
                header={isMasterDetail && (
                    <MasterDetailHeader
                        inPage={mobileView === "page"}
                        onBack={() => switchMobileView("list")}
                        backTitle={t("options.back")}
                        pageTitle={<ActivePageTitle />}
                        listTitle={t("options.title")}
                        listIcon="bx bx-cog"
                        pageActions={pageHelpUrl && <HelpButton helpPage={pageHelpUrl} />}
                    />
                )}
                sidebar={isMasterDetail ? undefined : (
                    <SettingsSidebar
                        searchQuery={searchQuery}
                        searching={searching}
                        onSearchChange={setSearchQuery}
                        onSearchFocus={() => setSearching(true)}
                    />
                )}
                isFullPageOnMobile
                customTitleBarButtons={!isMobile ? [{
                    iconClassName: "bx-expand-alt",
                    title: t("popup-editor.maximize"),
                    onClick: async () => {
                        if (!noteContext.noteId) return;
                        const { noteId, hoistedNoteId } = noteContext;
                        await appContext.tabManager.openInNewTab(noteId, hoistedNoteId, true);
                        setShown(false);
                    }
                }] : undefined}
                className="options-dialog"
                size="lg"
                show={shown}
                onHidden={() => {
                    // Remember the settings page in view so the next open lands on it.
                    if (noteContext.noteId) {
                        setLastSection(noteContext.noteId);
                    }
                    setShown(false);
                }}
            >
                {isMasterDetail && (
                    <MasterPane className="options-mobile-nav">
                        <SettingsSearch
                            query={searchQuery}
                            onChange={setSearchQuery}
                            onFocus={() => setSearching(true)}
                        />

                        {/* The results stand in the list's place once there is something to look
                            for, and the list comes back as soon as the field is emptied. Below that
                            they are mounted out of sight, so the first search is as quick as the
                            rest and the way out of the search is never anything but the field. */}
                        <div className="options-mobile-results" hidden={!showsMobileResults}>
                            {searching && <OptionsSearchPage query={searchQuery} />}
                        </div>

                        {!showsMobileResults && (
                            <MobileSettingsList onSelect={(noteId) => {
                                void noteContext.setNote(noteId, { keepActiveDialog: true });
                                switchMobileView("page");
                            }} />
                        )}
                    </MasterPane>
                )}
                <SettingsScrollReset modalRef={modalRef} searching={searching} />
                {/* The settings page is the detail half of the flow, and is wrapped as a pane only where
                    there is a flow for it to be half of: the sidebar layout expects it as the body's own
                    child. */}
                {isMasterDetail
                    ? (
                        // Offered only here: elsewhere the page's banner keeps its own name, and so
                        // has somewhere for the mark to sit.
                        <PageHelpSlot.Provider value={setPageHelpUrl}>
                            <DetailPane><NoteDetail /></DetailPane>
                        </PageHelpSlot.Provider>
                    )
                    : (searching ? <OptionsSearchPage query={searchQuery} /> : <NoteDetail />)}
            </Modal>
        </NoteContextContext.Provider>
    );
}

/**
 * Names the settings page on show, for the master-detail header to carry beside the way back. A
 * component of its own rather than something the dialog reads: the dialog is what provides the note
 * context the title comes from, so it cannot consume it itself.
 */
function ActivePageTitle() {
    const { note } = useNoteContext();
    return <>{note?.title}</>;
}

/**
 * The children of `_options` to list in the settings modal, filtered to those applicable to the
 * running platform (see {@link isOptionPageVisibleOnPlatform}). Shared by the desktop sidebar
 * ({@link SettingsNavigation}) and the mobile master list ({@link MobileSettingsList}) so both stay
 * in sync.
 */
export function useOptionPages() {
    return useChildNotes("_options").filter(isOptionPageVisibleOnPlatform);
}

/**
 * Whether an option page applies to the running platform. A page note in the hidden subtree (see
 * `hidden_subtree.ts`) can carry a boolean label restricting where it appears: `#electronOnly`
 * hides it on the server (web/mobile) clients, `#serverOnly` hides it on the desktop (Electron)
 * app, and `#notInStandalone` hides it in the standalone build. Pages without any of them apply
 * everywhere. The page still exists in the note tree and stays reachable directly; only the modal's
 * navigation hides it.
 *
 * The first two are one axis — where the stack is served from — and are written as `Only` labels
 * because each names a single platform. Standalone is neither: its server runs in this browser, so
 * it is Electron and server at once for some purposes and neither for others. What a page needs
 * there is stated as the exclusion it is.
 *
 * All of this is the platform axis, distinct from the layout axis (`isDesktop`/`isMobile`) that the
 * launcher's `desktopOnly` label uses.
 */
export function isOptionPageVisibleOnPlatform(page: FNote) {
    if (!isElectron() && page.isLabelTruthy("electronOnly")) {
        return false;
    }

    if (isElectron() && page.isLabelTruthy("serverOnly")) {
        return false;
    }

    if (isStandalone && page.isLabelTruthy("notInStandalone")) {
        return false;
    }

    return true;
}

/**
 * Settings pages navigate in place within a single note context, so the modal's scroll container is
 * never re-mounted between pages and keeps the previous page's scroll position — leaving a freshly
 * opened page scrolled partway down. This resets it back to the top whenever the active page changes.
 *
 * It lives under the dialog's note-context provider so it re-renders on in-place navigation, and
 * resets both scroll containers in use: the `.modal-body` on the desktop sidebar layout and the
 * `.note-detail` pane in the mobile master-detail flow.
 */
function SettingsScrollReset(
    { modalRef, searching }: { modalRef: RefObject<HTMLDivElement>, searching: boolean }
) {
    const { noteId } = useNoteContext();
    useLayoutEffect(() => {
        const modal = modalRef.current;
        if (!modal) return;
        modal.querySelector<HTMLElement>(".modal-body")?.scrollTo({ top: 0 });
        modal.querySelector<HTMLElement>(".note-detail")?.scrollTo({ top: 0 });
    }, [ modalRef, noteId, searching ]);
    return null;
}

interface SettingsSidebarProps {
    searchQuery: string;
    /** Whether the search is showing, in which case no page in the list is the active one. */
    searching: boolean;
    onSearchChange(query: string): void;
    onSearchFocus(): void;
}

/**
 * The dialog's sidebar: the field looking through every page, above the selector for one of them.
 *
 * The selector derives the active page from `useNoteContext()` (resolved against the dialog's own
 * context via the surrounding provider) so the highlighted entry tracks navigation. The link clicks
 * themselves are handled by the dialog's {@link useContainedLinkNavigation} interceptor.
 */
function SettingsSidebar({
    searchQuery, searching, onSearchChange, onSearchFocus
}: SettingsSidebarProps) {
    const { noteId } = useNoteContext();

    return (
        <>
            <SettingsSearch query={searchQuery} onChange={onSearchChange} onFocus={onSearchFocus} />
            {noteId && <SettingsNavigation activeNoteId={searching ? "" : noteId} />}
        </>
    );
}

/**
 * The settings page list shown as the master view of the mobile master-detail flow, using the
 * standard list component rather than the desktop sidebar's compact selector.
 */
function MobileSettingsList({ onSelect }: { onSelect: (noteId: string) => void }) {
    const pages = useOptionPages();
    const { noteId: activeNoteId } = useNoteContext();
    return (
        <FormList onSelect={onSelect}>
            {pages.map((page) => (
                <FormListItem
                    key={page.noteId}
                    icon={page.getIcon()}
                    value={page.noteId}
                    active={page.noteId === activeNoteId}
                >
                    {page.title}
                </FormListItem>
            ))}
        </FormList>
    );
}

