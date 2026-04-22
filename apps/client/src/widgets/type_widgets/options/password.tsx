import { useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import Button from "../../react/Button";
import FormGroup from "../../react/FormGroup";
import FormTextBox from "../../react/FormTextBox";
import OptionsSection from "./components/OptionsSection";
import OptionsRow, { OptionsRowWithButton } from "./components/OptionsRow";
import protected_session_holder from "../../../services/protected_session_holder";
import { ChangePasswordResponse } from "@triliumnext/commons";
import dialog from "../../../services/dialog";
import TimeSelector from "./components/TimeSelector";
import Modal from "../../react/Modal";

export default function PasswordSettings() {
    return (
        <>
            <ChangePassword />
            <ProtectedSessionTimeout />
        </>
    );
}

function ChangePassword() {
    const [showModal, setShowModal] = useState(false);

    return (
        <OptionsSection title={t("password.heading")}>
            <OptionsRowWithButton
                label={t("password.change_password")}
                description={t("password.change_password_description")}
                icon="bx bx-chevron-right"
                onClick={() => setShowModal(true)}
            />

            <OptionsRowWithButton
                label={t("password.reset_password")}
                description={t("password.reset_password_description")}
                icon="bx bx-chevron-right"
                onClick={async () => {
                    if (!await dialog.confirm(t("password.reset_confirmation"))) {
                        return;
                    }

                    await server.post("password/reset?really=yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes");
                    toast.showError(t("password.reset_success_message"));
                }}
            />

            {createPortal(
                <ChangePasswordModal show={showModal} onHidden={() => setShowModal(false)} />,
                document.body
            )}
        </OptionsSection>
    );
}

interface ChangePasswordModalProps {
    show: boolean;
    onHidden: () => void;
}

function ChangePasswordModal({ show, onHidden }: ChangePasswordModalProps) {
    const [oldPassword, setOldPassword] = useState("");
    const [newPassword1, setNewPassword1] = useState("");
    const [newPassword2, setNewPassword2] = useState("");

    const handleSubmit = async () => {
        if (newPassword1 !== newPassword2) {
            toast.showError(t("password.password_mismatch"));
            return;
        }

        const result = await server.post<ChangePasswordResponse>("password/change", {
            current_password: oldPassword,
            new_password: newPassword1
        });

        if (result.success) {
            onHidden();
            setOldPassword("");
            setNewPassword1("");
            setNewPassword2("");
            await dialog.info(t("password.password_changed_success"));

            // password changed so current protected session is invalid and needs to be cleared
            protected_session_holder.resetProtectedSession();
        } else if (result.message) {
            toast.showError(result.message);
        }
    };

    const handleHidden = () => {
        setOldPassword("");
        setNewPassword1("");
        setNewPassword2("");
        onHidden();
    };

    return (
        <Modal
            show={show}
            onHidden={handleHidden}
            onSubmit={handleSubmit}
            title={t("password.change_password_heading")}
            className="change-password-modal"
            size="md"
            footer={
                <>
                    <Button text={t("password.cancel")} onClick={handleHidden} />
                    <Button text={t("password.change_password")} kind="primary" />
                </>
            }
        >
            <FormGroup name="old-password" label={t("password.old_password")}>
                <FormTextBox
                    type="password"
                    currentValue={oldPassword}
                    onChange={setOldPassword}
                />
            </FormGroup>

            <FormGroup name="new-password1" label={t("password.new_password")}>
                <FormTextBox
                    type="password"
                    currentValue={newPassword1}
                    onChange={setNewPassword1}
                />
            </FormGroup>

            <FormGroup name="new-password2" label={t("password.new_password_confirmation")}>
                <FormTextBox
                    type="password"
                    currentValue={newPassword2}
                    onChange={setNewPassword2}
                />
            </FormGroup>
        </Modal>
    );
}

function ProtectedSessionTimeout() {
    return (
        <OptionsSection title={t("password.protected_session_timeout")}>
            <OptionsRow
                name="protected-session-timeout"
                label={t("password.protected_session_timeout_label")}
                description={<>{t("password.protected_session_timeout_description")} <a class="tn-link" href="https://triliumnext.github.io/Docs/Wiki/protected-notes.html">{t("password.wiki")}</a> {t("password.for_more_info")}</>}
            >
                <TimeSelector
                    name="protected-session-timeout"
                    optionValueId="protectedSessionTimeout"
                    optionTimeScaleId="protectedSessionTimeoutTimeScale"
                    minimumSeconds={60}
                />
            </OptionsRow>
        </OptionsSection>
    );
}
