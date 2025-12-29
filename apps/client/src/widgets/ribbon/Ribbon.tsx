import "./style.css";

import { KeyboardActionNames } from "@triliumnext/commons";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { EventNames } from "../../components/app_context";
import { Indexed, numberObjectsInPlace } from "../../services/utils";
import { useNoteContext, useNoteProperty, useStaticTooltipWithKeyboardShortcut, useTriliumEvents } from "../react/hooks";
import NoteActions from "./NoteActions";
import { TabConfiguration, TitleContext } from "./ribbon-interface";
import { RIBBON_TAB_DEFINITIONS } from "./RibbonDefinition";

const TAB_CONFIGURATION = numberObjectsInPlace<TabConfiguration>(RIBBON_TAB_DEFINITIONS);

interface ComputedTab extends Indexed<TabConfiguration> {
    shouldShow: boolean;
}

export default function Ribbon() {
    const { note, ntxId, hoistedNoteId, notePath, noteContext, componentId, isReadOnlyTemporarilyDisabled } = useNoteContext();
    const noteType = useNoteProperty(note, "type");
    const [ activeTabIndex, setActiveTabIndex ] = useState<number | undefined>();
    const [ computedTabs, setComputedTabs ] = useState<ComputedTab[]>();
    const titleContext: TitleContext = useMemo(() => ({
        note,
        noteContext
    }), [ note, noteContext ]);

    async function refresh() {
        const computedTabs: ComputedTab[] = [];
        for (const tab of TAB_CONFIGURATION) {
            const shouldShow = await shouldShowTab(tab.show, titleContext);
            computedTabs.push({
                ...tab,
                shouldShow: !!shouldShow
            });
        }
        setComputedTabs(computedTabs);
    }

    useEffect(() => {
        refresh();
    }, [ note, noteType, isReadOnlyTemporarilyDisabled ]);

    // Automatically activate the first ribbon tab that needs to be activated whenever a note changes.
    useEffect(() => {
        if (!computedTabs) return;
        const tabToActivate = computedTabs.find(tab => tab.shouldShow && (typeof tab.activate === "boolean" ? tab.activate : tab.activate?.(titleContext)));
        setActiveTabIndex(tabToActivate?.index);
    }, [ computedTabs, note?.noteId ]);

    // Register keyboard shortcuts.
    const eventsToListenTo = useMemo(() => TAB_CONFIGURATION.filter(config => config.toggleCommand).map(config => config.toggleCommand) as EventNames[], []);
    useTriliumEvents(eventsToListenTo, useCallback((e, toggleCommand) => {
        if (!computedTabs) return;
        const correspondingTab = computedTabs.find(tab => tab.toggleCommand === toggleCommand);
        if (correspondingTab?.shouldShow) {
            if (activeTabIndex !== correspondingTab.index) {
                setActiveTabIndex(correspondingTab.index);
            } else {
                setActiveTabIndex(undefined);
            }
        }
    }, [ computedTabs, activeTabIndex ]));

    const shouldShowRibbon = (noteContext?.viewScope?.viewMode === "default" && !noteContext.noteId?.startsWith("_options"));
    return (
        <div
            className={clsx("ribbon-container", !shouldShowRibbon && "hidden-ext")}
            style={{ contain: "none" }}
        >
            <div className="ribbon-top-row">
                <div className="ribbon-tab-container">
                    {computedTabs && computedTabs.map(({ title, icon, index, toggleCommand, shouldShow }) => (
                        shouldShow && <RibbonTab
                            icon={icon}
                            title={typeof title === "string" ? title : title(titleContext)}
                            active={index === activeTabIndex}
                            toggleCommand={toggleCommand}
                            onClick={() => {
                                if (activeTabIndex !== index) {
                                    setActiveTabIndex(index);
                                } else {
                                    // Collapse
                                    setActiveTabIndex(undefined);
                                }
                            }}
                        />
                    ))}
                </div>
                <NoteActions />
            </div>

            <div className="ribbon-body-container">
                {computedTabs && computedTabs.map(tab => {
                    const isActive = tab.index === activeTabIndex;
                    if (!isActive && !tab.stayInDom) {
                        return;
                    }

                    const TabContent = tab.content;

                    return (
                        <div className={`ribbon-body ${!isActive ? "hidden-ext" : ""}`}>
                            <TabContent
                                note={note}
                                hidden={!isActive}
                                ntxId={ntxId}
                                hoistedNoteId={hoistedNoteId}
                                notePath={notePath}
                                noteContext={noteContext}
                                componentId={componentId}
                                activate={useCallback(() => {
                                    setActiveTabIndex(tab.index);
                                }, [setActiveTabIndex])}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function RibbonTab({ icon, title, active, onClick, toggleCommand }: { icon: string; title: string; active: boolean, onClick: () => void, toggleCommand?: KeyboardActionNames }) {
    const iconRef = useRef<HTMLDivElement>(null);
    useStaticTooltipWithKeyboardShortcut(iconRef, title, toggleCommand);

    return (
        <>
            <div
                className={`ribbon-tab-title ${active ? "active" : ""}`}
                onClick={onClick}
            >
                <span
                    ref={iconRef}
                    className={`ribbon-tab-title-icon tn-icon ${icon}`}
                />
                &nbsp;
                { active && <span class="ribbon-tab-title-label">{title}</span> }
            </div>

            <div class="ribbon-tab-spacer" />
        </>
    );
}

export async function shouldShowTab(showConfig: boolean | ((context: TitleContext) => Promise<boolean | null | undefined> | boolean | null | undefined), context: TitleContext) {
    if (showConfig === null || showConfig === undefined) return true;
    if (typeof showConfig === "boolean") return showConfig;
    if ("then" in showConfig) return await showConfig(context);
    return showConfig(context);
}
