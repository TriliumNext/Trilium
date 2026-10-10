const PROTOCOL_VERSION_MAJOR = 1;

export type TriliumSearchStatus = {
    status: "searching";
} | {
    status: "not-found"
} | {
    status: "found-desktop",
    port: number;
    url: string;
} | {
    status: "found-server",
    url: string;
    token: string;
} | {
    status: "version-mismatch";
    extensionMajor: number;
    triliumMajor: number;
};

type FoundStatus = Exclude<TriliumSearchStatus, { status: "searching" | "not-found" }>;

export type TriliumSearchNoteStatus = {
    status: "not-found",
    noteId: null
} | {
    status: "found",
    noteId: string
};

/** A request to Trilium that failed, with a message that can be shown to the user. */
export class TriliumError extends Error {

    constructor(
        readonly reason: "not-found" | "version-mismatch" | "request-failed",
        message: string
    ) {
        super(message);
    }

}

export default class TriliumServerFacade {
    private triliumSearch: TriliumSearchStatus = { status: "searching" };
    private triliumSearchNote?: TriliumSearchNoteStatus;

    constructor() {
        this.triggerSearchForTrilium();

        // continually scan for changes (if e.g. desktop app is started after browser)
        setInterval(() => this.triggerSearchForTrilium(), 60 * 1000);
    }

    async sendTriliumSearchStatusToPopup() {
        try {
            await browser.runtime.sendMessage({
                name: "trilium-search-status",
                triliumSearch: this.triliumSearch
            });
        }
        catch (e) {} // nothing might be listening
    }
    async sendTriliumSearchNoteToPopup(){
        try{
            await browser.runtime.sendMessage({
                name: "trilium-previously-visited",
                searchNote: this.triliumSearchNote
            });

        }
        catch (e) {} // nothing might be listening
    }

    setTriliumSearchNote(st: TriliumSearchNoteStatus){
        this.triliumSearchNote = st;
        this.sendTriliumSearchNoteToPopup();
    }

    setTriliumSearch(ts: TriliumSearchStatus) {
        this.triliumSearch = ts;

        this.sendTriliumSearchStatusToPopup();
    }

    setTriliumSearchWithVersionCheck(json: { protocolVersion: string }, resp: TriliumSearchStatus) {
        const [ major = NaN ] = json.protocolVersion
            .split(".")
            .map(chunk => parseInt(chunk, 10));

        // minor version is intended to be used to dynamically limit features provided by extension
        // if some specific Trilium API is not supported. So far not needed.

        if (major !== PROTOCOL_VERSION_MAJOR) {
            this.setTriliumSearch({
                status: 'version-mismatch',
                extensionMajor: PROTOCOL_VERSION_MAJOR,
                triliumMajor: major
            });
        }
        else {
            this.setTriliumSearch(resp);
        }
    }

    async triggerSearchForTrilium() {
        this.setTriliumSearch({ status: 'searching' });

        try {
            const port = await this.getPort();

            console.debug(`Trying port ${port}`);

            const resp = await fetch(`http://127.0.0.1:${port}/api/clipper/handshake`);

            const text = await resp.text();

            console.log("Received response:", text);

            const json = JSON.parse(text);

            if (json.appName === 'trilium') {
                this.setTriliumSearchWithVersionCheck(json, {
                    status: 'found-desktop',
                    port,
                    url: `http://127.0.0.1:${port}`
                });

                return;
            }
        }
        catch (error) {
            // continue
        }

        const {triliumServerUrl} = await browser.storage.sync.get<{ triliumServerUrl: string }>("triliumServerUrl");
        const {authToken} = await browser.storage.sync.get<{ authToken: string }>("authToken");

        if (triliumServerUrl && authToken) {
            try {
                const resp = await fetch(`${triliumServerUrl  }/api/clipper/handshake`, {
                    headers: {
                        Authorization: authToken
                    }
                });

                const text = await resp.text();

                console.log("Received response:", text);

                const json = JSON.parse(text);

                if (json.appName === 'trilium') {
                    this.setTriliumSearchWithVersionCheck(json, {
                        status: 'found-server',
                        url: triliumServerUrl,
                        token: authToken
                    });

                    return;
                }
            }
            catch (e) {
                console.log("Request to the configured server instance failed with:", e);
            }
        }

        // if all above fails it's not found
        this.setTriliumSearch({ status: 'not-found' });
    }

    async triggerSearchNoteByUrl(noteUrl: string) {
        const resp = await this.callService('GET', `notes-by-url/${encodeURIComponent(noteUrl)}`)
            .catch(() => null);
        let newStatus: TriliumSearchNoteStatus;
        if (resp && resp.noteId) {
            newStatus = {
                status: 'found',
                noteId: resp.noteId,
            };
        } else {
            newStatus = {
                status: 'not-found',
                noteId: null
            };
        }
        this.setTriliumSearchNote(newStatus);
    }
    /** Resolves with the outcome of the running search, and rejects if Trilium was not found. */
    async waitForTriliumSearch() {
        return new Promise<FoundStatus>((res, rej) => {
            const checkStatus = () => {
                const search = this.triliumSearch;
                if (search.status === "searching") {
                    setTimeout(checkStatus, 500);
                } else if (search.status === "not-found") {
                    rej(notFound());
                } else {
                    res(search);
                }
            };

            checkStatus();
        });
    }

    async getPort() {
        const {triliumDesktopPort} = await browser.storage.sync.get<{ triliumDesktopPort: string }>("triliumDesktopPort");

        if (triliumDesktopPort) {
            return parseInt(triliumDesktopPort, 10);
        }

        return import.meta.env.DEV ? 37742 : 37840;
    }

    async callService(method: string, path: string, body?: string | object) {
        const search = await this.waitForTriliumSearch();
        if (search.status === "version-mismatch") {
            const { extensionMajor, triliumMajor } = search;
            const outdated = extensionMajor > triliumMajor ? "Trilium" : "the web clipper";
            throw new TriliumError("version-mismatch", "This version of the web clipper does not "
                + `work with this version of Trilium. Update ${outdated} to the latest version.`);
        }

        let response: Response;
        try {
            const fetchOptions: RequestInit = {
                method,
                headers: {
                    Authorization: search.status === "found-server" ? search.token : "",
                    'Content-Type': 'application/json',
                    'trilium-local-now-datetime': this.localNowDateTime()
                },
            };

            if (body) {
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            }

            const url = `${search.url}/api/clipper/${path}`;

            console.log(`Sending ${method} request to ${url}`);

            response = await fetch(url, fetchOptions);
        }
        catch (e) {
            throw requestFailed(e instanceof Error ? e.message : String(e));
        }

        if (!response.ok) {
            throw requestFailed(await readErrorMessage(response));
        }

        return await response.json();
    }

    localNowDateTime() {
        const date = new Date();
        const off = date.getTimezoneOffset();
        const absoff = Math.abs(off);
        const localTime = new Date(date.getTime() - off * 60 * 1000).toISOString()
            .substring(0, 23)
            .replace("T", " ");
        const sign = off > 0 ? "-" : "+";
        const hours = String(Math.floor(absoff / 60)).padStart(2, "0");
        const minutes = String(absoff % 60).padStart(2, "0");
        return `${localTime}${sign}${hours}:${minutes}`;
    }
}

function notFound() {
    return new TriliumError("not-found", "Trilium was not found. Start the desktop app, or check "
        + "the server address and token in the clipper's options.");
}

function requestFailed(details: string) {
    return new TriliumError("request-failed", `The request to Trilium failed: ${details}`);
}

/** Trilium answers a failed API request with `{ message }`; a proxy in front of it might not. */
async function readErrorMessage(response: Response) {
    const text = (await response.text()).trim();
    try {
        const { message } = JSON.parse(text) as { message?: unknown };
        if (typeof message === "string" && message) return message;
    } catch {
        // Not JSON, so the text is the message.
    }
    return text || `HTTP ${response.status}`;
}
