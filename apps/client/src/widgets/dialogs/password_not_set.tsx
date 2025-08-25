import Modal from "../react/Modal";
import { t } from "../../services/i18n";
import Button from "../react/Button";
import appContext from "../../components/app_context";
import { useState } from "preact/hooks";
import { useTriliumEvent } from "../react/hooks";

export default function PasswordNotSetDialog() {
    const [ shown, setShown ] = useState(false);
    useTriliumEvent("showPasswordNotSet", () => setShown(true));

    return (
        <Modal
            size="md" className="password-not-set-dialog"
            title={t("password_not_set.title")}
            footer={<Button icon="bx bx-lock" text={t("password_not_set.go_to_password_options")} onClick={() => {
                setShown(false);
                appContext.triggerCommand("showOptions", { section: "_optionsPassword" });
            }} />}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <p>{t("password_not_set.body1")}</p>
            <p>{t("password_not_set.body2")}</p>
        </Modal>
    );
}

