import "./note_attributes.css";

import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import { MasterDetailModal } from "../react/master_detail";
import AttributeList from "../sidebar/AttributeList";

/**
 * The attributes panel as a modal, for the layouts with no right pane to put it in — the mobile one,
 * where it is summoned from the note's own menu. The panel follows the note being read, so the modal is
 * summoned without being told which note it is about.
 *
 * A master-detail modal: on a screen too narrow to hold a form beside the list, the attribute being
 * edited is a page of its own that slides in over it. The panel announces that page itself (see
 * useMasterDetailPage), so all that is left here is the modal it happens in.
 */
export default function NoteAttributesDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showNoteAttributes", () => setShown(true));

    return (
        <MasterDetailModal
            className="note-attributes-modal"
            // Named as the menu entry that summons it names it; a page of its own is named by the
            // attribute on it instead.
            title={t("note_actions.note_attributes")}
            backTitle={t("attribute_list_panel.back")}
            size="md"
            show={shown}
            onHidden={() => setShown(false)}
            scrollable
            isFullPageOnMobile
        >
            <AttributeList />
        </MasterDetailModal>
    );
}
