import { useState } from "preact/hooks"
import { t } from "../../../services/i18n"
import server from "../../../services/server"
import toast from "../../../services/toast"
import Alert from "../../react/Alert"
import Button from "../../react/Button"
import FormGroup from "../../react/FormGroup"
import FormTextBox from "../../react/FormTextBox"
import LinkButton from "../../react/LinkButton"
import OptionsSection from "./components/OptionsSection"
import protected_session_holder from "../../../services/protected_session_holder"
import { ChangePasswordResponse } from "@triliumnext/commons"
import dialog from "../../../services/dialog"
import TimeSelector from "./components/TimeSelector"
import FormText from "../../react/FormText"

export default function PasswordSettings() {
    return (
        <>
            <ChangePassword />
            <ProtectedSessionTimeout />
        </>
    )
}

function ChangePassword() {
    const [ oldPassword, setOldPassword ] = useState("");
    const [ newPassword1, setNewPassword1 ] = useState("");
    const [ newPassword2, setNewPassword2 ] = useState("");

    return (
        <OptionsSection title={t("password.heading")}>
            <Alert type="warning">
                {t("password.alert_message")}
                &nbsp;
                <LinkButton
                    text={t("password.reset_link")}
                    onClick={async () => {
                        if (!confirm(t("password.reset_confirmation"))) {
                            return;
                        }

                        await server.post("password/reset?really=yesIReallyWantToResetPasswordAndLoseAccessToMyProtectedNotes");
                        toast.showError(t("password.reset_success_message"));
                    }}
                />
            </Alert>

            <form onSubmit={async (e) => {
                e.preventDefault();

                setOldPassword("");
                setNewPassword1("");
                setNewPassword2("");

                if (newPassword1 !== newPassword2) {
                    toast.showError(t("password.password_mismatch"));
                    return;
                }

                const result = await server
                    .post<ChangePasswordResponse>("password/change", {
                        current_password: oldPassword,
                        new_password: newPassword1
                    })
                if (result.success) {
                    await dialog.info(t("password.password_changed_success"));                    

                    // password changed so current protected session is invalid and needs to be cleared
                    protected_session_holder.resetProtectedSession();
                } else if (result.message) {
                    toast.showError(result.message);
                }
            }}>
                <FormGroup name="old-password" label={t("password.old_password")}>
                    <FormTextBox                        
                        type="password"
                        currentValue={oldPassword} onChange={setOldPassword}
                    />                    
                </FormGroup>

                <FormGroup name="new-password1" label={t("password.new_password")}>
                    <FormTextBox                        
                        type="password"
                        currentValue={newPassword1} onChange={setNewPassword1}
                    />
                </FormGroup>

                <FormGroup name="new-password2" label={t("password.new_password_confirmation")}>
                    <FormTextBox                        
                        type="password"
                        currentValue={newPassword2} onChange={setNewPassword2}
                    />
                </FormGroup>

                <Button
                    text={t("password.change_password")}
                    kind="primary"
                />
            </form>
        </OptionsSection>
    )
}

function ProtectedSessionTimeout() {
    return (
        <OptionsSection title={t("password.protected_session_timeout")}>
            <FormText>
                {t("password.protected_session_timeout_description")}
                &nbsp;
                <a class="tn-link" href="https://triliumnext.github.io/Docs/Wiki/protected-notes.html" className="external">{t("password.wiki")}</a> {t("password.for_more_info")}
            </FormText>
            
            <FormGroup name="protected-session-timeout" label={t("password.protected_session_timeout_label")}>
                <TimeSelector                    
                    name="protected-session-timeout"
                    optionValueId="protectedSessionTimeout" optionTimeScaleId="protectedSessionTimeoutTimeScale"
                    minimumSeconds={60}
                />
            </FormGroup>
        </OptionsSection>
    )
}