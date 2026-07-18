import NodeRequestProvider, { type Client, type ClientOpts } from "@triliumnext/server/src/services/request.js";
import electron from "electron";

/**
 * Desktop variant of NodeRequestProvider that prefers Electron's `net` module
 * for requests without an explicit proxy. Electron's net respects the system
 * proxy configuration (PAC, environment), whereas Node's http(s) does not —
 * so the sync client gets transparent system-proxy support out of the box.
 *
 * When an explicit proxy IS set (sync options), we fall through to Node's
 * http(s) since Electron's net has no straightforward way to be configured
 * with a custom proxy.
 */
export default class ElectronRequestProvider extends NodeRequestProvider {
    protected async getClient(opts: ClientOpts): Promise<Client> {
        if (!opts.proxy) {
            // `electron.net` can only be used after `app.ready` has fired.
            // The sync timer is scheduled inside `buildApp()` and could in
            // principle fire before the renderer's `ready` event, so wait
            // defensively. After ready, `whenReady()` resolves synchronously
            // and adds no overhead.
            if (!electron.app.isReady()) {
                await electron.app.whenReady();
            }
            return electron.net as unknown as Client;
        }
        return super.getClient(opts);
    }
}
