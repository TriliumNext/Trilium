import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import { useNoteContext, useTriliumEvents } from "../react/hooks";
import "./style.css";
import { VNode } from "preact";
import BasicPropertiesTab from "./BasicPropertiesTab";
import FormattingTab from "./FormattingTab";
import { numberObjectsInPlace } from "../../services/utils";
import { TabContext } from "./ribbon-interface";
import options from "../../services/options";
import { CommandNames, EventNames } from "../../components/app_context";
import FNote from "../../entities/fnote";
import ScriptTab from "./ScriptTab";
import EditedNotesTab from "./EditedNotesTab";
import NotePropertiesTab from "./NotePropertiesTab";
import NoteInfoTab from "./NoteInfoTab";
import SimilarNotesTab from "./SimilarNotesTab";
import FilePropertiesTab from "./FilePropertiesTab";
import ImagePropertiesTab from "./ImagePropertiesTab";
import NotePathsTab from "./NotePathsTab";
import NoteMapTab from "./NoteMapTab";
import OwnedAttributesTab from "./OwnedAttributesTab";
import InheritedAttributesTab from "./InheritedAttributesTab";
import CollectionPropertiesTab from "./CollectionPropertiesTab";
import SearchDefinitionTab from "./SearchDefinitionTab";
import NoteActions from "./NoteActions";

interface TitleContext {
    note: FNote | null | undefined;
}

interface TabConfiguration {
    title: string | ((context: TitleContext) => string);
    icon: string;
    // TODO: Mark as required after porting them all.
    content?: (context: TabContext) => VNode;
    show?: boolean | ((context: TitleContext) => boolean | null | undefined);
    toggleCommand?: CommandNames;
    activate?: boolean | ((context: TitleContext) => boolean);
    /**
     * By default the tab content will not be rendered unless the tab is active (i.e. selected by the user). Setting to `true` will ensure that the tab is rendered even when inactive, for cases where the tab needs to be accessible at all times (e.g. for the detached editor toolbar).
     */
    stayInDom?: boolean;
}

const TAB_CONFIGURATION = numberObjectsInPlace<TabConfiguration>([
    {
        title: t("classic_editor_toolbar.title"),
        icon: "bx bx-text",
        show: ({ note }) => note?.type === "text" && options.get("textNoteEditorType") === "ckeditor-classic",
        toggleCommand: "toggleRibbonTabClassicEditor",
        content: FormattingTab,
        stayInDom: true
    },
    {        
        title: ({ note }) => note?.isTriliumSqlite() ? t("script_executor.query") : t("script_executor.script"),
        icon: "bx bx-play",
        content: ScriptTab,
        activate: true,
        show: ({ note }) => note &&
            (note.isTriliumScript() || note.isTriliumSqlite()) &&
            (note.hasLabel("executeDescription") || note.hasLabel("executeButton"))
    },
    {
        title: t("search_definition.search_parameters"),
        icon: "bx bx-search",
        content: SearchDefinitionTab,
        activate: true,
        show: ({ note }) => note?.type === "search"
    },
    {
        title: t("edited_notes.title"),
        icon: "bx bx-calendar-edit",
        content: EditedNotesTab,
        show: ({ note }) => note?.hasOwnedLabel("dateNote"),
        activate: ({ note }) => (note?.getPromotedDefinitionAttributes().length === 0 || !options.is("promotedAttributesOpenInRibbon")) && options.is("editedNotesOpenInRibbon")
    },
    {
        title: t("book_properties.book_properties"),
        icon: "bx bx-book",
        content: CollectionPropertiesTab,
        show: ({ note }) => note?.type === "book",
        toggleCommand: "toggleRibbonTabBookProperties"
    },
    {
        title: t("note_properties.info"),
        icon: "bx bx-info-square",
        content: NotePropertiesTab,
        show: ({ note }) => !!note?.getLabelValue("pageUrl"),
        activate: true
    },
    {
        title: t("file_properties.title"),
        icon: "bx bx-file",
        content: FilePropertiesTab,
        show: ({ note }) => note?.type === "file",
        toggleCommand: "toggleRibbonTabFileProperties",
        activate: true
    },
    {
        title: t("image_properties.title"),
        icon: "bx bx-image",
        content: ImagePropertiesTab,
        show: ({ note }) => note?.type === "image",
        toggleCommand: "toggleRibbonTabImageProperties",
        activate: true,
    },
    {
        // BasicProperties
        title: t("basic_properties.basic_properties"),
        icon: "bx bx-slider",
        content: BasicPropertiesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabBasicProperties"
    },
    {
        title: t("owned_attribute_list.owned_attributes"),
        icon: "bx bx-list-check",
        content: OwnedAttributesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabOwnedAttributes"
    },
    {
        title: t("inherited_attribute_list.title"),
        icon: "bx bx-list-plus",
        content: InheritedAttributesTab,
        show: ({note}) => !note?.isLaunchBarConfig(),
        toggleCommand: "toggleRibbonTabInheritedAttributes"
    },
    {
        title: t("note_paths.title"),
        icon: "bx bx-collection",
        content: NotePathsTab,
        show: true,
        toggleCommand: "toggleRibbonTabNotePaths"
    },
    {
        title: t("note_map.title"),
        icon: "bx bxs-network-chart",
        content: NoteMapTab,
        show: true,
        toggleCommand: "toggleRibbonTabNoteMap"
    },
    {
        title: t("similar_notes.title"),
        icon: "bx bx-bar-chart",
        show: ({ note }) => note?.type !== "search" && !note?.isLabelTruthy("similarNotesWidgetDisabled"),
        content: SimilarNotesTab,
        toggleCommand: "toggleRibbonTabSimilarNotes"
    },
    {
        title: t("note_info_widget.title"),
        icon: "bx bx-info-circle",
        show: ({ note }) => !!note,
        content: NoteInfoTab,
        toggleCommand: "toggleRibbonTabNoteInfo"
    }
]);

export default function Ribbon() {
    const { note, ntxId, hoistedNoteId, notePath, noteContext, componentId } = useNoteContext();
    const titleContext: TitleContext = { note };
    const [ activeTabIndex, setActiveTabIndex ] = useState<number | undefined>();
    const filteredTabs = useMemo(() => TAB_CONFIGURATION.filter(tab => typeof tab.show === "boolean" ? tab.show : tab.show?.(titleContext)), [ titleContext, note ]);

    // Automatically activate the first ribbon tab that needs to be activated whenever a note changes.
    useEffect(() => {
        const tabToActivate = filteredTabs.find(tab => typeof tab.activate === "boolean" ? tab.activate : tab.activate?.(titleContext));
        if (tabToActivate) {
            setActiveTabIndex(tabToActivate.index);
        }
    }, [ note?.noteId ]);

    // Register keyboard shortcuts.
    const eventsToListenTo = useMemo(() => TAB_CONFIGURATION.filter(config => config.toggleCommand).map(config => config.toggleCommand) as EventNames[], []);
    useTriliumEvents(eventsToListenTo, useCallback((e, toggleCommand) => {
        const correspondingTab = filteredTabs.find(tab => tab.toggleCommand === toggleCommand);
        if (correspondingTab) {
            if (activeTabIndex !== correspondingTab.index) {
                setActiveTabIndex(correspondingTab.index);
            } else {
                setActiveTabIndex(undefined);
            }
        }
    }, [ filteredTabs, activeTabIndex ]));

    return (
        <div className="ribbon-container" style={{ contain: "none" }}>
            <div className="ribbon-top-row">
                <div className="ribbon-tab-container">
                    {filteredTabs.map(({ title, icon, index }) => (
                        <RibbonTab
                            icon={icon}
                            title={typeof title === "string" ? title : title(titleContext)}
                            active={index === activeTabIndex}
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
                <div className="ribbon-button-container">
                    { note && <NoteActions note={note} noteContext={noteContext} /> }
                </div>
            </div>
        
            <div className="ribbon-body-container">
                <div className="ribbon-body">
                    {filteredTabs.map(tab => {
                        const isActive = tab.index === activeTabIndex;
                        if (!isActive && !tab.stayInDom) {
                            return;
                        }

                        return tab?.content && tab.content({
                            note,
                            hidden: !isActive,
                            ntxId,
                            hoistedNoteId,
                            notePath,
                            noteContext,
                            componentId
                        });
                    })}
                </div>
            </div>
        </div>
    )
}

function RibbonTab({ icon, title, active, onClick }: { icon: string; title: string; active: boolean, onClick: () => void }) {
    return (
        <>
            <div
                className={`ribbon-tab-title ${active ? "active" : ""}`}
                onClick={onClick}
            >
                <span
                    className={`ribbon-tab-title-icon ${icon}`}
                    title={title}                    
                />
                &nbsp;
                { active && <span class="ribbon-tab-title-label">{title}</span> }
            </div>

            <div class="ribbon-tab-spacer" />
        </>
    )
}

