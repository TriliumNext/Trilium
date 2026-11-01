import "./toggle_sidebar_button.css";

import { useEffect, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { isNarrowLayout, onNarrowLayoutChange } from "../../services/utils";
import ActionButton from "../react/ActionButton";
import { useNoteContext } from "../react/hooks";

export default function ToggleSidebarButton() {
    const { noteContext, parentComponent } = useNoteContext();
    const [ isPhone, setPhone ] = useState(isNarrowLayout);
    useEffect(() => onNarrowLayoutChange(() => setPhone(isNarrowLayout())), []);

    return (
        <div className="toggle-sidebar-button">
            { noteContext?.isMainContext() && <ActionButton
                icon={isPhone ? `bx ${glob.isRtl ? "bx-chevron-right" : "bx-chevron-left"}` : "bx bx-sidebar"}
                text={isPhone ? t("note_tree.back-to-tree") : t("note_tree.toggle-sidebar")}
                onClick={(e) => {
                    // `SplitNoteContainer` activates the split a click lands in, so letting this one
                    // bubble would focus the main split -- the one this button sits in -- every time
                    // the sidebar is opened.
                    e.stopPropagation();

                    // Remove focus to prevent tooltip showing on top of the sidebar.
                    (e.currentTarget as HTMLButtonElement).blur();

                    // In the tablet mode of the mobile layout (see `style.css`) the sidebar sits next
                    // to the note instead of sliding over it, so the button hides and shows it like the
                    // left pane toggle on desktop.
                    if (!isNarrowLayout()) {
                        parentComponent?.triggerCommand("toggleLeftPane");
                        return;
                    }

                    parentComponent?.triggerCommand("setActiveScreen", {
                        screen: "tree"
                    });
                }}
            />}
        </div>
    );
}
