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
import { useChildNotes, useContainedLinkNavigation, useNoteContext, useTriliumEvent } from "../react/hooks";
import { DetailPane, MasterDetailHeader, MasterPane, useMobileMasterDetail } from "../react/master_detail";
import Modal from "../react/Modal";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import SettingsNavigation from "../type_widgets/options/components/SettingsNavigation";

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
    const modalRef = useRef<HTMLDivElement>(null);
    const isMobile = utils.isMobile();
    const { isMasterDetail, mobileView, switchMobileView, resetMobileView } = useMobileMasterDetail(modalRef);

    useTriliumEvent("showOptions", async ({ section }) => {
        const noteContext = new NoteContext("_options-dialog");
        await noteContext.setNote(section ?? lastSection ?? DEFAULT_SECTION, { keepActiveDialog: true });

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
                    />
                )}
                sidebar={isMasterDetail ? undefined : <SettingsSidebar />}
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
                        <MobileSettingsList onSelect={(noteId) => {
                            void noteContext.setNote(noteId, { keepActiveDialog: true });
                            switchMobileView("page");
                        }} />
                    </MasterPane>
                )}
                <SettingsScrollReset modalRef={modalRef} />
                {/* The settings page is the detail half of the flow, and is wrapped as a pane only where
                    there is a flow for it to be half of: the sidebar layout expects it as the body's own
                    child. */}
                {isMasterDetail ? <DetailPane><NoteDetail /></DetailPane> : <NoteDetail />}
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
function SettingsScrollReset({ modalRef }: { modalRef: RefObject<HTMLDivElement> }) {
    const { noteId } = useNoteContext();
    useLayoutEffect(() => {
        const modal = modalRef.current;
        if (!modal) return;
        modal.querySelector<HTMLElement>(".modal-body")?.scrollTo({ top: 0 });
        modal.querySelector<HTMLElement>(".note-detail")?.scrollTo({ top: 0 });
    }, [ modalRef, noteId ]);
    return null;
}

/**
 * The settings page selector shown in the dialog's sidebar. It derives the active page from
 * `useNoteContext()` (resolved against the dialog's own context via the surrounding provider) so the
 * highlighted entry tracks navigation. The link clicks themselves are handled by the dialog's
 * {@link useContainedLinkNavigation} interceptor.
 */
function SettingsSidebar() {
    const { noteId } = useNoteContext();
    if (!noteId) return null;
    return <SettingsNavigation activeNoteId={noteId} />;
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

