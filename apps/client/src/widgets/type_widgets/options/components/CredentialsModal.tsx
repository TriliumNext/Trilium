import { createPortal } from "preact";
import { useCallback, useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import type { Credentials } from "../../../../services/server";
import Button from "../../../react/Button";
import FormGroup from "../../../react/FormGroup";
import FormTextBox from "../../../react/FormTextBox";
import Modal from "../../../react/Modal";

export interface CredentialsRequest {
    title: string;
    /** Whether the server asks for a code of the second factor as well. */
    isCodeAsked: boolean;
}

/**
 * Asks for the password and, where the server asks for one, a code of the second factor, before a
 * change that the server guards with them.
 *
 * @returns a function that opens the dialog and resolves with the answer, or `null` when it is
 *          closed, and the dialog to render.
 */
export function useCredentialsPrompt(): [
    (request: CredentialsRequest) => Promise<Credentials | null>,
    preact.ComponentChildren
] {
    const [ pending, setPending ] =
        useState<CredentialsRequest & { resolve: (answer: Credentials | null) => void }>();

    const prompt = useCallback((request: CredentialsRequest) =>
        new Promise<Credentials | null>((resolve) => {
            setPending({ ...request, resolve });
        }), []);

    const finish = (answer: Credentials | null) => {
        pending?.resolve(answer);
        setPending(undefined);
    };

    return [
        prompt,
        createPortal(<CredentialsModal request={pending} onDone={finish} />, document.body)
    ];
}

function CredentialsModal({ request, onDone }: {
    request?: CredentialsRequest;
    onDone: (answer: Credentials | null) => void;
}) {
    const [ password, setPassword ] = useState("");
    const [ code, setCode ] = useState("");

    const close = (answer: Credentials | null) => {
        setPassword("");
        setCode("");
        onDone(answer);
    };

    return (
        <Modal
            show={!!request}
            title={request?.title}
            className="credentials-modal"
            size="md"
            stackable
            onSubmit={() => close({ password, code })}
            onHidden={() => close(null)}
            footer={<>
                <Button text={t("credentials.cancel")} onClick={() => close(null)} />
                <Button text={t("credentials.confirm")} kind="primary" />
            </>}
        >
            <FormGroup name="credentials-password" label={t("credentials.password")}>
                <FormTextBox
                    type="password"
                    autocomplete="current-password"
                    currentValue={password}
                    onChange={setPassword}
                />
            </FormGroup>

            {request?.isCodeAsked && (
                <FormGroup
                    name="credentials-code"
                    label={t("credentials.code")}
                    description={t("credentials.code_description")}
                >
                    <FormTextBox
                        autocomplete="one-time-code"
                        currentValue={code}
                        onChange={setCode}
                    />
                </FormGroup>
            )}
        </Modal>
    );
}
