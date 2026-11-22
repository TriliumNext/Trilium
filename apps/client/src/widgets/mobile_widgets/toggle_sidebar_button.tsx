import "./toggle_sidebar_button.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isNarrowLayout, onNarrowLayoutChange } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { useNoteContext } from "../react/hooks/note_context";

/**
 * The button that goes back from the note to the tree on a phone. A tablet's sidebar sits next to the
 * note and is toggled from the launch bar, so the button shows only on a phone.
 */
export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();
    const [ isPhone, setPhone ] = useState(isNarrowLayout);
    useEffect(() => onNarrowLayoutChange(() => setPhone(isNarrowLayout())), []);

    return (
        <div className="toggle-sidebar-button">
            { isPhone && noteContext?.isMainContext() && <ActionButton
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
