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
        // The `=== undefined` branch is unreachable via the public API: reportUpdate only runs
        // after updateValue has assigned `lastValue` (it both sets the value and schedules the
        // timer / arms the destroy flush). The guard is kept defensively for `T` types that
        // include `undefined`.
        /* v8 ignore next 3 */
        if (this.lastValue !== undefined) {
            this.callback(this.lastValue);
        }
    }
}