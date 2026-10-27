import "./show_all_notes_button.css";

import clsx from "clsx";

import { t } from "../../services/i18n";
import Button from "../react/Button";
import { useActiveNoteContext } from "../react/hooks";

/** Unhoists the active note context. Shown above the note tree while a note is hoisted. */
export default function ShowAllNotesButton() {
    const { hoistedNoteId } = useActiveNoteContext();
    const isHoisted = !!hoistedNoteId && hoistedNoteId !== "root";

    // The wrapper stays mounted because `ReactWrappedWidget` keeps the nodes of the first render.
    return (
        <div className={clsx("show-all-notes", !isHoisted && "hidden-ext")}>
            {isHoisted && (
                <Button
                    kind="lowProfile"
                    icon="bx-arrow-back"
                    text={t("note_tree.show-all-notes")}
                    triggerCommand="unhoist"
                />
            )}
        </div>
    );
}
