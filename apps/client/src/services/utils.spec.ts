import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import utils, {
    arrayEqual,
    buildShareUrl,
    clearBrowserCache,
    createImageSrcUrl,
    escapeHtml,
    escapeQuotes,
    escapeRegExp,
    formatDateTime,
    formatSize,
    getErrorMessage,
    getSizeFromSvg,
    handleRightToLeftPlacement,
    isCtrlKey,
    isElectron,
    isHtmlEmpty,
    isLaunchBarConfig,
    isMac,
    isMobileApp,
    isPWA,
    isUpdateAvailable,
    mapToKeyValueArray,
    numberObjectsInPlace,
    openInAppHelpFromUrl,
    openInReusableSplit,
    randomString,
    reloadFrontendApp,
    replaceHtmlEscapedSlashes,
    restartDesktopApp,
    rootCauseMessage,
    toggleBodyClass
} from "./utils.js";

// `logInfo` / `logError` are normally attached to window/globalThis by ws.ts, which is mocked
// out by the test setup. Provide no-op globals so the few code paths that log don't crash.
beforeEach(() => {
    (globalThis as any).logInfo = vi.fn();
    (globalThis as any).logError = vi.fn();
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronApi;
    delete (navigator as any).standalone;
    delete (navigator as any).windowControlsOverlay;
});

describe("getSizeFromSvg", () => {
    it("parses width & height attribute", () => {
        const svg = `<svg aria-roledescription="sequence" role="graphics-document document" viewBox="-50 -10 714 574" height="574" xmlns="http://www.w3.org/2000/svg" width="714" id="mermaid-graph-2"></svg>`;
        const result = getSizeFromSvg(svg);
        expect(result).toMatchObject({
            width: 714,
            height: 574,
        });
    });

    it("parses viewbox", () => {
        const svg = `<svg aria-roledescription="er" role="graphics-document document" viewBox="0 0 872.2750244140625 655" style="max-width: 872.2750244140625px;" class="erDiagram" xmlns="http://www.w3.org/2000/svg" width="100%" id="mermaid-graph-2">`;
        const result = getSizeFromSvg(svg);
        expect(result).toMatchObject({
            width: 872.2750244140625,
            height: 655
        });
    });

    it("returns null and warns when neither dimensions nor viewBox are present", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const svg = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
        expect(getSizeFromSvg(svg)).toBeNull();
        expect(warn).toHaveBeenCalled();
    });
});

describe("string escaping helpers", () => {
    it("escapeHtml maps every special character", () => {
        expect(escapeHtml(`&<>"'/\`=`)).toBe("&amp;&lt;&gt;&quot;&#39;&#x2F;&#x60;&#x3D;");
    });

    it("escapeQuotes replaces all double quotes", () => {
        expect(escapeQuotes(`a"b"c`)).toBe("a&quot;b&quot;c");
    });

    it("escapeRegExp escapes regex metacharacters", () => {
        expect(escapeRegExp("a.b*c+(d)")).toBe("a\\.b\\*c\\+\\(d\\)");
    });

    it("replaceHtmlEscapedSlashes turns &#x2F; back into /", () => {
        expect(replaceHtmlEscapedSlashes("a&#x2F;b&#x2F;c")).toBe("a/b/c");
    });
});

describe("formatSize", () => {
    it("returns empty string for null/undefined", () => {
        expect(formatSize(null)).toBe("");
        expect(formatSize(undefined)).toBe("");
    });

    it("returns 0 B for zero", () => {
        expect(formatSize(0)).toBe("0 B");
    });

    it("formats bytes, KiB, MiB and GiB", () => {
        expect(formatSize(512)).toBe("512 B");
        expect(formatSize(2048)).toBe("2 KiB");
        expect(formatSize(5 * 1024 * 1024)).toBe("5 MiB");
        expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3 GiB");
    });
});

describe("formatDateTime / date helpers", () => {
    it("uses the default ISO date + time format when no custom format is given", () => {
        const date = new Date(2024, 0, 5, 9, 7); // local time -> 2024-01-05 09:07
        expect(formatDateTime(date)).toBe("2024-01-05 09:07");
    });

    it("uses a user-supplied dayjs format when provided", () => {
        const date = new Date(2024, 0, 5, 9, 7);
        expect(formatDateTime(date, "YYYY")).toBe("2024");
    });

    it("treats a whitespace-only custom format as absent", () => {
        const date = new Date(2024, 11, 31, 23, 59);
        expect(formatDateTime(date, "   ")).toBe("2024-12-31 23:59");
    });

    it("formatDateISO (via default export) pads month and day", () => {
        const date = new Date(2024, 2, 9); // March 9
        expect(utils.formatDateISO(date)).toBe("2024-03-09");
    });

    it("formatTime (via default export) pads hours and minutes", () => {
        const date = new Date(2024, 0, 1, 3, 4);
        expect(utils.formatTime(date)).toBe("03:04");
    });

    it("now() returns a HH:MM:SS string", () => {
        expect(utils.now()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("localNowDateTime() returns a dayjs formatted timestamp", () => {
        expect(utils.localNowDateTime()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\./);
    });
});

describe("parseDate (default export)", () => {
    it("parses a valid date string", () => {
        const result = utils.parseDate("2024-01-05T00:00:00Z");
        expect(result.getUTCFullYear()).toBe(2024);
    });

    it("wraps thrown errors with context", () => {
        // Force Date.parse to throw so the catch branch is exercised.
        const parseSpy = vi.spyOn(Date, "parse").mockImplementation(() => {
            throw new Error("boom");
        });
        expect(() => utils.parseDate("whatever")).toThrow(/Can't parse date from 'whatever': boom/);
        parseSpy.mockRestore();
    });
});

describe("formatTimeInterval (default export)", () => {
    it("returns days + hours when over a day", () => {
        const ms = ((1 * 24 + 3) * 60 + 0) * 60 * 1000; // 1 day 3 hours
        expect(utils.formatTimeInterval(ms)).toBe("1 day, 3 hours");
    });

    it("pluralizes multiple days", () => {
        const ms = 3 * 24 * 60 * 60 * 1000;
        expect(utils.formatTimeInterval(ms)).toBe("3 days");
    });

    it("returns minutes and seconds for small intervals", () => {
        const ms = (2 * 60 + 30) * 1000; // 2 min 30 s
        expect(utils.formatTimeInterval(ms)).toBe("2 minutes, 30 seconds");
    });

    it("omits seconds when at least 5 minutes have elapsed", () => {
        const ms = (10 * 60 + 30) * 1000; // 10 min 30 s -> seconds dropped
        expect(utils.formatTimeInterval(ms)).toBe("10 minutes");
    });

    it("returns a single second for one second", () => {
        expect(utils.formatTimeInterval(1000)).toBe("1 second");
    });

    it("returns an empty string for a zero interval", () => {
        expect(utils.formatTimeInterval(0)).toBe("");
    });
});

describe("isHtmlEmpty", () => {
    it("treats falsy / blank as empty", () => {
        expect(isHtmlEmpty("")).toBe(true);
        expect(isHtmlEmpty("<p>  </p>")).toBe(true);
    });

    it("detects content via img / section / link-mention", () => {
        expect(isHtmlEmpty("<IMG src='x'>")).toBe(false);
        expect(isHtmlEmpty("<SECTION></section>")).toBe(false);
        expect(isHtmlEmpty("<span class='link-mention'></span>")).toBe(false);
    });

    it("detects plain text content", () => {
        expect(isHtmlEmpty("<p>hello</p>")).toBe(false);
    });

    it("logs and returns false for a non-string input", () => {
        const logError = vi.fn();
        (globalThis as any).logError = logError;
        expect(isHtmlEmpty({} as any)).toBe(false);
        expect(logError).toHaveBeenCalled();
    });
});

describe("randomString", () => {
    it("returns a string of the requested length using the allowed alphabet", () => {
        const s = randomString(20);
        expect(s).toHaveLength(20);
        expect(s).toMatch(/^[A-Za-z0-9]+$/);
    });

    it("defaults to length 16", () => {
        expect(randomString()).toHaveLength(16);
    });
});

describe("platform / device detection", () => {
    it("isElectron reflects presence of window.electronApi", () => {
        expect(isElectron()).toBe(false);
        (window as any).electronApi = {};
        expect(isElectron()).toBe(true);
    });

    it("isMac reads navigator.platform", () => {
        const spy = vi.spyOn(navigator, "platform", "get");
        spy.mockReturnValue("MacIntel");
        expect(isMac()).toBe(true);
        spy.mockReturnValue("Win32");
        expect(isMac()).toBe(false);
    });

    it("isCtrlKey uses ctrlKey on non-Mac and metaKey on Mac", () => {
        const platformSpy = vi.spyOn(navigator, "platform", "get");
        platformSpy.mockReturnValue("Win32");
        expect(isCtrlKey({ ctrlKey: true, metaKey: false } as any)).toBe(true);
        expect(isCtrlKey({ ctrlKey: false, metaKey: true } as any)).toBe(false);

        platformSpy.mockReturnValue("MacIntel");
        expect(isCtrlKey({ ctrlKey: true, metaKey: false } as any)).toBe(false);
        expect(isCtrlKey({ ctrlKey: false, metaKey: true } as any)).toBe(true);
    });

    it("isMobileApp reflects Capacitor native platform", () => {
        expect(isMobileApp()).toBe(false);
        (window as any).Capacitor = { isNativePlatform: () => true };
        expect(isMobileApp()).toBe(true);
        delete (window as any).Capacitor;
    });

    it("isMobile / isDesktop respond to glob.device", () => {
        const original = window.glob.device;
        window.glob.device = "mobile";
        expect(utils.isMobile()).toBe(true);
        expect(utils.isDesktop()).toBe(false);

        window.glob.device = "desktop";
        expect(utils.isMobile()).toBe(false);
        expect(utils.isDesktop()).toBe(true);

        window.glob.device = original;
    });

    it("isMobile / isDesktop fall back to the user agent when device is unset", () => {
        const original = window.glob.device;
        window.glob.device = undefined as any;
        const uaSpy = vi.spyOn(navigator, "userAgent", "get");

        uaSpy.mockReturnValue("Mozilla/5.0 (Linux; Android) Mobile Safari");
        expect(utils.isMobile()).toBe(true);
        expect(utils.isDesktop()).toBe(false);

        uaSpy.mockReturnValue("Mozilla/5.0 (Windows NT 10.0) Safari");
        expect(utils.isMobile()).toBe(false);
        expect(utils.isDesktop()).toBe(true);

        window.glob.device = original;
    });

    it("isPWA detects standalone display mode", () => {
        const mmSpy = vi.spyOn(window, "matchMedia");
        mmSpy.mockImplementation((q: string) => ({ matches: q.includes("standalone") }) as MediaQueryList);
        expect(isPWA()).toBe(true);

        mmSpy.mockImplementation(() => ({ matches: false }) as MediaQueryList);
        expect(isPWA()).toBeFalsy();

        (navigator as any).standalone = true;
        expect(isPWA()).toBe(true);
    });
});

describe("isIOS (named export)", () => {
    it("returns true for iOS-like user agents and false otherwise", async () => {
        const { isIOS } = await import("./utils.js");
        const uaSpy = vi.spyOn(navigator, "userAgent", "get");
        uaSpy.mockReturnValue("iPad");
        expect(isIOS()).toBe(true);
        uaSpy.mockReturnValue("Windows");
        expect(isIOS()).toBe(false);
    });
});

describe("electron-aware helpers", () => {
    it("reloadFrontendApp uses electronApi when present and logs the reason", () => {
        const reloadAllWindows = vi.fn();
        (window as any).electronApi = { window: { reloadAllWindows } };
        reloadFrontendApp("a reason");
        expect((globalThis as any).logInfo).toHaveBeenCalled();
        expect(reloadAllWindows).toHaveBeenCalled();
    });

    it("reloadFrontendApp falls back to location.reload without electron and skips logging when no reason", () => {
        const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
        reloadFrontendApp();
        expect(reloadSpy).toHaveBeenCalled();
        expect((globalThis as any).logInfo).not.toHaveBeenCalled();
    });

    it("restartDesktopApp restarts via electron or reloads otherwise", () => {
        const restartApp = vi.fn();
        (window as any).electronApi = { window: { restartApp } };
        restartDesktopApp();
        expect(restartApp).toHaveBeenCalled();

        delete (window as any).electronApi;
        const reloadSpy = vi.spyOn(window.location, "reload").mockImplementation(() => {});
        restartDesktopApp();
        expect(reloadSpy).toHaveBeenCalled();
    });

    it("reloadTray invokes electron tray when present and is a no-op otherwise", () => {
        const reloadTray = vi.fn();
        (window as any).electronApi = { systemIntegration: { reloadTray } };
        utils.reloadTray();
        expect(reloadTray).toHaveBeenCalled();

        delete (window as any).electronApi;
        expect(() => utils.reloadTray()).not.toThrow();
    });

    it("reapplyLaunchOnStartup invokes electron systemIntegration when present and is a no-op otherwise", () => {
        const reapplyLaunchOnStartup = vi.fn();
        (window as any).electronApi = { systemIntegration: { reapplyLaunchOnStartup } };
        utils.reapplyLaunchOnStartup();
        expect(reapplyLaunchOnStartup).toHaveBeenCalled();

        delete (window as any).electronApi;
        expect(() => utils.reapplyLaunchOnStartup()).not.toThrow();
    });

    it("clearBrowserCache calls electron clearCache when available", async () => {
        const clearCache = vi.fn(async () => {});
        (window as any).electronApi = { window: { clearCache } };
        await clearBrowserCache();
        expect(clearCache).toHaveBeenCalled();

        delete (window as any).electronApi;
        await expect(clearBrowserCache()).resolves.toBeUndefined();
    });
});

describe("DOM / clipboard helpers (default export)", () => {
    it("assertArguments traces falsy arguments", () => {
        const trace = vi.spyOn(console, "trace").mockImplementation(() => {});
        utils.assertArguments("ok", "", "alsoOk");
        expect(trace).toHaveBeenCalledTimes(1);
    });

    it("setCookie writes a document.cookie entry", () => {
        utils.setCookie("myCookie", "myValue");
        expect(document.cookie).toContain("myCookie=myValue");
    });

    it("setCookie writes an empty value when falsy", () => {
        utils.setCookie("emptyCookie", "");
        expect(document.cookie).toContain("emptyCookie=");
    });

    it("getNoteTypeClass / getMimeTypeClass produce CSS-safe class names", () => {
        expect(utils.getNoteTypeClass("text")).toBe("type-text");
        expect(utils.getMimeTypeClass("")).toBe("");
        expect(utils.getMimeTypeClass("text/html; charset=utf-8")).toBe("mime-text-html");
        expect(utils.getMimeTypeClass("application/JSON")).toBe("mime-application-json");
    });

    it("copySelectionToClipboard writes the current selection", () => {
        const writeText = vi.fn();
        vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "hello" } as any);
        vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as any);
        utils.copySelectionToClipboard();
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("copySelectionToClipboard does nothing when there is no selection", () => {
        const writeText = vi.fn();
        vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as any);
        vi.spyOn(navigator, "clipboard", "get").mockReturnValue({ writeText } as any);
        utils.copySelectionToClipboard();
        expect(writeText).not.toHaveBeenCalled();
    });

    it("copyHtmlToClipboard sets clipboard data through the copy event", () => {
        const setData = vi.fn();
        // happy-dom doesn't implement execCommand; provide a stub that fires the copy event.
        const execSpy = vi.fn(() => {
            const evt: any = new Event("copy");
            evt.clipboardData = { setData };
            document.dispatchEvent(evt);
            return true;
        });
        (document as any).execCommand = execSpy;
        utils.copyHtmlToClipboard("<b>x</b>");
        expect(execSpy).toHaveBeenCalledWith("copy");
        expect(setData).toHaveBeenCalledWith("text/html", "<b>x</b>");
        expect(setData).toHaveBeenCalledWith("text/plain", "<b>x</b>");
        delete (document as any).execCommand;
    });

    it("copyHtmlToClipboard writes a distinct plain-text payload when given one", () => {
        const setData = vi.fn();
        const execSpy = vi.fn(() => {
            const evt: any = new Event("copy");
            evt.clipboardData = { setData };
            document.dispatchEvent(evt);
            return true;
        });
        (document as any).execCommand = execSpy;
        utils.copyHtmlToClipboard("<b>x</b>", "x");
        expect(setData).toHaveBeenCalledWith("text/html", "<b>x</b>");
        expect(setData).toHaveBeenCalledWith("text/plain", "x");
        delete (document as any).execCommand;
    });

    it("copyHtmlToClipboard tolerates a copy event without clipboardData", () => {
        const execSpy = vi.fn(() => {
            document.dispatchEvent(new Event("copy"));
            return true;
        });
        (document as any).execCommand = execSpy;
        expect(() => utils.copyHtmlToClipboard("<b>x</b>")).not.toThrow();
        expect(execSpy).toHaveBeenCalled();
        delete (document as any).execCommand;
    });

    it("triggerDownload creates and clicks an anchor", () => {
        const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        utils.triggerDownload("file.txt", "data:text/plain,hi");
        expect(clickSpy).toHaveBeenCalled();
    });

    it("initHelpDropdown stops propagation of clicks inside the dropdown menu", () => {
        const $el = window.$(`<div class="wrapper"><div class="help-dropdown"><div class="dropdown-menu"><a class="inner">x</a></div></div></div>`);
        utils.initHelpDropdown($el);
        const event = window.$.Event("click");
        $el.find(".help-dropdown .dropdown-menu").trigger(event);
        expect(event.isPropagationStopped()).toBe(true);
    });

    it("toggleBodyClass removes existing prefixed classes, keeps unrelated ones, and adds the new one", () => {
        const $body = window.$("body");
        $body.addClass("heading-style-old");
        $body.addClass("unrelated-class");
        toggleBodyClass("heading-style-", "markdown");
        expect($body.hasClass("heading-style-old")).toBe(false);
        expect($body.hasClass("unrelated-class")).toBe(true);
        expect($body.hasClass("heading-style-markdown")).toBe(true);
        $body.removeClass("heading-style-markdown unrelated-class");
    });
});

describe("formatHtml (default export)", () => {
    it("indents nested tags and preserves <pre> content", () => {
        const out = utils.formatHtml("<div><pre>raw   text</pre><span>hi</span></div>");
        expect(out).toContain("<pre>");
        expect(out).toContain("raw   text");
        expect(out).toContain("<span>");
        // Output begins with the first tag (leading newline stripped).
        expect(out.startsWith("<div>")).toBe(true);
    });

    it("handles self-closing tags", () => {
        const out = utils.formatHtml("<div><br><img src=x></div>");
        expect(out).toContain("<br>");
        expect(out).toContain("<img");
    });

    it("handles a close tag followed by trailing text and non-newline-leading output", () => {
        const out = utils.formatHtml("<div>x</div>y");
        // close tag chunk "</div>y" doesn't end with ">", and the result doesn't start with a newline
        expect(out).toBe("<div>\n\tx\n</div>\ny");
    });

    it("returns plain text unchanged when there are no tags", () => {
        expect(utils.formatHtml("text only no tags")).toBe("text only no tags");
    });

    it("tolerates a degenerate tag with no parseable tag name", () => {
        const out = utils.formatHtml("<div>a</>b</div>");
        expect(out).toContain("</>");
        expect(out).toContain("<div>");
    });
});

describe("timeLimit (default export)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("returns the input unchanged when it is not a promise", () => {
        expect(utils.timeLimit(42 as any, 1000)).toBe(42);
    });

    it("resolves when the promise settles before the limit (timer sees it as resolved)", async () => {
        const result = utils.timeLimit(Promise.resolve("done"), 1000);
        await expect(result).resolves.toBe("done");
        // Advance past the limit so the timeout callback runs and observes `resolved === true`.
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBe("done");
    });

    it("rejects with the custom message when the limit is exceeded", async () => {
        const never = new Promise(() => {});
        const limited = utils.timeLimit(never, 50, "too slow");
        const assertion = expect(limited).rejects.toThrow("too slow");
        await vi.advanceTimersByTimeAsync(60);
        await assertion;
    });

    it("uses a default error message when none is supplied", async () => {
        const never = new Promise(() => {});
        const limited = utils.timeLimit(never, 50);
        const assertion = expect(limited).rejects.toThrow(/Process exceeded time limit 50/);
        await vi.advanceTimersByTimeAsync(60);
        await assertion;
    });
});

describe("sleep (default export)", () => {
    it("resolves after the timer fires", async () => {
        vi.useFakeTimers();
        const p = utils.sleep(100);
        let resolved = false;
        p.then(() => (resolved = true));
        await vi.advanceTimersByTimeAsync(100);
        await p;
        expect(resolved).toBe(true);
        vi.useRealTimers();
    });
});

describe("attribute name helpers (default export)", () => {
    it("filterAttributeName keeps only letters, numbers, underscore and colon", () => {
        expect(utils.filterAttributeName("a b#c:d_1!")).toBe("abc:d_1");
    });

    it("isValidAttributeName validates against the allowed character set", () => {
        expect(utils.isValidAttributeName("valid_name:1")).toBe(true);
        expect(utils.isValidAttributeName("has space")).toBe(false);
        expect(utils.isValidAttributeName("")).toBe(false);
    });
});

describe("toObject (default export)", () => {
    it("builds a record from an array via the mapping function", () => {
        const result = utils.toObject([1, 2], (n) => [`k${n}`, n * 10]);
        expect(result).toEqual({ k1: 10, k2: 20 });
    });
});

describe("areObjectsEqual (default export)", () => {
    it("returns true with fewer than two arguments", () => {
        expect(utils.areObjectsEqual()).toBe(true);
        expect(utils.areObjectsEqual({ a: 1 })).toBe(true);
    });

    it("treats NaN as equal to NaN", () => {
        expect(utils.areObjectsEqual(NaN, NaN)).toBe(true);
    });

    it("compares primitives, functions, dates and regexes by value", () => {
        const fn = () => 1;
        expect(utils.areObjectsEqual(fn, fn)).toBe(true);
        expect(utils.areObjectsEqual(new Date(0), new Date(0))).toBe(true);
        expect(utils.areObjectsEqual(/abc/, /abc/)).toBe(true);
        expect(utils.areObjectsEqual(new String("x"), new String("x"))).toBe(true);
        expect(utils.areObjectsEqual(new Number(1), new Number(1))).toBe(true);
    });

    it("returns false when only one argument is a function", () => {
        // typeof x === "function" is true but typeof y === "function" is false, so the
        // function-vs-function short-circuit fails and the constructor check rejects them.
        expect(utils.areObjectsEqual(() => 1, {})).toBe(false);
    });

    it("returns false when one side is not an object", () => {
        expect(utils.areObjectsEqual({ a: 1 }, 5)).toBe(false);
    });

    it("returns false when prototypes are linked", () => {
        const proto = { a: 1 };
        const child = Object.create(proto);
        child.a = 1;
        expect(utils.areObjectsEqual(proto, child)).toBe(false);
    });

    it("returns false when constructors differ", () => {
        class A { x = 1; }
        class B { x = 1; }
        expect(utils.areObjectsEqual(new A(), new B())).toBe(false);
    });

    it("detects differing keys, types and nested objects", () => {
        expect(utils.areObjectsEqual({ a: 1 }, { b: 1 })).toBe(false);
        expect(utils.areObjectsEqual({ a: 1 }, { a: "1" })).toBe(false);
        expect(utils.areObjectsEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
        expect(utils.areObjectsEqual({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    });

    it("returns false when objects carry differing `prototype` own properties", () => {
        // Plain objects (same constructor) with a literal `prototype` property of differing value.
        expect(utils.areObjectsEqual({ prototype: 1, a: 1 }, { prototype: 2, a: 1 })).toBe(false);
    });

    it("returns false when the second loop finds a key missing on the other side", () => {
        // x has an extra own key that y lacks; y is a subset so the first loop passes.
        expect(utils.areObjectsEqual({ a: 1, extra: 2 }, { a: 1 })).toBe(false);
    });

    it("returns false when a non-enumerable own property differs in type in the second loop", () => {
        const x = { a: 1 };
        const y = {};
        // Non-enumerable so the first (for..in y) loop skips it, but hasOwnProperty still sees it.
        Object.defineProperty(y, "a", { value: "1", enumerable: false });
        expect(utils.areObjectsEqual(x, y)).toBe(false);
    });

    it("returns true for deeply equal objects", () => {
        expect(utils.areObjectsEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    });

    it("guards against infinite reference loops", () => {
        const x: any = { self: null };
        x.self = x;
        const y: any = { self: null };
        y.self = y;
        expect(utils.areObjectsEqual(x, y)).toBe(false);
    });
});

describe("createImageSrcUrl", () => {
    it("builds an encoded api/images URL", () => {
        const url = createImageSrcUrl({ noteId: "abc", title: "My Note/With Slash" } as any);
        expect(url).toMatch(/^api\/images\/abc\/My%20Note%2FWith%20Slash\?timestamp=\d+$/);
    });
});

describe("SVG downloads (default export)", () => {
    function captureDownload() {
        const downloads: { name: string | null, href: string | null }[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function(this: HTMLAnchorElement) {
            downloads.push({ name: this.getAttribute("download"), href: this.getAttribute("href") });
        });
        return downloads;
    }

    function captureObjectUrls() {
        const blobs: Blob[] = [];
        vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
            blobs.push(blob as Blob);
            return `blob:mock-${blobs.length}`;
        });
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        return blobs;
    }

    it("downloadSvg downloads the SVG string as a data URL (a blob-URL anchor click after " +
        "the export's awaits is silently blocked without user activation)", () => {
        const downloads = captureDownload();
        utils.downloadSvg("diagram", `<svg><text>a & b</text></svg>`);

        expect(downloads).toHaveLength(1);
        expect(downloads[0].name).toBe("diagram.svg");
        const href = downloads[0].href ?? "";
        expect(href.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
        expect(decodeURIComponent(href.split(",")[1])).toBe(`<svg><text>a & b</text></svg>`);
    });

    it("downloadSvgAsPng rasterizes at the given scale and downloads a PNG", async () => {
        const downloads = captureDownload();
        captureObjectUrls();
        const drawImage = vi.fn();
        const canvasSizes: { width: number, height: number }[] = [];
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as RenderingContext);
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function(this: HTMLCanvasElement) {
            canvasSizes.push({ width: this.width, height: this.height });
            return "data:image/png;base64,BBB";
        });
        vi.stubGlobal("Image", class {
            src = "";
            decode = vi.fn(async () => {});
        });

        try {
            await utils.downloadSvgAsPng("diagram", `<svg width="100" height="50"></svg>`);
        } finally {
            vi.unstubAllGlobals();
        }

        expect(canvasSizes).toEqual([ { width: 200, height: 100 } ]); // default scale is 2
        expect(drawImage).toHaveBeenCalled();
        expect(downloads).toEqual([ { name: "diagram.png", href: "data:image/png;base64,BBB" } ]);
    });

    it("downloadSvgAsPng rejects when the SVG has no usable dimensions", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        await expect(utils.downloadSvgAsPng("diagram", `<svg xmlns="http://www.w3.org/2000/svg"/>`))
            .rejects.toThrow("dimensions");
    });
});

describe("version comparison", () => {
    it("compareVersions handles greater/less/equal and prefixes", () => {
        expect(utils.compareVersions("v2.0.0", "1.9.9")).toBe(1);
        expect(utils.compareVersions("1.0.0", "2.0.0")).toBe(-1);
        expect(utils.compareVersions("1.0.0", "1.0.1")).toBe(-1);
        expect(utils.compareVersions("1.2.3", "1.2.3")).toBe(0);
        expect(utils.compareVersions("1.3.0", "1.2.0")).toBe(1);
        expect(utils.compareVersions("1.2.0", "1.3.0")).toBe(-1);
        expect(utils.compareVersions("1.2.4", "1.2.3")).toBe(1);
        expect(utils.compareVersions("1.0.0-beta", "1.0.0")).toBe(0);
    });

    it("pads shorter version strings with zeros before comparing", () => {
        // "1.2" -> [1,2,0] and "1" -> [1,0,0], exercising the zero-padding loops on both sides.
        expect(utils.compareVersions("1.2", "1.2.0")).toBe(0);
        expect(utils.compareVersions("1", "1.0.1")).toBe(-1);
        // Pad the second (right) version too.
        expect(utils.compareVersions("1.0.1", "1")).toBe(1);
    });

    it("isUpdateAvailable returns false for missing latest version", () => {
        expect(isUpdateAvailable(null, "1.0.0")).toBe(false);
        expect(isUpdateAvailable(undefined, "1.0.0")).toBe(false);
    });

    it("isUpdateAvailable compares the two versions", () => {
        expect(isUpdateAvailable("1.1.0", "1.0.0")).toBe(true);
        expect(isUpdateAvailable("1.0.0", "1.0.0")).toBe(false);
    });
});

describe("isLaunchBarConfig", () => {
    it("recognizes the launch bar config note ids", () => {
        expect(isLaunchBarConfig("_lbRoot")).toBe(true);
        expect(isLaunchBarConfig("_lbMobileVisibleLaunchers")).toBe(true);
        expect(isLaunchBarConfig("someOtherNote")).toBe(false);
    });
});

describe("array & object helpers", () => {
    it("arrayEqual covers identity, length and element comparisons", () => {
        const a = [1, 2, 3];
        expect(arrayEqual(a, a)).toBe(true);
        expect(arrayEqual([1, 2], [1, 2])).toBe(true);
        expect(arrayEqual([1, 2], [1, 2, 3])).toBe(false);
        expect(arrayEqual([1, 2], [1, 3])).toBe(false);
    });

    it("numberObjectsInPlace assigns sequential indices and returns the same array", () => {
        const items = [{ a: 1 }, { a: 2 }];
        const result = numberObjectsInPlace(items);
        expect(result).toBe(items as any);
        expect(result.map((i) => i.index)).toEqual([0, 1]);
    });

    it("mapToKeyValueArray turns a record into key/value pairs", () => {
        expect(mapToKeyValueArray({ a: 1, b: 2 })).toEqual([
            { key: "a", value: 1 },
            { key: "b", value: 2 }
        ]);
    });
});

describe("getErrorMessage", () => {
    it("extracts a message from error-like objects, else returns a fallback", () => {
        expect(getErrorMessage(new Error("kaboom"))).toBe("kaboom");
        expect(getErrorMessage({ message: "custom" })).toBe("custom");
        expect(getErrorMessage("plain string")).toBe("Unknown error");
        expect(getErrorMessage({ message: 5 })).toBe("Unknown error");
        expect(getErrorMessage(null)).toBe("Unknown error");
    });
});

describe("rootCauseMessage", () => {
    it("walks the cause chain to the bottom and returns the root message", () => {
        const root = new Error("boom");
        const middle = new Error(`Load of script note "B" (id2) failed with: boom`, { cause: root });
        const outer = new Error(`Load of script note "A" (id1) failed with: ...`, { cause: middle });
        expect(rootCauseMessage(outer)).toBe("boom");
    });

    it("returns the message of an unwrapped error or error-like object as-is", () => {
        expect(rootCauseMessage(new Error("plain"))).toBe("plain");
        expect(rootCauseMessage({ message: "server-side" })).toBe("server-side");
    });

    it("passes strings through and stringifies other primitives", () => {
        expect(rootCauseMessage("raw string")).toBe("raw string");
        expect(rootCauseMessage(42)).toBe("42");
        expect(rootCauseMessage(new Error("outer", { cause: "string cause" }))).toBe("string cause");
    });

    it("does not loop forever on a cyclic cause chain", () => {
        const self = new Error("self-cycle");
        self.cause = self;
        expect(rootCauseMessage(self)).toBe("self-cycle");

        // A longer cycle: a -> b -> a. Walking stops once a repeat is seen.
        const a = new Error("a");
        const b = new Error("b", { cause: a });
        a.cause = b;
        expect(rootCauseMessage(b)).toBe("a");
    });
});

describe("handleRightToLeftPlacement", () => {
    it("returns the placement unchanged in LTR mode", () => {
        const original = window.glob.isRtl;
        window.glob.isRtl = false;
        expect(handleRightToLeftPlacement("left")).toBe("left");
        window.glob.isRtl = original;
    });

    it("swaps left/right in RTL mode and leaves other values alone", () => {
        const original = window.glob.isRtl;
        window.glob.isRtl = true;
        expect(handleRightToLeftPlacement("left")).toBe("right");
        expect(handleRightToLeftPlacement("right")).toBe("left");
        expect(handleRightToLeftPlacement("top")).toBe("top");
        window.glob.isRtl = original;
    });
});

describe("buildShareUrl", () => {
    afterEach(() => {
        delete window.glob.httpBaseUrl;
    });

    it("prefers the injected httpBaseUrl (desktop renderer on trilium-app://)", () => {
        window.glob.httpBaseUrl = "http://127.0.0.1:37840";
        expect(buildShareUrl("abc")).toBe("http://127.0.0.1:37840/share/abc");
    });

    it("derives the URL from the page location in the browser", () => {
        expect(buildShareUrl("abc")).toBe(`${location.origin}${location.pathname}share/abc`);
    });
});

describe("openInReusableSplit / openInAppHelpFromUrl", () => {
    afterEach(() => {
        delete (window.glob as any).appContext;
    });

    it("does nothing when there is no active context", async () => {
        (window.glob as any).appContext = { tabManager: { getActiveContext: () => null } };
        await expect(openInReusableSplit("note1", "contextual-help")).resolves.toBeUndefined();
    });

    it("opens a new split when no sub-context matches the target view mode", async () => {
        const triggerCommand = vi.fn();
        const activeContext = {
            getSubContexts: () => [
                { viewScope: { viewMode: "default" }, ntxId: "ntx-last" }
            ]
        };
        (window.glob as any).appContext = {
            tabManager: { getActiveContext: () => activeContext },
            triggerCommand
        };
        await openInReusableSplit("note1", "contextual-help", { hoistedNoteId: "h1" });
        expect(triggerCommand).toHaveBeenCalledWith("openNewNoteSplit", {
            ntxId: "ntx-last",
            notePath: "note1",
            hoistedNoteId: "h1",
            viewScope: { viewMode: "contextual-help" }
        });
    });

    it("reuses an existing matching split", async () => {
        const setNote = vi.fn();
        const activeContext = {
            getSubContexts: () => [
                { viewScope: { viewMode: "contextual-help" }, setNote }
            ]
        };
        (window.glob as any).appContext = {
            tabManager: { getActiveContext: () => activeContext },
            triggerCommand: vi.fn()
        };
        await openInReusableSplit("note2", "contextual-help");
        expect(setNote).toHaveBeenCalledWith("note2", { viewScope: { viewMode: "contextual-help" } });
    });

    it("openInAppHelpFromUrl delegates to openInReusableSplit with the _help_ prefix", async () => {
        const setNote = vi.fn();
        const activeContext = {
            getSubContexts: () => [
                { viewScope: { viewMode: "contextual-help" }, setNote }
            ]
        };
        (window.glob as any).appContext = {
            tabManager: { getActiveContext: () => activeContext },
            triggerCommand: vi.fn()
        };
        await openInAppHelpFromUrl("MyPage");
        expect(setNote).toHaveBeenCalledWith("_help_MyPage", { viewScope: { viewMode: "contextual-help" } });
    });
});
