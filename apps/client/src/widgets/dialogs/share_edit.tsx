import "./share_edit.css";

import { useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import server from "../../services/server";
import toast from "../../services/toast";
import Alert from "../react/Alert";
import Button from "../react/Button";
import FormPasswordWithConfirmation from "../react/FormPasswordWithConfirmation";
import FormRadioGroup from "../react/FormRadioGroup";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";

type EditAccess = "password" | "open";

/** The password or the openness guests of the note's shared page edit it with. */
export interface ShareEditSettings {
    enabled: true;
    password?: string;
    open?: true;
}

/**
 * Lets the host open a shared note's subtree to editing by its visitors, with a password or to
 * anyone who has the link. The Shared badge's menu opens it.
 */
export default function ShareEditDialog() {
    const [ shown, setShown ] = useState(false);
    const [ note, setNote ] = useState<FNote>();
    const [ access, setAccess ] = useState<EditAccess>("password");
    const [ password, setPassword ] = useState<string | null>(null);
    const passwordRef = useRef<HTMLInputElement>(null);

    useTriliumEvent("showShareEditDialog", ({ note: editedNote }) => {
        setNote(editedNote);
        setAccess("password");
        setPassword(null);
        setShown(true);
    });

    const settings = buildShareEditSettings(access, password);

    async function onSubmit() {
        if (!note || !settings) {
            return;
        }

        await server.put(`notes/${note.noteId}/share-edit`, settings);
        toast.showMessage(t("share_edit.saved"));
        setShown(false);
    }

    return (
        <Modal
            className="share-edit-dialog"
            title={t("share_edit.title")}
            size="md"
            onShown={() => passwordRef.current?.focus()}
            onHidden={() => setShown(false)}
            onSubmit={onSubmit}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button text={t("share_edit.save")} kind="primary" disabled={!settings} />
            </>}
            show={shown}
        >
            <p>{t("share_edit.description")}</p>
            <FormRadioGroup
                name="share-edit-access"
                currentValue={access}
                onChange={(value) => setAccess(value as EditAccess)}
                values={[
                    { value: "password", label: t("share_edit.with_password") },
                    { value: "open", label: t("share_edit.open") }
                ]}
            />
            {access === "password"
                ? <div className="share-edit-password">
                    <FormPasswordWithConfirmation inputRef={passwordRef} onChange={setPassword} />
                    <p className="form-text">{t("share_edit.password_hint")}</p>
                </div>
                : <Alert type="warning">{t("share_edit.open_warning")}</Alert>}
        </Modal>
    );
}

/** What the dialog saves, or `null` while the choice is not complete. Exported for testing. */
export function buildShareEditSettings(access: EditAccess, password: string | null): ShareEditSettings | null {
    if (access === "open") {
        return { enabled: true, open: true };
    }

    return password && password.length >= 4 ? { enabled: true, password } : null;
}
