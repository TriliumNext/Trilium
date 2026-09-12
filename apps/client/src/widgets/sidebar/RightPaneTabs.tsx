import { t } from "../../services/i18n";
import TabStrip, { type TabStripTabDefinition } from "../react/TabStrip";

export type RightPaneTabId = "outline" | "attributes" | "connections" | "chat" | "widgets";

export interface RightPaneTabDefinition extends TabStripTabDefinition<RightPaneTabId> {
    /**
     * Keep the tab in the strip for a note it has nothing to show, saying so in its body instead of
     * going away. For a tab whose widgets come and go with the type of the note being read: leaving
     * would take the strip's shape — and, where it is the tab on show, the pane's contents — with it,
     * so that merely moving between notes moves the tabs about under the pointer.
     */
    alwaysShown?: boolean;
}

/**
 * The groups the right pane's widgets are divided into, in the order they are offered. A tab with
 * nothing to show for the current note is left out entirely unless it asks to stay, so most notes see
 * fewer than all four.
 */
export const RIGHT_PANE_TABS: RightPaneTabDefinition[] = [
    // The outline is what a note's type decides the most: a text note has headings, a PDF has pages,
    // an image has neither. It stays put through all of them.
    { id: "outline", title: t("right_pane.tab_outline"), icon: "bx bx-list-ul", alwaysShown: true },
    { id: "attributes", title: t("right_pane.tab_attributes"), icon: "bx bx-hash" },
    // How the note relates to the others. Empty for now (its widgets are yet to come), so it leans on
    // alwaysShown to appear in the strip at all; any note can be linked to, so staying put fits it anyway.
    { id: "connections", title: t("right_pane.tab_connections"), icon: "bx bx-network-chart", alwaysShown: true },
    { id: "chat", title: t("right_pane.tab_chat"), icon: "bx bx-bot" },
    // Widgets contributed by the user's own scripts, which belong to none of the groups above.
    { id: "widgets", title: t("right_pane.tab_widgets"), icon: "bx bx-extension" }
];

interface RightPaneTabsProps {
    tabs: RightPaneTabDefinition[];
    activeTabId?: RightPaneTabId;
    onSelect: (tabId: RightPaneTabId) => void;
}

/**
 * The tab strip of the right pane's header row: which group of widgets is on show. RightPanelContainer
 * lays it out beside the pane's pin/close actions (see RightPanelContainer.css).
 */
export default function RightPaneTabs({ tabs, activeTabId, onSelect }: RightPaneTabsProps) {
    return (
        <TabStrip
            className="right-pane-tabs"
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={onSelect}
        />
    );
}
