import server from "./server.js";
import { isShare } from "./utils.js";

export type OptionValue = number | string;

class Options {
    initializedPromise: Promise<void>;
    private arr!: Record<string, OptionValue>;

    constructor() {
        if (!isShare) {
            this.initializedPromise = server.get<Record<string, OptionValue>>("options").then((data) => this.load(data));
        } else {
            this.initializedPromise = Promise.resolve();
        }
    }

    load(arr: Record<string, OptionValue>) {
        this.arr = arr;
    }

    get(key: string) {
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

    getInt(key: string) {
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

    getFloat(key: string) {
        const value = this.arr?.[key];
        if (typeof value !== "string") {
            return null;
        }
        return parseFloat(value);
    }

    is(key: string) {
        return this.arr[key] === "true";
    }

    set(key: string, value: OptionValue) {
        this.arr[key] = value;
    }

    async save(key: string, value: OptionValue) {
        this.set(key, value);

        const payload: Record<string, OptionValue> = {};
        payload[key] = value;

        await server.put(`options`, payload);
    }

    async toggle(key: string) {
        await this.save(key, (!this.is(key)).toString());
    }
}

const options = new Options();

export default options;
