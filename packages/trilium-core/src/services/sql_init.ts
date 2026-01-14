import { deferred } from "@triliumnext/commons";

export const dbReady = deferred<void>();

// TODO: Proper impl.
setTimeout(() => {
    dbReady.resolve();
}, 850);

function isDbInitialized() {
    return true;
}

export default { isDbInitialized };
