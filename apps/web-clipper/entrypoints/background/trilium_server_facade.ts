const PROTOCOL_VERSION_MAJOR = 1;
const DESKTOP_TIMEOUT_MS = 2000;
const SERVER_TIMEOUT_MS = 10000;

export type TriliumSearchStatus = {
    status: "searching";
} | {
    status: "not-found"
} | {
    status: "found-desktop",
    port: number;
    url: string;
    protocolMinor: number;
} | {
    status: "found-server",
    url: string;
    token: string;
    protocolMinor: number;
} | {
    status: "version-mismatch";
    extensionMajor: number;
    triliumMajor: number;
};

/** The outcome of a finished search. */
type SearchResult = Exclude<TriliumSearchStatus, { status: "searching" }>;
type FoundStatus = Exclude<SearchResult, { status: "not-found" }>;
type CompatibleStatus = Exclude<FoundStatus, { status: "version-mismatch" }>;

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
    /** The latest search, which `callService()` waits for. */
    private search: Promise<SearchResult>;
    private searchCount = 0;
    /** Reads the status found before the service worker was last stopped. */
    private readonly restored: Promise<void>;

    constructor() {
        this.restored = this.restoreLastSearch();
        this.search = this.triggerSearchForTrilium(false);

        // continually scan for changes (if e.g. desktop app is started after browser)
        setInterval(() => this.triggerSearchForTrilium(false), 60 * 1000);
    }

    async sendTriliumSearchStatusToPopup() {
        await this.restored;
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

    /**
     * Looks for Trilium and reports the outcome to the popup. With `showProgress` false, the popup
     * keeps the last status until the search ends, so a background check does not flash "searching".
     */
    triggerSearchForTrilium(showProgress = true) {
        const id = ++this.searchCount;
        const search = this.restored
            .then(() => {
                if (showProgress) this.setTriliumSearch({ status: "searching" });
                return this.findTrilium();
            })
            .then(async (status) => {
                if (id === this.searchCount) {
                    this.setTriliumSearch(status);
                    await browser.storage.session?.set({ triliumSearch: status });
                }
                return status;
            });
        this.search = search;
        return search;
    }

    /** Session storage needs Chrome 102 or Firefox 115; without it, each start searches anew. */
    private async restoreLastSearch() {
        const stored = await browser.storage.session
            ?.get<{ triliumSearch?: SearchResult }>("triliumSearch");
        if (stored?.triliumSearch) this.triliumSearch = stored.triliumSearch;
    }

    /** Asks the desktop app and the server at once, and prefers the desktop app when both answer. */
    private async findTrilium(): Promise<SearchResult> {
        const port = await this.getPort();
        const desktopUrl = `http://127.0.0.1:${port}`;
        const { triliumServerUrl, authToken } = await browser.storage.sync
            .get<{ triliumServerUrl?: string, authToken?: string }>([ "triliumServerUrl", "authToken" ]);

        const server = triliumServerUrl && authToken
            ? handshake(triliumServerUrl, SERVER_TIMEOUT_MS, { Authorization: authToken })
                .then((json) => json && checkVersion(json, (protocolMinor) => ({
                    status: "found-server",
                    url: triliumServerUrl,
                    token: authToken,
                    protocolMinor
                })))
            : Promise.resolve(null);

        const desktop = await handshake(desktopUrl, DESKTOP_TIMEOUT_MS);
        if (desktop) {
            return checkVersion(desktop, (protocolMinor) => ({
                status: "found-desktop", port, url: desktopUrl, protocolMinor
            }));
        }

        return await server ?? { status: "not-found" };
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

    /** Resolves with the outcome of the latest search, and rejects if Trilium was not found. */
    async waitForTriliumSearch(): Promise<FoundStatus> {
        let search: Promise<SearchResult>;
        let status: SearchResult;
        do {
            search = this.search;
            status = await search;
        } while (search !== this.search);

        if (status.status === "not-found") {
            throw notFound();
        }
        return status;
    }

    async getPort() {
        const {triliumDesktopPort} = await browser.storage.sync.get<{ triliumDesktopPort: string }>("triliumDesktopPort");

        if (triliumDesktopPort) {
            return parseInt(triliumDesktopPort, 10);
        }

        return import.meta.env.DEV ? 37743 : 37840;
    }

    /**
     * Rejects unless Trilium supports minor version `minor` of the protocol, which `feature` needs:
     * a minor version adds an API that older versions of Trilium do not have.
     */
    async requireMinorVersion(minor: number, feature: string) {
        const search = await this.waitForCompatibleTrilium();
        if (search.protocolMinor < minor) {
            throw new TriliumError("version-mismatch",
                `${feature} needs a newer version of Trilium. Update Trilium to the latest version.`);
        }
    }

    private async waitForCompatibleTrilium(): Promise<CompatibleStatus> {
        const search = await this.waitForTriliumSearch();
        if (search.status === "version-mismatch") {
            const { extensionMajor, triliumMajor } = search;
            const outdated = extensionMajor > triliumMajor ? "Trilium" : "the web clipper";
            throw new TriliumError("version-mismatch", "This version of the web clipper does not "
                + `work with this version of Trilium. Update ${outdated} to the latest version.`);
        }
        return search;
    }

    async callService(method: string, path: string, body?: string | object) {
        const search = await this.waitForCompatibleTrilium();

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


type HandshakeResponse = { appName?: string, protocolVersion: string };

/** Resolves with the handshake of the Trilium at `url`, or `null` if none answers in time. */
async function handshake(url: string, timeoutMs: number, headers?: Record<string, string>) {
    try {
        const response = await fetch(`${url}/api/clipper/handshake`, {
            headers,
            signal: AbortSignal.timeout(timeoutMs)
        });
        const json = JSON.parse(await response.text()) as HandshakeResponse;
        return json.appName === "trilium" ? json : null;
    } catch (e) {
        console.log(`Handshake with ${url} failed with:`, e);
        return null;
    }
}

/**
 * Reports a Trilium of another major version as a mismatch, or else `found` with the minor version,
 * which tells the features Trilium supports.
 */
function checkVersion(
    json: HandshakeResponse,
    found: (protocolMinor: number) => CompatibleStatus
): SearchResult {
    const [ major = NaN, minor = 0 ] = json.protocolVersion
        .split(".")
        .map(chunk => parseInt(chunk, 10));

    if (major !== PROTOCOL_VERSION_MAJOR) {
        return {
            status: "version-mismatch",
            extensionMajor: PROTOCOL_VERSION_MAJOR,
            triliumMajor: major
        };
    }
    return found(minor);
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
