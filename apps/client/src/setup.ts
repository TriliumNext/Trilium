import "jquery";
import utils from "./services/utils.js";
import ko from "knockout";

// TriliumNextTODO: properly make use of below types
// type SetupModelSetupType = "new-document" | "sync-from-desktop" | "sync-from-server" | "";
// type SetupModelStep = "sync-in-progress" | "setup-type" | "new-document-in-progress" | "sync-from-desktop";

class SetupModel {
    syncInProgress: boolean;
    step: ko.Observable<string>;
    setupType: ko.Observable<string>;
    setupNewDocument: ko.Observable<boolean>;
    setupSyncFromDesktop: ko.Observable<boolean>;
    setupSyncFromServer: ko.Observable<boolean>;
    syncServerHost: ko.Observable<string | undefined>;
    syncProxy: ko.Observable<string | undefined>;
    password: ko.Observable<string | undefined>;

    constructor(syncInProgress: boolean) {
        this.syncInProgress = syncInProgress;
        this.step = ko.observable(syncInProgress ? "sync-in-progress" : "setup-type");
        this.setupType = ko.observable("");
        this.setupNewDocument = ko.observable(false);
        this.setupSyncFromDesktop = ko.observable(false);
        this.setupSyncFromServer = ko.observable(false);
        this.syncServerHost = ko.observable();
        this.syncProxy = ko.observable();
        this.password = ko.observable();

        if (this.syncInProgress) {
            setInterval(checkOutstandingSyncs, 1000);
        }
        const serverAddress = `${location.protocol}//${location.host}`;
        $("#current-host").html(serverAddress);
    }

    // this is called in setup.ejs
    setupTypeSelected() {
        return !!this.setupType();
    }

    selectSetupType() {
        if (this.setupType() === "new-document") {
            this.step("new-document-in-progress");

            $.post("api/setup/new-document").then(() => {
                window.location.replace("./setup");
            });
        } else {
            this.step(this.setupType());
        }
    }

    back() {
        this.step("setup-type");
        this.setupType("");
    }

    async finish() {
        const syncServerHost = this.syncServerHost();
        const syncProxy = this.syncProxy();
        const password = this.password();

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
            syncServerHost: syncServerHost,
            syncProxy: syncProxy,
            password: password
        });

        if (resp.result === "success") {
            this.step("sync-in-progress");

            setInterval(checkOutstandingSyncs, 1000);

            hideAlert();
        } else {
            showAlert(`Sync setup failed: ${resp.error}`);
        }
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

addEventListener("DOMContentLoaded", (event) => {
    ko.applyBindings(new SetupModel(getSyncInProgress()), document.getElementById("setup-dialog"));
    $("#setup-dialog").show();
});
