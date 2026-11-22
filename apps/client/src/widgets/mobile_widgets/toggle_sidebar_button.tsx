import "./toggle_sidebar_button.css";

import { t } from "../../services/i18n";
import { NARROW_LAYOUT, STACKED_TREE_LAYOUT } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { useMediaQuery } from "../react/hooks/dom";
import { useNoteContext } from "../react/hooks/note_context";

/**
 * The button at the start of the note's title row that reaches the tree. On a phone, where the tree
 * lies under the note, it goes back to the tree. On a tablet in portrait, where the tree is docked
 * and the launch bar sits at the bottom, it shows and hides the tree. A tablet in landscape toggles
 * the tree from the launch bar, so the button shows nothing there.
 */
export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();
    const isTreeStacked = useMediaQuery(STACKED_TREE_LAYOUT);
    const isNarrow = useMediaQuery(NARROW_LAYOUT);

    return (
        <div className="toggle-sidebar-button">
            {noteContext?.isMainContext() && (isTreeStacked ? (
                <ActionButton
                    icon={`bx ${glob.isRtl ? "bx-chevron-right" : "bx-chevron-left"}`}
                    text={t("note_tree.back-to-tree")}
                    onClick={(e) => {
                        // `SplitNoteContainer` activates the split a click lands in, so letting this one
                        // bubble would focus the main split -- the one this button sits in -- every time
                        // the sidebar is opened.
                        e.stopPropagation();

                        // Remove focus to prevent tooltip showing on top of the sidebar.
                        (e.currentTarget as HTMLButtonElement).blur();

                        parentComponent?.triggerCommand("setActiveScreen", {
                            screen: "tree"
                        });
                    }}
                />
            ) : isNarrow && (
                <ActionButton
                    icon="bx bx-sidebar"
                    text={t("left_pane_toggle.toggle")}
                    onClick={(e) => {
                        e.stopPropagation();
                        (e.currentTarget as HTMLButtonElement).blur();
                        parentComponent?.triggerCommand("toggleLeftPane");
                    }}
                />
            ))}
        </div>
    );
}
