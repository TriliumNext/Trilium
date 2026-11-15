import { useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks/events.js";
import Modal from "../react/Modal";
import { ContentLanguagesCard } from "../type_widgets/options/content_languages_card";

/**
 * The content-languages modal, summoned by a command rather than owned by whatever offers it.
 *
 * The status bar's language switcher holds its own copy behind a `useState`. The AI assistant's
 * Translate submenu is built imperatively by CKEditor and the context menu, so it has nowhere to
 * mount a modal; it raises this one with the `showContentLanguagesDialog` command instead.
 */
export default function ContentLanguagesDialog() {
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showContentLanguagesDialog", () => setShown(true));

    return <ContentLanguagesModal modalShown={shown} setModalShown={setShown} />;
}

export function ContentLanguagesModal({ modalShown, setModalShown }: { modalShown: boolean, setModalShown: (shown: boolean) => void }) {
    return (
        <Modal
            className="content-languages-modal"
            title={t("content_language.title")}
            show={modalShown} onHidden={() => setModalShown(false)}
            size="md" scrollable
        >
            <ContentLanguagesCard />
        </Modal>
    );
}
