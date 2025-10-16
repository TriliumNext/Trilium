import { Trans } from "react-i18next"
import { t } from "../../../services/i18n"
import FormText from "../../react/FormText"
import OptionsSection from "./components/OptionsSection"
import FormCheckbox from "../../react/FormCheckbox"
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks"
import { FormInlineRadioGroup } from "../../react/FormRadioGroup"
import Admonition from "../../react/Admonition"
import { useCallback, useEffect, useState } from "preact/hooks"
import { OAuthStatus, TOTPGenerate, TOTPRecoveryKeysResponse, TOTPStatus } from "@triliumnext/commons"
import server from "../../../services/server"
import Button from "../../react/Button"
import dialog from "../../../services/dialog"
import toast from "../../../services/toast"
import RawHtml from "../../react/RawHtml"
import { isElectron } from "../../../services/utils"

export default function MultiFactorAuthenticationSettings() {
    const [ mfaEnabled, setMfaEnabled ] = useTriliumOptionBool("mfaEnabled");

    return (!isElectron()
        ? (
            <>
                <EnableMultiFactor mfaEnabled={mfaEnabled} setMfaEnabled={setMfaEnabled} />
                { mfaEnabled && <MultiFactorMethod /> }
            </>
        ) : (
            <FormText>{t("multi_factor_authentication.electron_disabled")}</FormText>
        )
    )
}

function EnableMultiFactor({ mfaEnabled, setMfaEnabled }: { mfaEnabled: boolean, setMfaEnabled: (newValue: boolean) => Promise<void>}) {
    return (
        <OptionsSection title={t("multi_factor_authentication.title")}>
            <FormText><Trans i18nKey="multi_factor_authentication.description" /></FormText>

            <FormCheckbox
                name="mfa-enabled"
                label={t("multi_factor_authentication.mfa_enabled")}
                currentValue={mfaEnabled} onChange={setMfaEnabled}
            />
        </OptionsSection>
    )
}

function MultiFactorMethod() {
    const [ mfaMethod, setMfaMethod ] = useTriliumOption("mfaMethod");

    return (
        <>
            <OptionsSection className="mfa-options" title={t("multi_factor_authentication.mfa_method")}>
                <FormInlineRadioGroup
                    name="mfaMethod"
                    currentValue={mfaMethod} onChange={setMfaMethod}
                    values={[
                        { value: "totp", label: t("multi_factor_authentication.totp_title") },
                        { value: "oauth", label: t("multi_factor_authentication.oauth_title") }
                    ]}
                />

                <FormText>
                    { mfaMethod === "totp"
                    ? t("multi_factor_authentication.totp_description")
                    : <RawHtml html={t("multi_factor_authentication.oauth_description")} /> }
                </FormText>
            </OptionsSection>

            { mfaMethod === "totp"
            ? <TotpSettings />
            : <OAuthSettings /> }
        </>
    )
}

function TotpSettings() {
    const [ totpStatus, setTotpStatus ] = useState<TOTPStatus>();
    const [ recoveryKeys, setRecoveryKeys ] = useState<string[]>();

    const refreshTotpStatus = useCallback(() => {
        server.get<TOTPStatus>("totp/status").then(setTotpStatus);
    }, [])

    const refreshRecoveryKeys = useCallback(async () => {
        const result = await server.get<TOTPRecoveryKeysResponse>("totp_recovery/enabled");

        if (!result.success) {
            toast.showError(t("multi_factor_authentication.recovery_keys_error"));
            return;
        }

        if (!result.keysExist) {
            setRecoveryKeys(undefined);
            return;
        }

        const usedResult = await server.get<TOTPRecoveryKeysResponse>("totp_recovery/used");
        setRecoveryKeys(usedResult.usedRecoveryCodes);
    }, []);

    const generateRecoveryKeys = useCallback(async () => {
        const result = await server.get<TOTPRecoveryKeysResponse>("totp_recovery/generate");
        if (!result.success) {
            toast.showError(t("multi_factor_authentication.recovery_keys_error"));
            return;
        }

        if (result.recoveryCodes) {
            setRecoveryKeys(result.recoveryCodes);
        }

        await server.post("totp_recovery/set", {
            recoveryCodes: result.recoveryCodes,
        });
    }, []);

    useEffect(() => {
        refreshTotpStatus();
        refreshRecoveryKeys();
    }, []);

    return (<>
        <OptionsSection title={t("multi_factor_authentication.totp_secret_title")}>
            {totpStatus?.set
            ? <Admonition type="warning">{t("multi_factor_authentication.totp_secret_description_warning")}</Admonition>
            : <Admonition type="note">{t("multi_factor_authentication.no_totp_secret_warning")}</Admonition>
            }

            <Button
                text={totpStatus?.set
                    ? t("multi_factor_authentication.totp_secret_regenerate")
                    : t("multi_factor_authentication.totp_secret_generate")}
                onClick={async () => {
                    if (totpStatus?.set && !await dialog.confirm(t("multi_factor_authentication.totp_secret_regenerate_confirm"))) {
                        return;
                    }

                    const result = await server.get<TOTPGenerate>("totp/generate");
                    if (!result.success) {
                        toast.showError(result.message);
                        return;
                    }

                    await dialog.prompt({
                        title: t("multi_factor_authentication.totp_secret_generated"),
                        message: t("multi_factor_authentication.totp_secret_warning"),
                        defaultValue: result.message,
                        readOnly: true
                    });
                    refreshTotpStatus();
                    await generateRecoveryKeys();
                }}
            />
        </OptionsSection>

        <TotpRecoveryKeys values={recoveryKeys} generateRecoveryKeys={generateRecoveryKeys} />
    </>)
}

function TotpRecoveryKeys({ values, generateRecoveryKeys }: { values?: string[], generateRecoveryKeys: () => Promise<void> }) {
    return (
        <OptionsSection title={t("multi_factor_authentication.recovery_keys_title")}>
            <FormText>{t("multi_factor_authentication.recovery_keys_description")}</FormText>

            {values ? (
                <>
                    <Admonition type="caution">
                        <Trans i18nKey={t("multi_factor_authentication.recovery_keys_description_warning")} />
                    </Admonition>

                    <ol style={{ columnCount: 2 }}>
                        {values.map(key => {
                            let text = "";

                            if (typeof key === 'string') {
                                const date = new Date(key.replace(/\//g, '-'));
                                if (isNaN(date.getTime())) {
                                    return <li><code>{key}</code></li>
                                } else {
                                    text = t("multi_factor_authentication.recovery_keys_used", { date: key.replace(/\//g, '-') });
                                }
                            } else {
                                text = t("multi_factor_authentication.recovery_keys_unused", { index: key });
                            }

                            return <li>{text}</li>
                        })}
                    </ol>
                </>
            ) : (
                <p>{t("multi_factor_authentication.recovery_keys_no_key_set")}</p>
            )}

            <Button
                text={!values
                    ? t("multi_factor_authentication.recovery_keys_generate")
                    : t("multi_factor_authentication.recovery_keys_regenerate")
                }
                onClick={generateRecoveryKeys}
            />
        </OptionsSection>
    );
}

function OAuthSettings() {
    const [ status, setStatus ] = useState<OAuthStatus>();

    useEffect(() => {
        server.get<OAuthStatus>("oauth/status").then(setStatus);
    }, []);

    return (
        <OptionsSection title={t("multi_factor_authentication.oauth_title")}>
            { status?.enabled ? (
                <div class="col-md-6">
                    <span><b>{t("multi_factor_authentication.oauth_user_account")}</b></span>
                    <span class="user-account-name">{status.name ?? t("multi_factor_authentication.oauth_user_not_logged_in")}</span>

                    <br />
                    <span><b>{t("multi_factor_authentication.oauth_user_email")}</b></span>
                    <span class="user-account-email">{status.email ?? t("multi_factor_authentication.oauth_user_not_logged_in")}</span>
                </div>
            ) : (
                <>
                    <p>{t("multi_factor_authentication.oauth_description_warning")}</p>

                    { status?.missingVars && (
                        <Admonition type="caution">
                            {t("multi_factor_authentication.oauth_missing_vars", {
                                variables: status.missingVars.map(v => `"${v}"`).join(", ")
                            })}
                        </Admonition>
                    )}
                </>
            )}
        </OptionsSection>
    )
}
