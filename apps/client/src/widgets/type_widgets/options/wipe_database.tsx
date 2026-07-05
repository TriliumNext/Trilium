import "./wipe_database.css";

import { WipeDatabaseResponse } from "@triliumnext/commons";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { reloadFrontendApp } from "../../../services/utils";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import FormText from "../../react/FormText";
import Modal from "../../react/Modal";
import { OptionsRowWithButton } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

/** Verbose confirmation token — must match `WIPE_DATABASE_CONFIRMATION` on the server route. */
const WIPE_DATABASE_CONFIRMATION = "yesIReallyWantToDeleteEverythingAndCannotUndoThis";

/** Seconds the confirm button stays disabled, forcing the user to pause and read the warning. */
const COUNTDOWN_SECONDS = 5;

export default function WipeDatabaseOptions() {
    const [showModal, setShowModal] = useState(false);

    return (
        <OptionsSection title={t("wipe_database.title")} description={t("wipe_database.description")}>
            <OptionsRowWithButton
                label={t("wipe_database.wipe_label")}
                description={t("wipe_database.wipe_description")}
                buttonText={t("wipe_database.wipe_button")}
                buttonClassName="wipe-database-button"
                icon="bx-trash"
                onClick={() => setShowModal(true)}
            />

            {createPortal(
                <WipeDatabaseModal show={showModal} onHidden={() => setShowModal(false)} />,
                document.body
            )}
        </OptionsSection>
    );
}

interface WipeDatabaseModalProps {
    show: boolean;
    onHidden: () => void;
}

function WipeDatabaseModal({ show, onHidden }: WipeDatabaseModalProps) {
    const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
    const [wiping, setWiping] = useState(false);

    // Reset state every time the dialog opens: restart the countdown (so the delay can't be skipped
    // by reopening) and clear any stale `wiping` flag left behind if a previous attempt's dialog was
    // dismissed while its request was still pending. The interval stops itself once it reaches zero.
    useEffect(() => {
        if (!show) {
            return;
        }

        setSecondsLeft(COUNTDOWN_SECONDS);
        setWiping(false);

        let remaining = COUNTDOWN_SECONDS;
        const interval = setInterval(() => {
            remaining -= 1;
            setSecondsLeft(remaining);
            if (remaining <= 0) {
                clearInterval(interval);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [show]);

    const wipe = async () => {
        setWiping(true);
        try {
            const { success } = await server.post<WipeDatabaseResponse>(`database/wipe?really=${WIPE_DATABASE_CONFIRMATION}`);
            if (!success) {
                toast.showError(t("wipe_database.wipe_failed"));
                setWiping(false);
                return;
            }
            toast.showMessage(t("wipe_database.wipe_succeeded"));
            // The document is now empty and any protected session / login is invalidated; reload so the
            // client rebuilds its own caches (froca) and lands on the fresh setup/login flow.
            reloadFrontendApp("database wiped");
        } catch {
            toast.showError(t("wipe_database.wipe_failed"));
            setWiping(false);
        }
    };

    const countingDown = secondsLeft > 0;

    return (
        <Modal
            className="wipe-database-dialog"
            size="md"
            stackable
            title={t("wipe_database.dialog_title")}
            onHidden={onHidden}
            show={show}
            footer={<>
                <Button text={t("wipe_database.cancel")} onClick={onHidden} disabled={wiping} />
                <Button
                    className="wipe-database-confirm-button"
                    text={countingDown
                        ? t("wipe_database.confirm_button_countdown", { seconds: secondsLeft })
                        : t("wipe_database.confirm_button")}
                    icon="bx-trash"
                    disabled={countingDown || wiping}
                    onClick={() => void wipe()}
                />
            </>}
        >
            <Admonition type="caution">
                <strong>{t("wipe_database.warning_heading")}</strong>
                <p>{t("wipe_database.warning_body")}</p>
            </Admonition>
            <FormText>{t("wipe_database.backup_hint")}</FormText>
        </Modal>
    );
}
