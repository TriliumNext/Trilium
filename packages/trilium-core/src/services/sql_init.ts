import { deferred } from "@triliumnext/commons";

export const dbReady = deferred<void>();

dbReady.resolve();
