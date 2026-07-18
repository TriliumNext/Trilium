import "./totp.css";

import { TOTPEnableResponse, TOTPGenerate, TOTPRecoveryKeysResponse, TOTPStatus, TOTPVerifyResponse } from "@triliumnext/commons";
import { ComponentChildren, RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import qrcode from "qrcode-generator";
import { Trans } from "react-i18next";

import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import Admonition from "../../react/Admonition";
import Button from "../../react/Button";
import FormCheckbox from "../../react/FormCheckbox";
import FormGroup from "../../react/FormGroup";
import FormText from "../../react/FormText";
import FormTextBox from "../../react/FormTextBox";
import { useStaticTooltip } from "../../react/hooks";
import Modal from "../../react/Modal";
import { RawHtmlBlock } from "../../react/RawHtml";
import MfaStatusBadge from "./components/MfaStatusBadge";
import { OptionsRowWithButton } from "./components/OptionsRow";
import OptionsSection from "./components/OptionsSection";

/**
 * TOTP (authenticator-app) two-factor settings. Owns the recovery-codes state and the enrollment /
 * regenerate dialogs; the TOTP secret status itself is owned by the parent (which also needs it to
 * decide whether to show the method selector) and passed in.
 */
export function TotpSettings({ totpStatus, refreshTotpStatus }: {
    totpStatus?: TOTPStatus,
    refreshTotpStatus: () => void
}) {
    // The per-code used/unused status loaded from the server (one entry per code). `undefined` means
    // no recovery codes have been set up yet.
    const [ recoveryStatus, setRecoveryStatus ] = useState<string[]>();
    // Whether the verify-before-enable enrollment modal is open.
    const [ showEnroll, setShowEnroll ] = useState(false);
    // Freshly regenerated recovery codes, shown once so the user can save them (dismissed with "Done").
    const [ regeneratedCodes, setRegeneratedCodes ] = useState<string[]>();

    const refreshRecoveryKeys = useCallback(async () => {
        const result = await server.get<TOTPRecoveryKeysResponse>("totp_recovery/enabled");

        if (!result.success) {
            toast.showError(t("multi_factor_authentication.recovery_keys_error"));
            return;
        }

        if (!result.keysExist) {
            setRecoveryStatus(undefined);
            return;
        }

        const usedResult = await server.get<TOTPRecoveryKeysResponse>("totp_recovery/used");
        setRecoveryStatus(usedResult.usedRecoveryCodes);
    }, []);

    // Runs once enrollment is committed (the modal's Finish step persisted the secret and the recovery
    // codes it already showed), so we only refresh state here — generating again would invalidate the
    // codes the user just saved.
    const onEnrollmentComplete = useCallback(() => {
        toast.showMessage(t("multi_factor_authentication.totp_enroll_enabled"));
        refreshTotpStatus();
        void refreshRecoveryKeys();
    }, [ refreshTotpStatus, refreshRecoveryKeys ]);

    const removeTotp = useCallback(async () => {
        if (!await dialog.confirm(t("multi_factor_authentication.totp_remove_confirm"))) {
            return;
        }

        await server.post("totp/reset");
        toast.showMessage(t("multi_factor_authentication.totp_removed"));
        // The secret and recovery codes are gone server-side; refresh so the section drops back to
        // its "not set up" state (method selector shown) right away.
        refreshTotpStatus();
        refreshRecoveryKeys();
    }, [ refreshTotpStatus, refreshRecoveryKeys ]);

    // Issues a fresh batch of recovery codes for the (already enrolled) secret, replacing the old
    // ones. The server refuses if no secret is set, so this can't mint codes for an inactive TOTP.
    const regenerateRecoveryCodes = useCallback(async () => {
        if (!await dialog.confirm(t("multi_factor_authentication.recovery_keys_regenerate_confirm"))) {
            return;
        }

        const result = await server.post<TOTPRecoveryKeysResponse>("totp_recovery/regenerate");
        if (!result.success || !result.recoveryCodes) {
            toast.showError(t("multi_factor_authentication.recovery_keys_error"));
            return;
        }

        setRegeneratedCodes(result.recoveryCodes);
        refreshRecoveryKeys();
    }, [ refreshRecoveryKeys ]);

    useEffect(() => {
        // The TOTP secret status is fetched by the parent; here we only load the recovery codes.
        refreshRecoveryKeys();
    }, [ refreshRecoveryKeys ]);

    // Status badge mirroring the OpenID card: TOTP is either enabled (a secret is set) or off.
    const totpEnabled = totpStatus?.set ?? false;
    const totpTitle = (
        <span className="mfa-status-title">
            {t("multi_factor_authentication.totp_section_title")}
            <MfaStatusBadge
                tone={totpEnabled ? "active" : "inactive"}
                text={totpEnabled
                    ? t("multi_factor_authentication.totp_status_active")
                    : t("multi_factor_authentication.totp_status_inactive")}
            />
        </span>
    );

    return (<>
        {/* Before enrollment, a single call-to-action opens the dialog — which is where the secret is
            generated, verified, and (only on Finish) persisted. Once a secret is set, that's replaced
            by the recovery-codes panel; recovery codes are part of TOTP and never exist without it. */}
        {totpStatus?.set
            ? <TotpRecoveryKeys
                title={totpTitle}
                status={recoveryStatus}
                onRegenerate={regenerateRecoveryCodes}
                onRemoveTotp={removeTotp}
            />
            : <OptionsSection title={totpTitle}>
                <OptionsRowWithButton
                    label={t("multi_factor_authentication.totp_setup_label")}
                    description={t("multi_factor_authentication.totp_setup_description")}
                    icon="bx-plus"
                    buttonText={t("multi_factor_authentication.totp_setup_button")}
                    onClick={() => setShowEnroll(true)}
                />
            </OptionsSection>}

        {createPortal(
            <TotpEnrollmentModal
                show={showEnroll}
                onHidden={() => setShowEnroll(false)}
                onComplete={onEnrollmentComplete}
            />,
            document.body
        )}

        {createPortal(
            <RecoveryCodesModal codes={regeneratedCodes} onHidden={() => setRegeneratedCodes(undefined)} />,
            document.body
        )}
    </>);
}

/**
 * Verify-before-enable enrollment dialog with two steps, and crucially nothing is persisted until the
 * user finishes — so dismissing at any point leaves TOTP exactly as it was:
 *
 *  1. Fetch a fresh secret, show it for the user to add to their authenticator, and require a valid
 *     code (`totp/verify`). This proves possession but commits nothing.
 *  2. Show the recovery codes `totp/verify` issued so the user can save the fallback they'll need if
 *     they lose their authenticator. Finishing (`totp/enable`) is the single point that persists the
 *     secret + codes and actually enables TOTP.
 */
function TotpEnrollmentModal({ show, onHidden, onComplete }: {
    show: boolean,
    onHidden: () => void,
    /** Called when TOTP has been committed (enabled), so the surrounding section can refresh. */
    onComplete: () => void
}) {
    const [ secret, setSecret ] = useState<string>();
    // The `otpauth://` URL for the secret, rendered as a scannable QR code alongside the manual secret.
    const [ secretUrl, setSecretUrl ] = useState<string>();
    const [ loadFailed, setLoadFailed ] = useState(false);
    const [ code, setCode ] = useState("");
    const [ codeRejected, setCodeRejected ] = useState(false);
    const [ verifying, setVerifying ] = useState(false);
    // Set once verification succeeds: switches the dialog to the "save your recovery codes" step.
    // Nothing is persisted server-side at this point — the secret and these codes are only committed
    // when the user finishes (see `enable`), so dismissing here leaves TOTP exactly as it was.
    const [ recoveryCodes, setRecoveryCodes ] = useState<string[]>();
    const [ acknowledged, setAcknowledged ] = useState(false);
    const [ enabling, setEnabling ] = useState(false);
    const codeRef = useRef<HTMLInputElement>(null);

    // Each time the modal opens, reset state and request a fresh secret.
    useEffect(() => {
        if (!show) {
            return;
        }

        setSecret(undefined);
        setSecretUrl(undefined);
        setLoadFailed(false);
        setCode("");
        setCodeRejected(false);
        setVerifying(false);
        setRecoveryCodes(undefined);
        setAcknowledged(false);
        setEnabling(false);

        void server.get<TOTPGenerate>("totp/generate").then((result) => {
            if (result.success) {
                setSecret(result.message);
                setSecretUrl(result.url);
            } else {
                setLoadFailed(true);
            }
        });
    }, [ show ]);

    // Focus the code field once the secret has loaded (verify step only).
    useEffect(() => {
        if (secret && !recoveryCodes) {
            codeRef.current?.focus();
        }
    }, [ secret, recoveryCodes ]);

    // Step 1: check the code against the secret. Persists nothing — on success we only advance to the
    // recovery-codes step with the codes the server issued.
    const verify = useCallback(async () => {
        if (!secret || code.length === 0 || verifying) {
            return;
        }

        setVerifying(true);
        setCodeRejected(false);

        try {
            const result = await server.post<TOTPVerifyResponse>("totp/verify", { secret, token: code });

            if (!result.success) {
                setCodeRejected(true);
                setCode("");
                codeRef.current?.focus();
                return;
            }

            setRecoveryCodes(result.recoveryCodes ?? []);
        } finally {
            // server.ts already surfaces a request failure via a toast; the finally just guarantees the
            // Verify button is never left stuck disabled if the request throws.
            setVerifying(false);
        }
    }, [ secret, code, verifying ]);

    // Step 2 (Finish): the single commit point — persist the secret and recovery codes, enabling TOTP.
    const enable = useCallback(async () => {
        if (!secret || !recoveryCodes || !acknowledged || enabling) {
            return;
        }

        setEnabling(true);

        try {
            const result = await server.post<TOTPEnableResponse>("totp/enable", { secret, recoveryCodes });

            if (!result.success) {
                toast.showError(t("multi_factor_authentication.totp_enroll_enable_error"));
                return;
            }

            onComplete();
            onHidden();
        } finally {
            // Guarantee the Finish button is re-enabled even if the request throws (server.ts toasts
            // the failure itself).
            setEnabling(false);
        }
    }, [ secret, recoveryCodes, acknowledged, enabling, onComplete, onHidden ]);

    const inRecoveryStep = !!recoveryCodes;

    return (
        <Modal
            className="totp-enrollment-modal"
            title={inRecoveryStep
                ? t("multi_factor_authentication.totp_enroll_recovery_title")
                : t("multi_factor_authentication.totp_enroll_title")}
            size="md"
            show={show}
            // Dismissing simply closes; nothing was persisted unless the user finished (see `enable`).
            onHidden={onHidden}
            onSubmit={() => {
                if (inRecoveryStep) {
                    void enable();
                } else {
                    void verify();
                }
            }}
            stackable
            footer={inRecoveryStep
                ? <Button
                    text={t("multi_factor_authentication.totp_enroll_finish")}
                    kind="primary"
                    disabled={!acknowledged || enabling}
                    onClick={() => void enable()}
                />
                : <>
                    <Button text={t("multi_factor_authentication.totp_enroll_cancel")} onClick={onHidden} />
                    <Button
                        text={t("multi_factor_authentication.totp_enroll_verify")}
                        kind="primary"
                        disabled={!secret || code.length === 0 || verifying}
                    />
                </>}
        >
            {inRecoveryStep
                ? <TotpRecoveryStep codes={recoveryCodes} acknowledged={acknowledged} setAcknowledged={setAcknowledged} />
                : loadFailed
                    ? <Admonition type="caution">{t("multi_factor_authentication.totp_enroll_generate_error")}</Admonition>
                    : <TotpVerifyStep secret={secret} secretUrl={secretUrl} code={code} setCode={setCode} codeRejected={codeRejected} codeRef={codeRef} />}
        </Modal>
    );
}

/** Step 1: show the generated secret and collect a verification code from the user's authenticator. */
function TotpVerifyStep({ secret, secretUrl, code, setCode, codeRejected, codeRef }: {
    secret?: string,
    secretUrl?: string,
    code: string,
    setCode: (value: string) => void,
    codeRejected: boolean,
    codeRef: RefObject<HTMLInputElement>
}) {
    return (
        <>
            <FormText>{t("multi_factor_authentication.totp_enroll_instructions")}</FormText>

            <h5 className="totp-enroll-step-title">{t("multi_factor_authentication.totp_enroll_step1_title")}</h5>
            <div className="totp-enroll-grid">
                {secretUrl && <TotpQrCode url={secretUrl} />}

                <FormGroup
                    className="totp-enroll-secret-group"
                    name="totp-enroll-secret"
                    label={t("multi_factor_authentication.totp_enroll_secret_label")}
                >
                    <FormTextBox
                        className="totp-enroll-secret"
                        currentValue={secret ?? ""}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                    />
                </FormGroup>
            </div>

            <h5 className="totp-enroll-step-title">{t("multi_factor_authentication.totp_enroll_step2_title")}</h5>
            <FormGroup
                name="totp-enroll-code"
                label={t("multi_factor_authentication.totp_enroll_code_label")}
                error={codeRejected ? t("multi_factor_authentication.totp_enroll_invalid_code") : undefined}
            >
                <FormTextBox
                    inputRef={codeRef}
                    currentValue={code}
                    onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={t("multi_factor_authentication.totp_enroll_code_placeholder")}
                    maxLength={6}
                />
            </FormGroup>
        </>
    );
}

/**
 * Renders an `otpauth://` URL as an inline SVG QR code for scanning into an authenticator app. The URL
 * is generated from our own secret (not user input), so the SVG is trusted and rendered via RawHtml.
 */
function TotpQrCode({ url }: { url: string }) {
    const svg = useMemo(() => {
        // typeNumber 0 lets the library pick the smallest version that fits; "M" error correction is
        // the authenticator-app standard. cellSize/margin set the viewBox units — actual display size
        // is controlled by CSS via the `scalable` (viewBox-only) output.
        const qr = qrcode(0, "M");
        qr.addData(url);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }, [ url ]);

    return (
        <div className="totp-enroll-qr">
            <FormText>{t("multi_factor_authentication.totp_enroll_scan")}</FormText>
            <RawHtmlBlock className="totp-enroll-qr-code" html={svg} />
        </div>
    );
}

/** Step 2: present the issued recovery codes with copy/download and require the user to acknowledge saving them. */
function TotpRecoveryStep({ codes, acknowledged, setAcknowledged }: {
    codes: string[],
    acknowledged: boolean,
    setAcknowledged: (value: boolean) => void
}) {
    return (
        <>
            <FormText>{t("multi_factor_authentication.totp_enroll_recovery_instructions")}</FormText>

            <RecoveryCodesList codes={codes} />

            <FormCheckbox
                name="totp-recovery-saved"
                label={t("multi_factor_authentication.totp_enroll_saved_ack")}
                currentValue={acknowledged}
                onChange={setAcknowledged}
            />
        </>
    );
}

/** The recovery codes themselves, with copy/download actions and the keep-them-safe caution. Shared
 *  by enrollment (step 2) and the standalone regenerate flow. */
function RecoveryCodesList({ codes }: { codes: string[] }) {
    return (
        <>
            <ol className="totp-recovery-codes">
                {codes.map((recoveryCode) => <li key={recoveryCode}><code>{recoveryCode}</code></li>)}
            </ol>

            <div className="totp-recovery-actions">
                <Button
                    icon="bx-copy"
                    text={t("multi_factor_authentication.totp_enroll_recovery_copy")}
                    onClick={() => {
                        utils.copyHtmlToClipboard(codes.join("\n"));
                        toast.showMessage(t("multi_factor_authentication.totp_enroll_recovery_copied"));
                    }}
                />
                <Button
                    icon="bx-download"
                    text={t("multi_factor_authentication.totp_enroll_recovery_download")}
                    onClick={() => downloadRecoveryCodes(codes)}
                />
            </div>

            <Admonition type="caution">
                <Trans i18nKey="multi_factor_authentication.recovery_keys_description_warning" />
            </Admonition>
        </>
    );
}

/**
 * Shows a freshly issued batch of recovery codes once, in a modal — the same presentation used by the
 * enrollment dialog's final step — so regenerating codes feels identical to setting them up. Open
 * when `codes` is set; dismissing clears them on the caller's side.
 */
function RecoveryCodesModal({ codes, onHidden }: {
    codes?: string[],
    onHidden: () => void
}) {
    return (
        <Modal
            className="totp-recovery-modal"
            title={t("multi_factor_authentication.recovery_keys_regenerated_title")}
            size="md"
            show={!!codes}
            onHidden={onHidden}
            stackable
            footer={<Button text={t("multi_factor_authentication.recovery_keys_done")} kind="primary" onClick={onHidden} />}
        >
            {codes && <>
                <FormText>{t("multi_factor_authentication.recovery_keys_regenerated_instructions")}</FormText>
                <RecoveryCodesList codes={codes} />
            </>}
        </Modal>
    );
}

/**
 * Downloads the recovery codes as a plain-text file. Uses a `data:` URL rather than a `blob:` one
 * because the app's global anchor-click handler (services/link.ts `goToLinkExt`) calls
 * `preventDefault()` on any `<a>` click whose href isn't a `data:` URL — which would silently cancel
 * a blob download. A `data:` URL is explicitly let through there, and it works over HTTP too.
 */
function downloadRecoveryCodes(codes: string[]) {
    const content = `${codes.join("\n")}\n`;
    const link = document.createElement("a");
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
    link.download = "trilium-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/**
 * Recovery-codes management for an enrolled TOTP: a read-only status (how many remain), a confirmed
 * regenerate action (which replaces the codes for the existing secret), and the destructive
 * remove-TOTP action. The codes themselves are only ever shown once — in a modal right after
 * enrollment or regeneration (see {@link RecoveryCodesModal}).
 */
function TotpRecoveryKeys({ title, status, onRegenerate, onRemoveTotp }: {
    title: ComponentChildren,
    status?: string[],
    onRegenerate: () => void,
    onRemoveTotp: () => void
}) {
    const remaining = status?.filter(isUnusedRecoveryCode).length ?? 0;

    return (
        <OptionsSection title={title}>
            <OptionsRowWithButton
                label={
                    <span className="recovery-codes-title">
                        {t("multi_factor_authentication.recovery_keys_label")}
                        {status && status.length > 0 && <RecoveryCodeDots status={status} />}
                    </span>
                }
                description={status && status.length > 0
                    ? t("multi_factor_authentication.recovery_keys_remaining", { remaining, total: status.length })
                    : t("multi_factor_authentication.recovery_keys_no_key_set")}
                icon="bx-refresh"
                buttonText={t("multi_factor_authentication.recovery_keys_regenerate")}
                onClick={onRegenerate}
            />

            <OptionsRowWithButton
                label={t("multi_factor_authentication.totp_remove_label")}
                description={t("multi_factor_authentication.totp_remove_description")}
                icon="bx-trash"
                buttonClassName="totp-remove-button"
                buttonText={t("multi_factor_authentication.totp_remove_button")}
                onClick={onRemoveTotp}
            />
        </OptionsSection>
    );
}

/**
 * A row of dots, one per recovery code in order, showing at a glance which codes are still available
 * (filled) and which have been spent (hollow). Each dot carries a Bootstrap tooltip with its status,
 * delegated from the container via a `selector` so a single tooltip instance covers every dot and
 * reads each dot's own `title` on hover.
 */
function RecoveryCodeDots({ status }: { status: string[] }) {
    const dotsRef = useRef<HTMLDivElement>(null);
    useStaticTooltip(dotsRef, {
        selector: ".recovery-code-dot",
        animation: false,
        title() { return this.getAttribute("title") ?? ""; }
    });

    return (
        <div className="recovery-code-dots" ref={dotsRef}>
            {status.map((entry, index) => {
                const unused = isUnusedRecoveryCode(entry);
                return (
                    <span
                        key={index}
                        className={`recovery-code-dot ${unused ? "available" : "used"}`}
                        title={unused
                            ? t("multi_factor_authentication.recovery_keys_dot_available")
                            : t("multi_factor_authentication.recovery_keys_dot_used", { date: formatRecoveryCodeUsedDate(entry) })}
                    />
                );
            })}
        </div>
    );
}

/**
 * Whether a recovery-code status entry represents an unused (still usable) code. The server returns
 * a used code as an ISO timestamp of when it was consumed, and an unused one as its plain numeric
 * index, so a purely numeric entry is one that's still available.
 */
export function isUnusedRecoveryCode(statusEntry: string) {
    return /^\d+$/.test(statusEntry);
}

/** Formats a used-code timestamp (stored with `/` date separators) into a readable local date. */
export function formatRecoveryCodeUsedDate(statusEntry: string) {
    const date = new Date(statusEntry.replace(/\//g, "-"));
    return isNaN(date.getTime()) ? statusEntry : date.toLocaleString();
}
