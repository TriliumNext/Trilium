import "./toggle_sidebar_button.css";

import { t } from "../../services/i18n";
import { STACKED_TREE_LAYOUT } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { useMediaQuery } from "../react/hooks/dom";
import { useNoteContext } from "../react/hooks/note_context";

/**
 * The button that goes back from the note to the tree where the tree lies under the note, as on a
 * phone. A tablet docks the tree next to the note and toggles it from the launch bar, so the button
 * shows only while the tree is stacked.
 */
export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();
    const isTreeStacked = useMediaQuery(STACKED_TREE_LAYOUT);

    return (
        <div className="toggle-sidebar-button">
            { isTreeStacked && noteContext?.isMainContext() && <ActionButton
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
            />}
        </div>
    );
}
