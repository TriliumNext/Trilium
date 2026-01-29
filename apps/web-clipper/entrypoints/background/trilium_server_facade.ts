const PROTOCOL_VERSION_MAJOR = 1;

type TriliumSearchStatus = {
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

type TriliumSearchNoteStatus = {
    status: "not-found",
    noteId: null
} | {
    status: "found",
    noteId: string
};

export default class TriliumServerFacade {
    private triliumSearch?: TriliumSearchStatus;
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
        const [ major ] = json.protocolVersion
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
        const resp = await this.callService('GET', `notes-by-url/${encodeURIComponent(noteUrl)}`);
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
    async waitForTriliumSearch() {
        return new Promise<void>((res, rej) => {
            const checkStatus = () => {
                if (this.triliumSearch?.status === "searching") {
                    setTimeout(checkStatus, 500);
                } else if (this.triliumSearch?.status === 'not-found') {
                    rej(new Error("Trilium instance has not been found."));
                } else {
                    res();
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
        await this.waitForTriliumSearch();
        if (!this.triliumSearch || (this.triliumSearch.status !== 'found-desktop' && this.triliumSearch.status !== 'found-server')) return;

        try {
            const fetchOptions: RequestInit = {
                method,
                headers: {
                    Authorization: "token" in this.triliumSearch ? this.triliumSearch.token ?? "" : "",
                    'Content-Type': 'application/json',
                    'trilium-local-now-datetime': this.localNowDateTime()
                },
            };

            if (body) {
                fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
            }

            const url = `${this.triliumSearch.url}/api/clipper/${path}`;

            console.log(`Sending ${method} request to ${url}`);

            const response = await fetch(url, fetchOptions);

            if (!response.ok) {
                throw new Error(await response.text());
            }

            return await response.json();
        }
        catch (e) {
            console.log("Sending request to trilium failed", e);

            return null;
        }
    }

    localNowDateTime() {
        const date = new Date();
        const off = date.getTimezoneOffset();
        const absoff = Math.abs(off);
        return (`${new Date(date.getTime() - off * 60 * 1000).toISOString().substr(0,23).replace("T",  " ") +
			(off > 0 ? '-' : '+') +
			(absoff / 60).toFixed(0).padStart(2,'0')  }:${
            (absoff % 60).toString().padStart(2,'0')}`);
    }
}
