import "./protect_subtree.css";

import { useRef, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import protectedSession from "../../services/protected_session";
import protectedSessionHolder from "../../services/protected_session_holder";
import Button from "../react/Button";
import { Card, CardSection, OptionCardSection } from "../react/Card";
import FormTextBox from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import Modal from "../react/Modal";

interface Request {
    noteId: string;
    protect: boolean;
    needsPassword: boolean;
    /** Unset when the note's title is encrypted and no protected session can read it. */
    title?: string;
    icon?: string;
}

/**
 * Protects or unprotects a subtree, saying what that does to the notes. Without a protected session
 * it also asks for the password, in place of the generic "Start protected session" prompt.
 */
export default function ProtectSubtreeDialog() {
    const [ shown, setShown ] = useState(false);
    const [ request, setRequest ] = useState<Request>();
    const [ password, setPassword ] = useState("");
    const [ busy, setBusy ] = useState(false);
    const passwordRef = useRef<HTMLInputElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const submitRef = useRef<HTMLButtonElement>(null);

    useTriliumEvent("showProtectSubtreeDialog", ({ noteId, protect }) => {
        const note = froca.getNoteFromCache(noteId);
        setRequest({
            noteId,
            protect,
            needsPassword: !protectedSessionHolder.isProtectedSessionAvailable(),
            title: note?.isContentAvailable() ? note.title : undefined,
            icon: note?.getIcon()
        });
        setPassword("");
        setBusy(false);
        setShown(true);
    });

    async function onSubmit() {
        if (!request || busy) return;

        setBusy(true);
        try {
            if (request.needsPassword && !await protectedSession.setupProtectedSession(password)) {
                passwordRef.current?.select();
                return;
            }

            setShown(false);
            await protectedSession.protectNote(request.noteId, request.protect, true);
        } finally {
            setBusy(false);
        }
    }

    function focusInitialControl() {
        if (request?.needsPassword) {
            passwordRef.current?.focus();
        } else {
            // Enter on an unprotect confirmation cancels rather than decrypts.
            (request?.protect ? submitRef : cancelRef).current?.focus();
        }
    }

    const actionLabel = request?.protect
        ? t("tree-context-menu.protect-subtree")
        : t("tree-context-menu.unprotect-subtree");

    return (
        <Modal
            className="protect-subtree-dialog"
            title={actionLabel}
            size="md"
            helpPageId="bwg0e8ewQMak"
            footer={<>
                <Button buttonRef={cancelRef} text={t("common.cancel")} onClick={() => setShown(false)} />
                <Button
                    buttonRef={submitRef}
                    kind="primary"
                    icon={request?.protect ? "bx-check-shield" : "bx-shield"}
                    text={actionLabel}
                    disabled={busy}
                />
            </>}
            onSubmit={onSubmit}
            onShown={focusInitialControl}
            onHidden={() => setShown(false)}
            show={shown}
        >
            {request && <>
                <p>{request.protect ? t("protect_subtree.protect_intro") : t("protect_subtree.unprotect_intro")}</p>

                <Card>
                    <CardSection className="tn-card-option protect-subtree-target">
                        <Icon icon={request.icon} className="protect-subtree-icon" />
                        <div className="tn-card-option-label">
                            <span className="tn-card-option-title">{request.title ?? t("protect_subtree.untitled")}</span>
                            <small className="tn-card-option-description">{t("protect_subtree.subtree")}</small>
                        </div>
                    </CardSection>

                    {request.needsPassword && (
                        <OptionCardSection
                            label={t("protect_subtree.password")}
                            description={t("protect_subtree.password_description")}
                            name="protect-subtree-password"
                            stacked
                        >
                            <FormTextBox
                                inputRef={passwordRef}
                                name="protect-subtree-password"
                                type="password"
                                autoComplete="current-password"
                                currentValue={password}
                                onChange={setPassword}
                            />
                        </OptionCardSection>
                    )}
                </Card>
            </>}
        </Modal>
    );
}
