import type { SaveState } from "../components/note_context";
import { getErrorMessage } from "./utils";

type Callback = () => Promise<void> | void;

export type StateCallback = (state: SaveState) => void;

export default class SpacedUpdate {
    private updater: Callback;
    private lastUpdated: number;
    private changed: boolean;
    private updateInterval: number;
    private changeForbidden?: boolean;
    private stateCallback?: StateCallback;

    constructor(updater: Callback, updateInterval = 1000, stateCallback?: StateCallback) {
        this.updater = updater;
        this.lastUpdated = Date.now();
        this.changed = false;
        this.updateInterval = updateInterval;
        this.stateCallback = stateCallback;
    }

    scheduleUpdate() {
        if (!this.changeForbidden) {
            this.changed = true;
            this.stateCallback?.("unsaved");
            setTimeout(() => this.triggerUpdate());
        }
    }

    async updateNowIfNecessary() {
        if (this.changed) {
            this.changed = false; // optimistic...

            try {
                this.stateCallback?.("saving");
                await this.updater();
                this.stateCallback?.("saved");
            } catch (e) {
                this.changed = true;
                this.stateCallback?.("error");
                logError(getErrorMessage(e));
                throw e;
            }
        }
    }

    isAllSavedAndTriggerUpdate() {
        const allSaved = !this.changed;

        this.updateNowIfNecessary();

        return allSaved;
    }

    /**
     * Normally {@link scheduleUpdate()} would actually trigger the update only once per {@link updateInterval}. If the method is called 200 times within 20s, it will execute only 20 times.
     * Sometimes, if the updates are continuous this would cause a performance impact. Resetting the time ensures that the calls to {@link triggerUpdate} have stopped before actually triggering an update.
     */
    resetUpdateTimer() {
        this.lastUpdated = Date.now();
    }

    /**
     * Sets the update interval for the spaced update.
     * @param interval The update interval in milliseconds.
     */
    setUpdateInterval(interval: number) {
        this.updateInterval = interval;
    }

    async triggerUpdate() {
        if (!this.changed) {
            return;
        }

        if (Date.now() - this.lastUpdated > this.updateInterval) {
            this.stateCallback?.("saving");
            try {
                await this.updater();
                this.stateCallback?.("saved");
                this.changed = false;
            } catch (e) {
                this.stateCallback?.("error");
                logError(getErrorMessage(e));
            }
            this.lastUpdated = Date.now();
        } else {
            // update isn't triggered but changes are still pending, so we need to schedule another check
            this.scheduleUpdate();
        }
    }

    async allowUpdateWithoutChange(callback: Callback) {
        this.changeForbidden = true;

        try {
            await callback();
        } finally {
            this.changeForbidden = false;
        }
    }
}
