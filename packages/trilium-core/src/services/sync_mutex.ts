/**
 * Sync process can make data intermittently inconsistent. Processes which require strong data consistency
 * (like consistency checks) can use this mutex to make sure sync isn't currently running.
 */

import { Mutex } from "@triliumnext/commons";

const instance = new Mutex();

function doExclusively<T>(func: () => T | PromiseLike<T>) {
    return instance.runExclusive(func);
}

export default {
    doExclusively
};
