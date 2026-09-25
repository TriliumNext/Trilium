// Records every module the process loads into the file named by LOAD_LOG.
// Preloaded via `node --require`; analyze-bundle.mjs record does this for you.
// Only files under a dist/ directory are recorded — node built-ins and the
// hook's own machinery are noise for bundle analysis.
const { registerHooks } = require("node:module");
const fs = require("fs");

registerHooks({
    load(url, context, nextLoad) {
        if (url.includes("/dist/") && process.env.LOAD_LOG) {
            fs.appendFileSync(process.env.LOAD_LOG, url + "\n");
        }
        return nextLoad(url, context);
    }
});
