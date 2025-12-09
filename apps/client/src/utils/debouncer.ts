export type DebouncerCallback<T> = (value: T) => void;

export default class Debouncer<T> {

    private debounceInterval: number;
    private callback: DebouncerCallback<T>;
    private lastValue: T | undefined;
    private timeoutId: any | null = null;

    constructor(debounceInterval: number, onUpdate: DebouncerCallback<T>) {
        this.debounceInterval = debounceInterval;
        this.callback = onUpdate;
    }

    updateValue(value: T) {
        this.lastValue = value;
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
        }
        this.timeoutId = setTimeout(this.reportUpdate.bind(this), this.debounceInterval);
    }

    destroy() {
        if (this.timeoutId !== null) {
            this.reportUpdate();
            clearTimeout(this.timeoutId);
        }
    }

    private reportUpdate() {
        if (this.lastValue !== undefined) {
            this.callback(this.lastValue);
        }
    }
}