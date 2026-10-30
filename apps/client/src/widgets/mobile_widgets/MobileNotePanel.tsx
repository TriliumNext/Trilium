import "./MobileNotePanel.css";

import { createPortal } from "preact";
import { useState } from "preact/hooks";

import type { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useNoteContext } from "../react/hooks";
import Modal from "../react/Modal";
import TabStrip from "../react/TabStrip";
import NoteMap from "../sidebar/NoteMap";
import PdfPages from "../sidebar/pdf/PdfPages";
import { RightPaneTabBodies, type RightPaneTabContents, useRightPaneTabs } from "../sidebar/RightPanelContainer";
import { NavigatedInNote } from "../sidebar/RightPanelWidget";
import { RightPaneTabId } from "../sidebar/RightPaneTabs";

/**
 * The title-row button that opens the desktop right pane's tabs in a modal, for the mobile layout.
 * The attributes tab is left out, since the note menu already opens `NoteAttributesDialog`.
 */
export default function MobileNotePanel({ widgetsByParent }: { widgetsByParent: WidgetsByParent }) {
    const [ shown, setShown ] = useState(false);
    const { note } = useNoteContext();

    return (
        <div className="mobile-note-panel-button">
            {note && <ActionButton
                icon="bx bx-dock-bottom"
                text={t("mobile_detail_menu.note_panel")}
                onClick={() => setShown(true)}
            />}
            {createPortal(<MobileNotePanelModal shown={shown} onHidden={() => setShown(false)} widgetsByParent={widgetsByParent} />, document.body)}
        </div>
    );
}

function MobileNotePanelModal({ shown, onHidden, widgetsByParent }: { shown: boolean; onHidden: () => void; widgetsByParent: WidgetsByParent }) {
    const tabs = useRightPaneTabs(shown, widgetsByParent)
        .filter((tab) => tab.id !== "attributes")
        .map(withFixedHeightWidgetsLast);
    const [ selectedTabId, setSelectedTabId ] = useState<RightPaneTabId>();
    const activeTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];

    return (
        <Modal
            className="mobile-note-panel"
            size="md"
            title={<TabStrip labelled tabs={tabs} activeTabId={activeTab?.id} onSelect={setSelectedTabId} />}
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
        </Modal>
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
