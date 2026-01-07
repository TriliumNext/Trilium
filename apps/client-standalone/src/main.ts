import { attachServiceWorkerBridge, startLocalServerWorker } from "./local-bridge.js";

async function waitForServiceWorkerControl(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        throw new Error("Service Worker not supported in this browser");
    }

    // If already controlling, we're good
    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker already controlling");
        return;
    }

    console.log("[Bootstrap] Waiting for service worker to take control...");

    // Register service worker
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "/" });
    
    // Wait for it to be ready (installed + activated)
    await navigator.serviceWorker.ready;

    // Check if we're now controlling
    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker now controlling");
        return;
    }

    // If not controlling yet, we need to reload the page for SW to take control
    // This is standard PWA behavior on first install
    console.log("[Bootstrap] Service worker installed but not controlling yet - reloading page");
    
    // Wait a tiny bit for SW to fully activate
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Reload to let SW take control
    window.location.reload();
    
    // Throw to stop execution (page will reload)
    throw new Error("Reloading for service worker activation");
}

async function fetchWithRetry(url: string, maxRetries = 3, delayMs = 500): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`[Bootstrap] Fetching ${url} (attempt ${attempt + 1}/${maxRetries})`);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Check if response has content
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error(`Invalid content-type: ${contentType || "none"}`);
            }
            
            return response;
        } catch (err) {
            lastError = err as Error;
            console.warn(`[Bootstrap] Fetch attempt ${attempt + 1} failed:`, err);
            
            if (attempt < maxRetries - 1) {
                // Exponential backoff
                const delay = delayMs * Math.pow(2, attempt);
                console.log(`[Bootstrap] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts: ${lastError?.message}`);
}

async function bootstrap() {
    /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.global = globalThis;

    try {
        // 1) Start local worker ASAP (so /bootstrap is fast)
        startLocalServerWorker();

        // 2) Bridge SW -> local worker
        attachServiceWorkerBridge();

        // 3) Wait for service worker to control the page (may reload on first install)
        await waitForServiceWorkerControl();

        // 4) Now fetch bootstrap - SW is guaranteed to intercept this
        await setupGlob();
        
        loadStylesheets();
        loadIcons();
        setBodyAttributes();
        await loadScripts();
    } catch (err) {
        // If error is from reload, it will stop here (page reloads)
        // Otherwise, show error to user
        if (err instanceof Error && err.message.includes("Reloading")) {
            // Page is reloading, do nothing
            return;
        }
        
        console.error("[Bootstrap] Fatal error:", err);
        document.body.innerHTML = `
            <div style="padding: 40px; max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif;">
                <h1 style="color: #d32f2f;">Failed to Initialize</h1>
                <p>The application failed to start. Please check the browser console for details.</p>
                <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto;">${err instanceof Error ? err.message : String(err)}</pre>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                    Reload Page
                </button>
            </div>
        `;
        document.body.style.display = "block";
    }
}

async function setupGlob() {
    const response = await fetchWithRetry("/bootstrap");
    console.log("Service worker state", navigator.serviceWorker.controller);
    console.log("Resp", response);
    const json = await response.json();
    console.log("Bootstrap", json);

    window.glob = {
        ...json,
        activeDialog: null
    };
}

function loadStylesheets() {
    const { assetPath, themeCssUrl, themeUseNextAsBase } = window.glob;
    const cssToLoad = [];
    cssToLoad.push(`${assetPath}/stylesheets/theme-light.css`);
    if (themeCssUrl) {
        cssToLoad.push(themeCssUrl);
    }
    if (themeUseNextAsBase === "next") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next.css`)
    } else if (themeUseNextAsBase === "next-dark") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-dark.css`)
    } else if (themeUseNextAsBase === "next-light") {
        cssToLoad.push(`${assetPath}/stylesheets/theme-next-light.css`)
    }
    cssToLoad.push(`${assetPath}/stylesheets/style.css`);

    for (const href of cssToLoad) {
        const linkEl = document.createElement("link");
        linkEl.href = href;
        linkEl.rel = "stylesheet";
        document.body.appendChild(linkEl);
    }
}

function loadIcons() {
    const styleEl = document.createElement("style");
    styleEl.innerText = window.glob.iconPackCss;
    document.head.appendChild(styleEl);
}

function setBodyAttributes() {
    const { device, headingStyle, layoutOrientation, platform, isElectron, hasNativeTitleBar, hasBackgroundEffects, currentLocale } = window.glob;
    const classesToSet = [
        device,
        `heading-style-${headingStyle}`,
        `layout-${layoutOrientation}`,
        `platform-${platform}`,
        isElectron && "isElectron",
        hasNativeTitleBar && "native-titlebar",
        hasBackgroundEffects && "background-effects"
    ].filter(Boolean);

    for (const classToSet of classesToSet) {
        document.body.classList.add(classToSet);
    }

    document.body.lang = currentLocale.id;
    document.body.dir = currentLocale.rtl ? "rtl" : "ltr";
}

async function loadScripts() {
    await import("./runtime.js");
    await import("./desktop.js");
}

bootstrap();
