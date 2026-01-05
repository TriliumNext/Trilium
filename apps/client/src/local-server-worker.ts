// public/local-server-worker.js
// This will eventually import your core server and DB provider.
// import { createCoreServer } from "@trilium/core"; (bundled)

const encoder = new TextEncoder();

function jsonResponse(obj, status = 200, extraHeaders = {}) {
    const body = encoder.encode(JSON.stringify(obj)).buffer;
    return {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
        body
    };
}

function textResponse(text, status = 200, extraHeaders = {}) {
    const body = encoder.encode(text).buffer;
    return {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
        body
    };
}

// Example: your /bootstrap handler placeholder
function handleBootstrap() {
    // Later: return real globals from your core state/config.
    return jsonResponse({
        assetPath: "assets",
        themeCssUrl: null,
        themeUseNextAsBase: "next",
        iconPackCss: "",
        device: "desktop",
        headingStyle: "default",
        layoutOrientation: "vertical",
        platform: "web",
        isElectron: false,
        hasNativeTitleBar: false,
        hasBackgroundEffects: true,
        currentLocale: { id: "en", rtl: false }
    });
}

// Main dispatch
async function dispatch(request) {
    const url = new URL(request.url);

    console.log("Dispatch ", url);
    // NOTE: your core router will do this later.
    if (request.method === "GET" && url.pathname === "/bootstrap") {
        return handleBootstrap();
    }

    if (url.pathname.startsWith("/api/echo")) {
        return jsonResponse({ ok: true, method: request.method, url: request.url });
    }

    return textResponse("Not found", 404);
}

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "LOCAL_REQUEST") return;

    const { id, request } = msg;

    try {
        const response = await dispatch(request);

        // Transfer body back (if any)
        self.postMessage({
            type: "LOCAL_RESPONSE",
            id,
            response
        }, response.body ? [response.body] : []);
    } catch (e) {
        self.postMessage({
            type: "LOCAL_RESPONSE",
            id,
            error: String(e?.message || e)
        });
    }
};
