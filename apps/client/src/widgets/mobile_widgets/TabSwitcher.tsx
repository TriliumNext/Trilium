import "./TabSwitcher.css";

import clsx from "clsx";
import { createPortal, Fragment } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import appContext, { CommandNames } from "../../components/app_context";
import NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import { getHue, parseColor } from "../../services/css_class_manager";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { NoteContent } from "../collections/legacy/ListOrGridView";
import { LaunchBarActionButton } from "../launch_bar/launch_bar_widgets";
import { ICON_MAPPINGS } from "../note_bars/CollectionProperties";
import ActionButton from "../react/ActionButton";
import { useActiveNoteContext, useNoteIcon, useTriliumEvents } from "../react/hooks";
import Icon from "../react/Icon";
import LinkButton from "../react/LinkButton";
import Modal from "../react/Modal";

export default function TabSwitcher() {
    const [ shown, setShown ] = useState(false);
    const mainNoteContexts = useMainNoteContexts();

    return (
        <>
            <LaunchBarActionButton
                className="mobile-tab-switcher"
                icon="bx bx-rectangle"
                text="Tabs"
                onClick={() => setShown(true)}
                data-tab-count={mainNoteContexts.length > 99 ? "∞" : mainNoteContexts.length}
            />
            {createPortal(<TabBarModal mainNoteContexts={mainNoteContexts} shown={shown} setShown={setShown} />, document.body)}
        </>
    );
}

function TabBarModal({ mainNoteContexts, shown, setShown }: {
    mainNoteContexts: NoteContext[];
    shown: boolean;
    setShown: (newValue: boolean) => void;
}) {
    const [ fullyShown, setFullyShown ] = useState(false);
    const selectTab = useCallback((noteContextToActivate: NoteContext) => {
        appContext.tabManager.activateNoteContext(noteContextToActivate.ntxId);
        setShown(false);
    }, [ setShown ]);

    return (
        <Modal
            className="tab-bar-modal"
            size="xl"
            title={t("mobile_tab_switcher.title", { count: mainNoteContexts.length})}
            show={shown}
            onShown={() => setFullyShown(true)}
            customTitleBarButtons={[
                {
                    iconClassName: "bx bx-dots-vertical-rounded",
                    title: t("mobile_tab_switcher.more_options"),
                    onClick(e) {
                        contextMenu.show<CommandNames>({
                            x: e.pageX,
                            y: e.pageY,
                            items: [
                                { title: t("tab_row.new_tab"), command: "openNewTab", uiIcon: "bx bx-plus" },
                                { title: t("tab_row.reopen_last_tab"), command: "reopenLastTab", uiIcon: "bx bx-undo", enabled: appContext.tabManager.recentlyClosedTabs.length !== 0 },
                                { kind: "separator" },
                                { title: t("tab_row.close_all_tabs"), command: "closeAllTabs", uiIcon: "bx bx-trash destructive-action-icon" },
                            ],
                            selectMenuItemHandler: ({ command }) => {
                                if (command) {
                                    appContext.triggerCommand(command);
                                }
                            }
                        });
                    },
                }
            ]}
            footer={<>
                <LinkButton
                    text={t("tab_row.new_tab")}
                    onClick={() => {
                        appContext.triggerCommand("openNewTab");
                        setShown(false);
                    }}
                />
            </>}
            scrollable
            onHidden={() => {
                setShown(false);
                setFullyShown(false);
            }}
        >
            <TabBarModelContent mainNoteContexts={mainNoteContexts} selectTab={selectTab} shown={fullyShown} />
        </Modal>
    );
}

function TabBarModelContent({ mainNoteContexts, selectTab, shown }: {
    mainNoteContexts: NoteContext[];
    shown: boolean;
    selectTab: (noteContextToActivate: NoteContext) => void;
}) {
    const activeNoteContext = useActiveNoteContext();
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // Scroll to active tab.
    useEffect(() => {
        if (!shown || !activeNoteContext?.ntxId) return;
        const correspondingEl = tabRefs.current[activeNoteContext.ntxId];
        requestAnimationFrame(() => {
            correspondingEl?.scrollIntoView();
        });
    }, [ activeNoteContext, shown ]);

    return (
        <div className="tabs">
            {mainNoteContexts.map((noteContext) => (
                <Tab
                    key={noteContext.ntxId}
                    noteContext={noteContext}
                    activeNtxId={activeNoteContext.ntxId}
                    selectTab={selectTab}
                    containerRef={el => (tabRefs.current[noteContext.ntxId ?? ""] = el)}
                />
            ))}
        </div>
    );
}

function Tab({ noteContext, containerRef, selectTab, activeNtxId }: {
    containerRef: (el: HTMLDivElement | null) => void;
    noteContext: NoteContext;
    selectTab: (noteContextToActivate: NoteContext) => void;
    activeNtxId: string | null | undefined;
}) {
    const { note } = noteContext;
    const iconClass = useNoteIcon(note);
    const colorClass = note?.getColorClass() || '';
    const workspaceTabBackgroundColorHue = getWorkspaceTabBackgroundColorHue(noteContext);
    const subContexts = noteContext.getSubContexts();

    return (
        <div
            ref={containerRef}
            class={clsx("tab-card", {
                active: noteContext.ntxId === activeNtxId,
                "with-hue": workspaceTabBackgroundColorHue !== undefined,
                "with-split": subContexts.length > 1
            })}
            onClick={() => selectTab(noteContext)}
            style={{
                "--bg-hue": workspaceTabBackgroundColorHue
            }}
        >
            {subContexts.map(subContext => (
                <Fragment key={subContext.ntxId}>
                    <header className={colorClass}>
                        {subContext.note && <Icon icon={iconClass} />}
                        <span className="title">{subContext.note?.title ?? t("tab_row.new_tab")}</span>
                        {subContext.isMainContext() && <ActionButton
                            icon="bx bx-x"
                            text={t("tab_row.close_tab")}
                            onClick={(e) => {
                                // We are closing a tab, so we need to prevent propagation for click (activate tab).
                                e.stopPropagation();
                                appContext.tabManager.removeNoteContext(subContext.ntxId);
                            }}
                        />}
                    </header>
                    <div className={clsx("tab-preview", `type-${subContext.note?.type ?? "empty"}`)}>
                        <TabPreviewContent note={subContext.note} />
                    </div>
                </Fragment>
            ))}
        </div>
    );
}

function TabPreviewContent({ note }: {
    note: FNote | null
}) {
    if (!note) {
        return <PreviewPlaceholder icon="bx bx-plus" />;
    }

    if (note.type === "book") {
        return <PreviewPlaceholder icon={ICON_MAPPINGS[note.getLabelValue("viewType") ?? ""] ?? "bx bx-book"} />;
    }

    return (
        <NoteContent
            note={note}
            highlightedTokens={undefined}
            trim
            includeArchivedNotes={false}
        />
    );
}

function PreviewPlaceholder({ icon}: {
    icon: string;
}) {
    return (
        <div className="preview-placeholder">
            <Icon icon={icon} />
        </div>
    );
}

function getWorkspaceTabBackgroundColorHue(noteContext: NoteContext) {
    if (!noteContext.hoistedNoteId) return;
    const hoistedNote = froca.getNoteFromCache(noteContext.hoistedNoteId);
    if (!hoistedNote) return;

    const workspaceTabBackgroundColor = hoistedNote.getWorkspaceTabBackgroundColor();
    if (!workspaceTabBackgroundColor) return;

    try {
        const parsedColor = parseColor(workspaceTabBackgroundColor);
        if (!parsedColor) return;
        return getHue(parsedColor);
    } catch (e) {
        // Colors are non-critical, simply ignore.
        console.warn(e);
    }
}

function useMainNoteContexts() {
    const [ noteContexts, setNoteContexts ] = useState(appContext.tabManager.getMainNoteContexts());

    useTriliumEvents([ "newNoteContextCreated", "noteContextRemoved" ] , () => {
        setNoteContexts(appContext.tabManager.getMainNoteContexts());
    });

    return noteContexts;
}
