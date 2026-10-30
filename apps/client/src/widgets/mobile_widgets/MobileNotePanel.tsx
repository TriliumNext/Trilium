import "./MobileNotePanel.css";

import { createPortal } from "preact";
import { useState } from "preact/hooks";

import type { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useNoteContext, useTriliumEvent } from "../react/hooks";
import { MasterDetailModal } from "../react/master_detail";
import TabStrip from "../react/TabStrip";
import NoteMap from "../sidebar/NoteMap";
import PdfPages from "../sidebar/pdf/PdfPages";
import { RightPaneTabBodies, type RightPaneTabContents, useRightPaneTabs } from "../sidebar/RightPanelContainer";
import { NavigatedInNote } from "../sidebar/RightPanelWidget";
import { RightPaneTabId } from "../sidebar/RightPaneTabs";

/**
 * The title-row button that opens the desktop right pane's tabs in a modal, for the mobile layout.
 * `showNoteAttributes` opens it on the attributes tab.
 */
export default function MobileNotePanel({ widgetsByParent }: { widgetsByParent: WidgetsByParent }) {
    const [ shown, setShown ] = useState(false);
    const [ selectedTabId, setSelectedTabId ] = useState<RightPaneTabId>();
    const { note, noteContext } = useNoteContext();

    useTriliumEvent("showNoteAttributes", ({ ntxId }) => {
        if (!noteContext?.isCommandTarget(ntxId)) return;
        setSelectedTabId("attributes");
        setShown(true);
    });

    return (
        <div className="mobile-note-panel-button">
            {note && <ActionButton
                icon="bx bx-dock-bottom"
                text={t("mobile_detail_menu.note_panel")}
                onClick={() => setShown(true)}
            />}
            {createPortal((
                <MobileNotePanelModal
                    shown={shown} onHidden={() => setShown(false)} widgetsByParent={widgetsByParent}
                    selectedTabId={selectedTabId} setSelectedTabId={setSelectedTabId}
                />
            ), document.body)}
        </div>
    );
}

function MobileNotePanelModal({ shown, onHidden, widgetsByParent, selectedTabId, setSelectedTabId }: {
    shown: boolean;
    onHidden: () => void;
    widgetsByParent: WidgetsByParent;
    selectedTabId: RightPaneTabId | undefined;
    setSelectedTabId: (tabId: RightPaneTabId) => void;
}) {
    const tabs = useRightPaneTabs(shown, widgetsByParent).map(withFixedHeightWidgetsLast);
    const activeTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];

    return (
        // A master-detail modal, so that editing an attribute is a page of its own, headed by a way
        // back (see `useMasterDetailPage()` in AttributeList.tsx).
        <MasterDetailModal
            className="mobile-note-panel"
            size="md"
            // In `.modal-title`, which master_detail.css hides in favour of `MasterDetailHeader`.
            title={(
                <div className="modal-title">
                    <TabStrip labelled tabs={tabs} activeTabId={activeTab?.id} onSelect={setSelectedTabId} />
                </div>
            )}
            backTitle={t("attribute_list_panel.back")}
            ariaLabel={t("mobile_detail_menu.note_panel")}
            show={shown}
            onHidden={onHidden}
        >
            {/* The widgets' card, TOC and highlight styles are scoped to `#right-pane`, which the
                mobile layout has no other element for. */}
            <div id="right-pane">
                <NavigatedInNote.Provider value={onHidden}>
                    <RightPaneTabBodies tabs={tabs} activeTabId={activeTab?.id} flat />
                </NavigatedInNote.Provider>
            </div>
        </MasterDetailModal>
    );
}

/**
 * Moves `NoteMap` and `PdfPages` to the end of the tab: both are drawn to a fixed height, which in a
 * tab that scrolls as a whole would sit between the sections around them.
 */
function withFixedHeightWidgetsLast(tab: RightPaneTabContents): RightPaneTabContents {
    const isFixedHeight = (item: RightPaneTabContents["items"][number]) => item.type === NoteMap || item.type === PdfPages;
    return {
        ...tab,
        items: [ ...tab.items.filter((item) => !isFixedHeight(item)), ...tab.items.filter(isFixedHeight) ]
    };
}
