import "./setup_unlock.css";

import logo from "./assets/icon-color.svg?url";
import { t } from "./services/i18n";
import { setSetupAuthToken } from "./services/setup_auth";
import CredentialsForm, { type Credentials } from "./widgets/react/CredentialsForm";

/**
 * The credentials of the knowledge base the wizard is standing over.
 *
 * Ordinarily setup is the one part of Trilium nobody has to log into, and rightly so: it runs where
 * there is no database and therefore nobody to be. An instance the app sent back here is the other
 * case, and on a server it is served to whoever can reach the port, with a whole knowledge base one
 * button away from being replaced. So this comes first, before the wizard will say or do anything.
 *
 * It is the login screen over again, down to the wording and the second factor, because the user is
 * being asked the one question they already know the answer to. Saying anything more about why would
 * only invite them to read it as a different question.
 *
 * Asked for only where it can be answered and where it is worth asking: a first run has no password
 * to check against, and the desktop's own window is not reachable by anyone the desktop is not.
 *
 * @param onUnlocked the wizard may carry on.
 *
 * @module
 */
export default function SetupUnlock({ onUnlocked }: { onUnlocked: () => void }) {
    async function submit({ password, totpToken }: Credentials) {
        try {
            // `fetch` rather than `server.post`, as on the login screen: the status carries the
            // answer here, and `server.post` drops it — it reports a non-2xx through a toast and
            // rejects with the response text alone.
            const resp = await fetch(`${window.glob.baseApiUrl}setup/auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password, totpToken })
            });

            if (resp.status === 429) {
                // The limiter counting the attempts, not a wrong answer.
                return t("login.too-many-attempts");
            }

            if (!resp.ok) {
                // Which of the two was wrong is not said, because the server does not say: both are
                // asked for together and a failure in either is one refusal.
                return t("setup.unlock-refused");
            }

            // The body is read as well as the status: standalone's `apiResultHandler` drops the
            // status out of a `[status, body]` tuple, so a refusal reaches this build as a 200.
            const answer = await resp.json() as { authenticated?: boolean; token?: string };
            if (!answer.authenticated || !answer.token) {
                return t("setup.unlock-refused");
            }

            setSetupAuthToken(answer.token);
            onUnlocked();

            return null;
        } catch {
            // `fetch` rejects only on a network-level failure, never on an HTTP status.
            return t("login.connection-error");
        }
    }

    return (
        <CredentialsForm
            className="setup-unlock"
            formClassName="setup-unlock-form"
            title={t("login.heading")}
            illustration={<img src={logo} alt="" className="illustration-logo" />}
            totpEnabled={window.glob.setupSecondFactorRequired === true}
            submitLabel={t("login.button")}
            onSubmit={submit}
        />
    );
}
