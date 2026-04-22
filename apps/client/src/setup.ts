import "jquery";

import utils from "./services/utils.js";

type SetupStep = "sync-in-progress" | "setup-type" | "new-document-in-progress" | "sync-from-desktop" | "sync-from-server";
type SetupType = "new-document" | "sync-from-desktop" | "sync-from-server" | "";

class SetupController {
    private step: SetupStep;
    private setupType: SetupType = "";
    private syncPollIntervalId: number | null = null;
    private rootNode: HTMLElement;
    private setupTypeForm: HTMLFormElement;
    private syncFromServerForm: HTMLFormElement;
    private setupTypeNextButton: HTMLButtonElement;
    private setupTypeInputs: HTMLInputElement[];
    private syncServerHostInput: HTMLInputElement;
    private syncProxyInput: HTMLInputElement;
    private passwordInput: HTMLInputElement;
    private sections: Record<SetupStep, HTMLElement>;

    constructor(rootNode: HTMLElement, syncInProgress: boolean) {
        this.rootNode = rootNode;
        this.step = syncInProgress ? "sync-in-progress" : "setup-type";
        this.setupTypeForm = mustGetElement("setup-type-form", HTMLFormElement);
        this.syncFromServerForm = mustGetElement("sync-from-server-form", HTMLFormElement);
        this.setupTypeNextButton = mustGetElement("setup-type-next", HTMLButtonElement);
        this.setupTypeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='setup-type']"));
        this.syncServerHostInput = mustGetElement("sync-server-host", HTMLInputElement);
        this.syncProxyInput = mustGetElement("sync-proxy", HTMLInputElement);
        this.passwordInput = mustGetElement("password", HTMLInputElement);
        this.sections = {
            "setup-type": mustGetElement("setup-type-section", HTMLElement),
            "new-document-in-progress": mustGetElement("new-document-in-progress-section", HTMLElement),
            "sync-from-desktop": mustGetElement("sync-from-desktop-section", HTMLElement),
            "sync-from-server": mustGetElement("sync-from-server-section", HTMLElement),
            "sync-in-progress": mustGetElement("sync-in-progress-section", HTMLElement)
        };
    }

    init() {
        this.setupTypeForm.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.selectSetupType();
        });

        this.syncFromServerForm.addEventListener("submit", (event) => {
            event.preventDefault();
            void this.finish();
        });

        for (const input of this.setupTypeInputs) {
            input.addEventListener("change", () => {
                this.setupType = input.value as SetupType;
                this.render();
            });
        }

        for (const backButton of document.querySelectorAll<HTMLElement>("[data-action='back']")) {
            backButton.addEventListener("click", () => {
                this.back();
            });
        }

        const serverAddress = `${location.protocol}//${location.host}`;
        $("#current-host").html(serverAddress);

        if (this.step === "sync-in-progress") {
            this.startSyncPolling();
        }

        this.render();
        this.rootNode.style.display = "";
    }

    private async selectSetupType() {
        if (this.setupType === "new-document") {
            this.setStep("new-document-in-progress");

            await $.post("api/setup/new-document");
            window.location.replace("./setup");
            return;
        }

        if (this.setupType) {
            this.setStep(this.setupType);
        }
    }

    private back() {
        this.setStep("setup-type");
        this.setupType = "";

        for (const input of this.setupTypeInputs) {
            input.checked = false;
        }

        this.render();
    }

    private async finish() {
        const syncServerHost = this.syncServerHostInput.value.trim().replace(/\/+$/, "");
        const syncProxy = this.syncProxyInput.value.trim();
        const password = this.passwordInput.value;

        if (!syncServerHost) {
            showAlert("Trilium server address can't be empty");
            return;
        }

        if (!password) {
            showAlert("Password can't be empty");
            return;
        }

        // not using server.js because it loads too many dependencies
        const resp = await $.post("api/setup/sync-from-server", {
            syncServerHost,
            syncProxy,
            password
        });

        if (resp.result === "success") {
            hideAlert();
            this.setStep("sync-in-progress");
            this.startSyncPolling();
        } else {
            showAlert(`Sync setup failed: ${resp.error}`);
        }
    }

    private setStep(step: SetupStep) {
        this.step = step;
        this.render();
    }

    private render() {
        for (const [step, section] of Object.entries(this.sections) as [SetupStep, HTMLElement][]) {
            section.style.display = step === this.step ? "" : "none";
        }

        this.setupTypeNextButton.disabled = !this.setupType;
    }

    private getSelectedSetupType(): SetupType {
        return (this.setupTypeInputs.find((input) => input.checked)?.value ?? "") as SetupType;
    }

    private startSyncPolling() {
        if (this.syncPollIntervalId !== null) {
            return;
        }

        this.syncPollIntervalId = window.setInterval(checkOutstandingSyncs, 1000);
    }
}

async function checkOutstandingSyncs() {
    const { outstandingPullCount, initialized } = await $.get("api/sync/stats");

    if (initialized) {
        if (utils.isElectron()) {
            const remote = utils.dynamicRequire("@electron/remote");
            remote.app.relaunch();
            remote.app.exit(0);
        } else {
            utils.reloadFrontendApp();
        }
    } else {
        $("#outstanding-syncs").html(outstandingPullCount);
    }
}

function showAlert(message: string) {
    $("#alert").text(message);
    $("#alert").show();
}

function hideAlert() {
    $("#alert").hide();
}

function getSyncInProgress() {
    const el = document.getElementById("syncInProgress");
    if (!el || !(el instanceof HTMLMetaElement)) return false;
    return !!parseInt(el.content);
}

function mustGetElement<T extends typeof HTMLElement>(id: string, ctor: T): InstanceType<T> {
    const element = document.getElementById(id);

    if (!element || !(element instanceof ctor)) {
        throw new Error(`Expected element #${id}`);
    }

    return element as InstanceType<T>;
}

addEventListener("DOMContentLoaded", (event) => {
    const rootNode = document.getElementById("setup-dialog");
    if (!rootNode || !(rootNode instanceof HTMLElement)) return;

    new SetupController(rootNode, getSyncInProgress()).init();
});
