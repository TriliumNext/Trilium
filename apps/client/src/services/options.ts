import { OptionNames } from "@triliumnext/commons";

import server from "./server.js";
import { isPreAuthScreen, isShare } from "./utils.js";

export type OptionValue = number | string;

class Options {
    initializedPromise: Promise<void>;
    private arr!: Record<string, OptionValue>;
    /** Which save was the most recent for a key, so a failing one knows whether it still speaks for it. */
    private latestSave: Record<string, number> = {};

    constructor() {
        // Don't fetch on the share view, nor on the login / set-password pre-auth screens, where an
        // unauthenticated GET /api/options would 401 (#10589). Options aren't needed to render those.
        if (!isShare && !isPreAuthScreen()) {
            this.initializedPromise = server.get<Record<string, OptionValue>>("options").then((data) => this.load(data));
        } else {
            this.initializedPromise = Promise.resolve();
        }
    }

    load(arr: Record<string, OptionValue>) {
        this.arr = arr;
    }

    get(key: OptionNames) {
        return this.arr?.[key] as string;
    }

    getNames() {
        return Object.keys(this.arr || []);
    }

    getJson(key: string) {
        const value = this.arr?.[key];
        if (typeof value !== "string") {
            return null;
        }
        try {
            return JSON.parse(value);
        } catch (e) {
            return null;
        }
    }

    getInt(key: OptionNames) {
        const value = this.arr?.[key];
        if (typeof value === "number") {
            return value;
        }
        if (typeof value == "string") {
            return parseInt(value);
        }
        console.warn("Attempting to read int for unsupported value: ", value);
        return null;
    }

    getFloat(key: OptionNames) {
        const value = this.arr?.[key];
        if (typeof value !== "string") {
            return null;
        }
        return parseFloat(value);
    }

    is(key: OptionNames) {
        return this.arr[key] === "true";
    }

    set(key: OptionNames, value: OptionValue) {
        this.arr[key] = value;
    }

    async save(key: OptionNames, value: OptionValue) {
        const previous = this.arr?.[key];
        const save = (this.latestSave[key] ?? 0) + 1;
        this.latestSave[key] = save;
        this.set(key, value);

        const payload: Record<string, OptionValue> = {};
        payload[key] = value;

        try {
            await server.put(`options`, payload);
        } catch (e) {
            // Set ahead of the request so a read straight after the call sees the new value, but put
            // back when the server refuses it: a cache that keeps reporting a value which was never
            // stored makes the failure invisible to whoever asks afterwards.
            //
            // Only when this is still the newest save for the key *and* what it wrote is still what
            // is held. Either alone is not enough: a later save of the same value would otherwise be
            // undone by this one failing, and so would a value the server pushed here meanwhile.
            //
            // Two saves of one key failing together still leave the cache on the older one's value
            // rather than on what the server holds, which is what it did before any of this and is
            // as far as a single record without a known-persisted value can get.
            if (this.latestSave[key] === save && this.arr?.[key] === value) {
                this.set(key, previous as OptionValue);
            }
            throw e;
        }
    }

    /**
     * Saves multiple options at once, by supplying a record where the keys are the option names and the values represent the stringified value to set.
     * @param newValues the record of keys and values.
     */
    async saveMany<T extends OptionNames>(newValues: Record<T, OptionValue>) {
        await server.put<void>("options", newValues);
    }

    async toggle(key: OptionNames) {
        await this.save(key, (!this.is(key)).toString());
    }
}

const options = new Options();

export default options;
