/**
 * Returns a function, that, as long as it continues to be invoked, will not
 * be triggered. The function will be called after it stops being called for
 * N milliseconds. If `immediate` is passed, trigger the function on the
 * leading edge, instead of the trailing. The function also has a property 'clear'
 * that is a function which will clear the timer to prevent previously scheduled executions.
 *
 * @source underscore.js
 * @see http://unscriptable.com/2009/03/20/debouncing-javascript-methods/
 * @param func to wrap
 * @param waitMs in ms (`100`)
 * @param whether to execute at the beginning (`false`)
 * @api public
 */
function debounce<T>(func: (...args: any[]) => T, waitMs: number, immediate: boolean = false) {
    let timeout: any; // TODO: fix once we split client and server.
    let args: unknown[] | null;
    let context: unknown;
    let timestamp: number;
    let result: T;
    if (null == waitMs) waitMs = 100;

    function later() {
        const last = Date.now() - timestamp;

        if (last < waitMs && last >= 0) {
            timeout = setTimeout(later, waitMs - last);
        } else {
            timeout = null;
            if (!immediate) {
                result = func.apply(context, args || []);
                context = args = null;
            }
        }
    }

    const debounced = function (this: any) {
        context = this;
        args = arguments as unknown as unknown[];
        timestamp = Date.now();
        const callNow = immediate && !timeout;
        if (!timeout) timeout = setTimeout(later, waitMs);
        if (callNow) {
            result = func.apply(context, args || []);
            context = args = null;
        }

        return result;
    };

    debounced.clear = function () {
        if (timeout) {
            clearTimeout(timeout);
            timeout = null;
        }
    };

    debounced.flush = function () {
        if (timeout) {
            result = func.apply(context, args || []);
            context = args = null;

            clearTimeout(timeout);
            timeout = null;
        }
    };

    return debounced;
}

// Adds compatibility for ES modules
debounce.debounce = debounce;

export default debounce;
