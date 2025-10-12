const PROTOCOL_VERSION_MAJOR = 1;

function isDevEnv() {
	const manifest = browser.runtime.getManifest();

	return manifest.name.endsWith('(dev)');
}

class TriliumServerFacade {
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
			})

		}
		catch (e) {} // nothing might be listening
	}

	setTriliumSearchNote(st){
		this.triliumSearchNote = st;
		this.sendTriliumSearchNoteToPopup();
	}

	setTriliumSearch(ts) {
		this.triliumSearch = ts;

		this.sendTriliumSearchStatusToPopup();
	}

	setTriliumSearchWithVersionCheck(json, resp) {
		const [major, minor] = json.protocolVersion
			.split(".")
			.map(chunk => parseInt(chunk));

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

			console.debug('Trying port ' + port);

			const resp = await fetch(`http://127.0.0.1:${port}/api/clipper/handshake`);

			const text = await resp.text();

			console.log("Received response:", text);

			const json = JSON.parse(text);

			if (json.appName === 'trilium') {
				this.setTriliumSearchWithVersionCheck(json, {
					status: 'found-desktop',
					port: port,
					url: 'http://127.0.0.1:' + port
				});

				return;
			}
		}
		catch (error) {
			// continue
		}

		const {triliumServerUrl} = await browser.storage.sync.get("triliumServerUrl");
		const {authToken} = await browser.storage.sync.get("authToken");

		if (triliumServerUrl && authToken) {
			try {
				const resp = await fetch(triliumServerUrl + '/api/clipper/handshake', {
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

	async triggerSearchNoteByUrl(noteUrl) {
		const resp = await triliumServerFacade.callService('GET', 'notes-by-url/' + encodeURIComponent(noteUrl))
		let newStatus = {
			status: 'not-found',
			noteId: null
		}
		if (resp && resp.noteId) {
			newStatus.noteId = resp.noteId;
			newStatus.status = 'found';
		}
		this.setTriliumSearchNote(newStatus);
	}
	async waitForTriliumSearch() {
		return new Promise((res, rej) => {
			const checkStatus = () => {
				if (this.triliumSearch.status === "searching") {
					setTimeout(checkStatus, 500);
				}
				else if (this.triliumSearch.status === 'not-found') {
					rej(new Error("Trilium instance has not been found."));
				}
				else {
					res();
				}
			};

			checkStatus();
		});
	}

	async getPort() {
		const {triliumDesktopPort} = await browser.storage.sync.get("triliumDesktopPort");

		if (triliumDesktopPort) {
			return parseInt(triliumDesktopPort);
		}
		else {
			return isDevEnv() ? 37740 : 37840;
		}
	}

	async callService(method, path, body) {
		const fetchOptions = {
			method: method,
			headers: {
				'Content-Type': 'application/json'
			},
		};

		if (body) {
			fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
		}

		try {
			await this.waitForTriliumSearch();

			fetchOptions.headers.Authorization = this.triliumSearch.token || "";
			fetchOptions.headers['trilium-local-now-datetime'] = this.localNowDateTime();

			const url = this.triliumSearch.url + "/api/clipper/" + path;

			console.log(`Sending ${method} request to ${url}`);

			const response = await fetch(url, fetchOptions);

			if (!response.ok) {
				throw new Error(await response.text());
			}

			return await response.json();
		}
		catch (e) {
			console.log("Sending request to trilium failed", e);

			toast('Your request failed because we could not contact Trilium instance. Please make sure Trilium is running and is accessible.');

			return null;
		}
	}

	localNowDateTime() {
		const date = new Date();
		const off = date.getTimezoneOffset();
		const absoff = Math.abs(off);
		return (new Date(date.getTime() - off * 60 * 1000).toISOString().substr(0,23).replace("T",  " ") +
			(off > 0 ? '-' : '+') +
			(absoff / 60).toFixed(0).padStart(2,'0') + ':' +
			(absoff % 60).toString().padStart(2,'0'));
	}
}

window.triliumServerFacade = new TriliumServerFacade();
