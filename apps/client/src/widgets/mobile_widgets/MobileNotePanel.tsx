import "./MobileNotePanel.css";

import { createPortal } from "preact";
import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { STACKED_TREE_LAYOUT } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { useCustomWidgets } from "../react/hooks/custom_widgets";
import { useMediaQuery } from "../react/hooks/dom";
import { useTriliumEvent } from "../react/hooks/events";
import { useNoteContext } from "../react/hooks/note_context";
import { preloadLazyModule, WithLazyModule } from "../react/LazyComponent";
import type { RightPaneTabId } from "../sidebar/RightPaneTabs";

/**
 * The title-row button that opens the desktop right pane's tabs in a modal, for the mobile layout,
 * with the custom widgets of the right pane among them. `showNoteAttributes` opens it on the
 * attributes tab. A tablet, whose layout holds the desktop's right pane, peeks that pane instead.
 */
export default function MobileNotePanel() {
    const [ shown, setShown ] = useState(false);
    // The modal renders from the first opening on, and stays so it can animate closed.
    const [ opened, setOpened ] = useState(false);
    const [ selectedTabId, setSelectedTabId ] = useState<RightPaneTabId>();
    const { note, noteContext, parentComponent } = useNoteContext();
    const widgetsByParent = useCustomWidgets();
    const hasRightPane = !useMediaQuery(STACKED_TREE_LAYOUT);

    function show() {
        setOpened(true);
        setShown(true);
    }

    useTriliumEvent("showNoteAttributes", ({ ntxId }) => {
        if (!noteContext?.isCommandTarget(ntxId)) return;
        if (hasRightPane) {
            void parentComponent?.triggerCommand("selectRightPaneTab", { tabId: "attributes", peek: true });
            return;
        }
        setSelectedTabId("attributes");
        show();
    });

    return (
        <div className="mobile-note-panel-button">
            {note && (hasRightPane ? (
                <ActionButton
                    icon="bx bx-dock-right"
                    text={t("mobile_detail_menu.note_panel")}
                    onClick={() => void parentComponent?.triggerCommand("peekRightPane")}
                />
            ) : (
                <ActionButton
                    icon="bx bx-dock-bottom"
                    text={t("mobile_detail_menu.note_panel")}
                    onPointerEnter={preloadModal}
                    onPointerDown={preloadModal}
                    onFocus={preloadModal}
                    onClick={show}
                />
            ))}
            {opened && createPortal((
                <WithLazyModule load={loadModal}>
                    {({ default: MobileNotePanelModal }) => (
                        <MobileNotePanelModal
                            shown={shown} onHidden={() => setShown(false)} widgetsByParent={widgetsByParent}
                            selectedTabId={selectedTabId} setSelectedTabId={setSelectedTabId}
                        />
                    )}
                </WithLazyModule>
            ), document.body)}
        </div>
    );
}

// The right pane's tabs load once the panel is about to open.
const loadModal = () => import("./MobileNotePanelModal");
const preloadModal = () => preloadLazyModule(loadModal);
