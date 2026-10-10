import "./options.css";

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

type Message = { kind: "error" | "success", text: string } | null;
type ShowMessage = (message: Message) => void;

const root = document.getElementById("root");
if (root) {
    render(<Options />, root);
}

export function Options() {
    const [ message, setMessage ] = useState<Message>(null);

    return (
        <div className="options">
            {message && <div className={`message message-${message.kind}`}>{message.text}</div>}

            <h2>Trilium desktop instance</h2>

            <p>
                Web clipper by default tries to find a running desktop instance on port 37840. If you
                configured your Trilium desktop app to run on a different port (for example with
                the <code>TRILIUM_PORT</code> environment variable), you can specify it here
                (otherwise keep it empty).
            </p>

            <DesktopPortForm showMessage={setMessage} />

            <h2>Trilium server instance</h2>

            <p>
                If you have a server instance set up, you can optionally configure it as a fail over
                target for the clipped notes. Desktop instance will still be given priority, but in
                cases that the desktop instance is not available (e.g. it's not running), web clipper
                will send the notes to the server instance instead.
            </p>

            <ServerSetup showMessage={setMessage} />
        </div>
    );
}

function DesktopPortForm({ showMessage }: { showMessage: ShowMessage }) {
    const [ port, setPort ] = useState("");

    useEffect(() => {
        void browser.storage.sync.get<{ triliumDesktopPort?: string }>("triliumDesktopPort")
            .then(({ triliumDesktopPort }) => setPort(triliumDesktopPort ?? ""));
    }, []);

    async function save(e: Event) {
        e.preventDefault();

        const trimmedPort = port.trim();
        const portNum = parseInt(trimmedPort, 10);
        if (trimmedPort && (isNaN(portNum) || portNum <= 0 || portNum >= 65536)) {
            showMessage({ kind: "error", text: "Please enter valid port number." });
            return;
        }

        await browser.storage.sync.set({ triliumDesktopPort: trimmedPort });
        showMessage({ kind: "success", text: "Port number has been saved." });
    }

    return (
        <form onSubmit={save}>
            <p>
                <label for="trilium-desktop-port">Trilium desktop port: </label>
                <input
                    type="text"
                    id="trilium-desktop-port"
                    className="desktop-port"
                    size={6}
                    value={port}
                    onInput={(e) => setPort(e.currentTarget.value)}
                />
                {" "}(normally keep this empty)
            </p>

            <input type="submit" value="Save" />
        </form>
    );
}

function ServerSetup({ showMessage }: { showMessage: ShowMessage }) {
    /** The configured server's URL, `null` when none is, and `undefined` until storage is read. */
    const [ configuredUrl, setConfiguredUrl ] = useState<string | null>();

    useEffect(() => {
        void browser.storage.sync.get<{ triliumServerUrl?: string, authToken?: string }>([ "triliumServerUrl", "authToken" ])
            .then(({ triliumServerUrl, authToken }) => {
                setConfiguredUrl(triliumServerUrl && authToken ? triliumServerUrl : null);
            });
    }, []);

    async function reset(e: Event) {
        e.preventDefault();
        await browser.storage.sync.set({ triliumServerUrl: "", authToken: "" });
        setConfiguredUrl(null);
        showMessage(null);
    }

    if (configuredUrl === undefined) return null;

    if (configuredUrl) {
        return (
            <div>
                <strong>
                    Trilium server instance has been already configured to <a href={configuredUrl}>{configuredUrl}</a>.
                </strong>

                <p>You can also <a href="#" onClick={reset}>remove the current setup</a> and configure it again.</p>
            </div>
        );
    }

    return <ServerLoginForm showMessage={showMessage} onLoggedIn={setConfiguredUrl} />;
}

function ServerLoginForm({ showMessage, onLoggedIn }: {
    showMessage: ShowMessage;
    onLoggedIn: (serverUrl: string) => void;
}) {
    const [ url, setUrl ] = useState("");
    const [ password, setPassword ] = useState("");
    const [ totp, setTotp ] = useState("");
    const totpRef = useRef<HTMLInputElement>(null);

    async function login(e: Event) {
        e.preventDefault();

        if (!url.trim() || !password.trim()) {
            showMessage({ kind: "error", text: "One or more mandatory inputs are missing. Please fill in server URL and password." });
            return;
        }

        const serverUrl = url.trim().replace(/\/+$/, "");
        const result = await requestToken(serverUrl, password, totp.trim());

        switch (result.kind) {
            case "token":
                await browser.storage.sync.set({ triliumServerUrl: serverUrl, authToken: result.token });
                showMessage({ kind: "success", text: "Authentication against Trilium server has been successful." });
                onLoggedIn(serverUrl);
                break;
            case "totp-rejected":
                setTotp("");
                totpRef.current?.focus();
                showMessage({
                    kind: "error",
                    text: totp.trim()
                        ? "Incorrect authentication code."
                        : "Two-factor authentication is enabled. Enter the code from your authenticator app or a recovery code."
                });
                break;
            case "rejected":
                showMessage({ kind: "error", text: "Incorrect credentials." });
                break;
            case "unexpected-status":
                showMessage({ kind: "error", text: `Unrecognised response with status code ${result.status}` });
                break;
            case "network-error":
                showMessage({ kind: "error", text: `Unknown error: ${result.message}` });
                break;
        }
    }

    return (
        <form onSubmit={login}>
            <table>
                <tr>
                    <th>Trilium server URL:</th>
                    <td><input type="text" value={url} onInput={(e) => setUrl(e.currentTarget.value)} /></td>
                </tr>
                <tr>
                    <th>Password:</th>
                    <td><input type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></td>
                </tr>
                <tr>
                    <th>Authentication code:</th>
                    <td>
                        <input
                            ref={totpRef}
                            type="text"
                            autocomplete="one-time-code"
                            value={totp}
                            onInput={(e) => setTotp(e.currentTarget.value)}
                        />
                        {" "}(only if two-factor authentication is enabled)
                    </td>
                </tr>
                <tr>
                    <th></th>
                    <td><input type="submit" value="Login to the server instance" /></td>
                </tr>
            </table>

            <p>
                Note that the entered password is not stored anywhere, it will be only used to retrieve
                an authorization token from the server instance which will be then used to send the
                clipped notes.
            </p>
        </form>
    );
}

type TokenResult =
    | { kind: "token", token: string }
    | { kind: "totp-rejected" }
    | { kind: "rejected" }
    | { kind: "unexpected-status", status: number }
    | { kind: "network-error", message: string };

/** Logs in to a Trilium server to obtain an ETAPI token for the clipper. */
export async function requestToken(serverUrl: string, password: string, totpToken: string): Promise<TokenResult> {
    let resp: Response;
    try {
        resp = await fetch(`${serverUrl}/api/login/token`, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ password, totpToken })
        });
    } catch (e) {
        return { kind: "network-error", message: e instanceof Error ? e.message : String(e) };
    }

    if (resp.status === 401) {
        // Servers before the factor was reported answer with a plain string.
        const { factor } = await resp.json().catch(() => ({}));
        return factor === "totp" ? { kind: "totp-rejected" } : { kind: "rejected" };
    }

    if (resp.status !== 200) {
        return { kind: "unexpected-status", status: resp.status };
    }

    const { token } = await resp.json();
    return { kind: "token", token };
}
