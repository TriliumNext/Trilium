import "./MobileNotePanel.css";

import { createPortal } from "preact";
import { useState } from "preact/hooks";

import { WidgetsByParent } from "../../services/bundle";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import { useNoteContext } from "../react/hooks";
import Modal from "../react/Modal";
import { RightPaneTabBodies, useRightPaneTabs } from "../sidebar/RightPanelContainer";
import RightPaneTabs, { RightPaneTabId } from "../sidebar/RightPaneTabs";

/** The mobile layout loads no script widgets for the right pane. */
const NO_CUSTOM_WIDGETS = new WidgetsByParent();

/**
 * The title-row button that opens the desktop right pane's tabs in a modal, for the mobile layout.
 * The attributes tab is left out, since the note menu already opens `NoteAttributesDialog`.
 */
export default function MobileNotePanel() {
    const [ shown, setShown ] = useState(false);
    const { note } = useNoteContext();

    return (
        <div className="mobile-note-panel-button">
            {note && <ActionButton
                icon="bx bx-dock-bottom"
                text={t("mobile_detail_menu.note_panel")}
                onClick={() => setShown(true)}
            />}
            {createPortal(<MobileNotePanelModal shown={shown} onHidden={() => setShown(false)} />, document.body)}
        </div>
    );
}

function MobileNotePanelModal({ shown, onHidden }: { shown: boolean; onHidden: () => void }) {
    const tabs = useRightPaneTabs(shown, NO_CUSTOM_WIDGETS).filter((tab) => tab.id !== "attributes");
    const [ selectedTabId, setSelectedTabId ] = useState<RightPaneTabId>();
    const activeTab = tabs.find((tab) => tab.id === selectedTabId) ?? tabs[0];

    return (
        <Modal
            className="mobile-note-panel"
            size="md"
            title={<RightPaneTabs tabs={tabs} activeTabId={activeTab?.id} onSelect={setSelectedTabId} />}
            ariaLabel={t("mobile_detail_menu.note_panel")}
            show={shown}
            onHidden={onHidden}
        >
            {/* The widgets' card, TOC and highlight styles are scoped to `#right-pane`, which the
                mobile layout has no other element for. */}
            <div id="right-pane">
                <RightPaneTabBodies tabs={tabs} activeTabId={activeTab?.id} />
            </div>
        </Modal>
    );
}
