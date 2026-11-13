/**
 * A browser session on a running Trilium instance, for `live.mjs` and `simulate.mjs`: one text
 * note in a tab of its own, with Vim mode on and every write to the server held.
 */
import { chromium } from "playwright";

const SPECIAL_KEYS = {
    Esc: "Escape", CR: "Enter", BS: "Backspace", Del: "Delete", Tab: "Tab", Space: " ",
    Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Home: "Home",
    End: "End", PageUp: "PageUp", PageDown: "PageDown", lt: "<"
};
const MODIFIERS = { C: "Control", S: "Shift", A: "Alt", M: "Meta" };

/**
 * The POST requests that only read. `search-and-execute-note` also starts with `search` and runs
 * bulk actions, so each path is matched whole.
 */
const READ_REQUESTS =
    /\/api\/(tree\/load|search-note\/[^/]+\/result-details|search-related|search\/lint)$/u;

/** The elements that can hold the focus while keys go to Vim mode. */
const FOCUS_ROOTS = ".note-split, .vim-command-line-slot, .ck-vim-command-line-panel, "
    + ".ck-body-wrapper";

/** How long the first page load can take while Vite optimizes the dependencies. */
const LOAD_TIMEOUT = 300_000;

/**
 * How many times one session loads the page. The server limits the loads of the root page for
 * each address (`rootLimiter` in `apps/server/src/routes/assets.ts`), and a page load counts
 * twice.
 */
const MAX_LOADS = 30;

/** A mistake in how a script was called, which is reported without a stack. */
export class UsageError extends Error {}

/**
 * Reads the options of a session from `argv`. Arguments it does not know stay in `rest`, in their
 * order, for the script that calls it.
 */
export function parseArgs(argv) {
    const parsed = {
        url: process.env.TRILIUM_URL ?? "http://127.0.0.1:37999/",
        noteId: process.env.TRILIUM_NOTE_ID ?? null,
        isNoteCreated: false,
        content: null,
        options: { textNoteVimModeEnabled: "true" },
        delay: null,
        isHeaded: false,
        isJson: false,
        rest: []
    };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = () => {
            const value = argv[++index];
            if (value === undefined) {
                throw new UsageError(`${arg} needs a value.`);
            }
            return value;
        };
        switch (arg) {
            case "--url":
                parsed.url = next();
                break;
            case "--note":
                parsed.noteId = next();
                break;
            case "--create-note":
                parsed.isNoteCreated = true;
                break;
            case "--content":
                parsed.content = next();
                break;
            case "--option": {
                const [ name, ...value ] = next().split("=");
                parsed.options[name] = value.join("=");
                break;
            }
            case "--delay":
                parsed.delay = Number(next());
                break;
            case "--headed":
                parsed.isHeaded = true;
                break;
            case "--json":
                parsed.isJson = true;
                break;
            default:
                parsed.rest.push(arg);
        }
    }
    if (!parsed.noteId && !parsed.isNoteCreated) {
        throw new UsageError("Name a text note with --note <noteId>, or pass --create-note.");
    }
    return parsed;
}

/** Opens the instance, the note in a tab of its own, and Vim mode in its editor. */
export async function openSession(options) {
    const browser = await chromium.launch({ headless: !options.isHeaded });
    const context = await browser.newContext({
        viewport: { width: 1400, height: 900 },
        permissions: [ "clipboard-read", "clipboard-write" ]
    });
    const page = await context.newPage();
    const errors = [];
    const heldWrites = [];
    const checks = [];
    let allowedCreations = 0;
    let loads = 0;
    let noteId = options.noteId;
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        // A resource that the server refuses is not an error of the page's code.
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
            errors.push(`console: ${message.text()}`);
        }
    });

    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const method = request.method();
        const path = new URL(request.url()).pathname;
        if (/\/api\/options$/u.test(path) && method === "GET") {
            const response = await route.fetch();
            const json = { ...await response.json(), ...options.options };
            await route.fulfill({ response, json });
        } else if (method === "GET" || (method === "POST" && READ_REQUESTS.test(path))) {
            await route.fallback();
        } else if (allowedCreations > 0 && /\/api\/notes\/root\/children$/u.test(path)) {
            allowedCreations--;
            await route.fallback();
        } else {
            heldWrites.push(`${method} ${path}`);
            await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
        }
    });

    async function load() {
        if (++loads > MAX_LOADS) {
            throw new UsageError(`The page was loaded ${MAX_LOADS} times. The server allows `
                + "about 50 loads in 15 minutes for each address, so the run stops here.");
        }
        await page.goto(options.url, { timeout: LOAD_TIMEOUT });
        await page.waitForSelector("input[type=password], #root-widget", { timeout: LOAD_TIMEOUT });
        // The app has password fields of its own, as for a protected note; the login page has
        // no root widget.
        if (!await page.$("#root-widget")) {
            const password = process.env.TRILIUM_PASSWORD;
            if (!password) {
                throw new UsageError("The instance asks for a password: set TRILIUM_PASSWORD.");
            }
            await page.fill("input[type=password]", password);
            await Promise.all([
                page.waitForNavigation({ timeout: LOAD_TIMEOUT }),
                page.press("input[type=password]", "Enter")
            ]);
            await page.waitForSelector("#root-widget", { timeout: LOAD_TIMEOUT });
        }
        await page.waitForFunction(
            () => window.glob?.appContext?.tabManager?.getActiveContext?.(), null,
            { timeout: LOAD_TIMEOUT });
        if (!noteId) {
            allowedCreations = 1;
            noteId = await page.evaluate(createScratchNote);
        }
        await page.evaluate(openNoteTab, noteId);
        await page.evaluate(installPageHelpers);
        await page.waitForFunction(() => window.__vimEditor()?.state === "ready", null,
            { timeout: 60_000 });
        try {
            await page.waitForFunction(() => window.__vim.plugin().isActive, null,
                { timeout: 15_000 });
        } catch {
            throw new UsageError("Vim mode did not start. The note must be a text note without "
                + "#vimMode=false, shown in the desktop layout.");
        }
        await focusEditor();
    }

    async function focusEditor() {
        await page.evaluate(() => window.__vimEditor().editing.view.focus());
        // The editor restores its last caret a moment after it gets the focus.
        await page.waitForTimeout(300);
    }

    /**
     * Presses `sequence`, keys in Vim notation, in the element that has the focus. `delay` is the
     * pause after each key.
     */
    async function keys(sequence, delay = options.delay ?? 25) {
        for (const key of splitKeys(sequence)) {
            const strayFocus = await page.evaluate((roots) => {
                const active = document.activeElement;
                return active?.closest(roots)
                    ? null
                    : `${active?.tagName}.${String(active?.className).slice(0, 60)}`;
            }, FOCUS_ROOTS);
            if (strayFocus) {
                throw new Error(`The focus left the editor (${strayFocus}); no key was sent.`);
            }
            await pressKey(page, key);
            if (delay) {
                await page.waitForTimeout(delay);
            }
        }
        await page.waitForTimeout(Math.min(60, 2 * delay + 10));
    }

    const session = {
        page,
        errors,
        heldWrites,
        keys,
        get noteId() {
            return noteId;
        },
        /**
         * What Vim mode shows: the mode, the cursor, the selection, and unless `isBrief`, the
         * lines and the HTML of the note.
         */
        state: (isBrief = false) => page.evaluate((brief) => window.__vim.state(brief), isBrief),
        /** Runs `fn` in the page, where `window.__vimEditor()` and `window.__vim` are. */
        evaluate: (fn, arg) => page.evaluate(fn, arg),
        /**
         * Loads `html` into the editor and starts Vim mode again in Normal mode, at the start of
         * the note, with an empty undo history. The registers and mappings of the page stay.
         */
        async setContent(html) {
            await focusEditor();
            await page.evaluate(async (content) => {
                const editor = window.__vimEditor();
                const vim = window.__vim.plugin();
                await vim.setEnabled(false);
                editor.setData(content);
                editor.model.change((writer) =>
                    writer.setSelection(editor.model.document.getRoot(), 0));
                window.__vim.clearHistory();
                await vim.setEnabled(true);
            }, html);
            await page.waitForTimeout(100);
        },
        /** Loads the page again: a new engine, with no registers, mappings or search. */
        reload: load,
        /** Records a check. `expected` is a value, or a function that judges `actual`. */
        check(name, actual, expected) {
            const isPass = typeof expected === "function"
                ? !!expected(actual)
                : JSON.stringify(actual) === JSON.stringify(expected);
            checks.push({ name, isPass });
            console.log(`${isPass ? "PASS" : "FAIL"} ${name}`);
            if (!isPass) {
                console.log(`     actual:   ${JSON.stringify(actual)}`);
                console.log(`     expected: ${typeof expected === "function"
                    ? expected.toString()
                    : JSON.stringify(expected)}`);
            }
            return isPass;
        },
        /**
         * Closes the browser and prints the summary. Returns whether something failed: a check
         * or the page.
         */
        async close() {
            await browser.close();
            const failed = checks.filter((each) => !each.isPass);
            if (checks.length) {
                console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
            }
            console.log(`held writes: ${heldWrites.length}`);
            console.log(`page errors: ${errors.length}`);
            for (const error of errors.slice(0, 20)) {
                console.log(`  ${error}`);
            }
            return failed.length > 0 || errors.length > 0;
        }
    };

    try {
        await load();
    } catch (error) {
        await browser.close();
        throw error;
    }
    return session;
}

/** The keys of `sequence`, each a character or a `<…>` name. */
export function splitKeys(sequence) {
    return sequence.match(/<[^<>]+>|./gsu) ?? [];
}

async function pressKey(page, key) {
    const named = /^<((?:[CSAM]-)*)(.+)>$/u.exec(key);
    if (!named) {
        await page.keyboard.type(key);
        return;
    }
    const modifiers = named[1].split("-").filter(Boolean).map((name) => MODIFIERS[name]);
    const name = SPECIAL_KEYS[named[2]] ?? named[2];
    if (!modifiers.length && name.length === 1) {
        await page.keyboard.type(name);
    } else {
        await page.keyboard.press([ ...modifiers, name ].join("+"));
    }
}

/** Runs in the page: creates a text note under the root and returns its ID. */
async function createScratchNote() {
    const response = await fetch("api/notes/root/children?target=into&targetBranchId=", {
        method: "POST",
        headers: { ...await window.glob.getHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Vim live test", type: "text", content: "<p></p>" })
    });
    const { note } = await response.json();
    await window.glob.froca.getNote(note.noteId);
    return note.noteId;
}

/** Runs in the page: opens `noteId` in a new tab, editable whatever its size. */
async function openNoteTab(noteId) {
    const { appContext } = window.glob;
    const context = await appContext.tabManager.openTabWithNoteWithHoisting(noteId,
        { activate: true });
    // A large note opens read-only, which this tab alone lifts.
    context.viewScope.readOnlyTemporarilyDisabled = true;
    appContext.triggerEvent("readOnlyTemporarilyDisabled", { noteContext: context });
    window.__vimNtxId = context.ntxId;
}

/** Runs in the page: `window.__vimEditor()` and `window.__vim`, scoped to the tab of the test. */
function installPageHelpers() {
    window.__vimEditor = () => {
        const split = document.querySelector(`.note-split[data-ntx-id="${window.__vimNtxId}"]`);
        const roots = [ ...split?.querySelectorAll(".ck-editor__editable") ?? [] ];
        // The editor of the note is the one that no other editable contains.
        const root = roots.find((element) => element.ckeditorInstance
            && !element.parentElement.closest(".ck-editor__editable"));
        return root?.ckeditorInstance;
    };
    const editor = () => window.__vimEditor();
    const plugin = () => editor().plugins.get("TriliumVim");
    const adapter = () => plugin().session?.adapter;

    // The time of the keydown handlers, and of the style and layout work that they leave behind.
    const timing = { isOn: false, handlers: 0, layout: 0, keys: 0 };
    const channel = new MessageChannel();
    const jobs = [];
    channel.port1.onmessage = () => jobs.shift()?.();
    window.addEventListener("keydown", () => {
        if (!timing.isOn) {
            return;
        }
        const start = performance.now();
        jobs.push(() => {
            const handled = performance.now();
            document.body.getBoundingClientRect();
            timing.handlers += handled - start;
            timing.layout += performance.now() - handled;
            timing.keys++;
        });
        channel.port2.postMessage(0);
    }, true);

    const attributesOf = (node) => [ ...node.getAttributes() ]
        .map(([ key, value ]) => `${key}=${JSON.stringify(value)}`).sort().join(";");

    window.__vim = {
        plugin,
        /** The session, whose `engine` and `vim` state are private in TypeScript only. */
        session: () => plugin().session,
        adapter,
        lines() {
            const lines = [];
            for (let line = 0; adapter() && line <= adapter().lastLine(); line++) {
                lines.push(adapter().getLine(line));
            }
            return lines;
        },
        /** The kind of each line: the names of its containers and of its block or widget. */
        kinds() {
            const index = adapter().index();
            return index.lines.map((_line, line) => {
                const element = index.getElement(line);
                const names = element.getAncestors().slice(1).map((ancestor) => ancestor.name);
                const list = element.hasAttribute("listType")
                    ? `(${element.getAttribute("listType")}${element.getAttribute("listIndent")})`
                    : "";
                return [ ...names, `${element.name}${list}` ].join(">");
            });
        },
        /** Puts the cursor on line `line`, column `ch`, as a motion of Vim does. */
        goto(line, ch = 0) {
            adapter().operation(() => adapter().setCursor(line, ch));
        },
        /**
         * A hash of the content. Fold states are left out, since undo does not bring them back,
         * and list items are numbered in their order, since each load gives them new IDs.
         */
        hash() {
            const itemIds = new Map();
            const data = editor().getData().replaceAll(" data-trilium-collapsed=\"true\"", "")
                .replaceAll(/(<details[^>]*?) open=""/gu, "$1")
                .replaceAll(/data-list-item-id="([^"]*)"/gu, (_match, id) => {
                    itemIds.set(id, itemIds.get(id) ?? itemIds.size);
                    return `data-list-item-id="${itemIds.get(id)}"`;
                });
            let hash = 5381;
            for (let index = 0; index < data.length; index++) {
                hash = ((hash << 5) + hash + data.charCodeAt(index)) | 0;
            }
            return hash >>> 0;
        },
        /** Empties the registers and forgets the last search, so that a case starts clean. */
        clearState() {
            const engine = plugin().session.engine;
            for (const register of Object.values(engine.getRegisterController().registers)) {
                register.clear();
            }
            const global = engine.getVimGlobalState_();
            global.query = undefined;
            global.lastSubstituteReplacePart = undefined;
        },
        /** Empties the undo and redo history, so that what follows is all there is to undo. */
        clearHistory() {
            editor().commands.get("undo").clearStack();
            editor().commands.get("redo").clearStack();
        },
        startTiming() {
            Object.assign(timing, { isOn: true, handlers: 0, layout: 0, keys: 0 });
        },
        /** The milliseconds that the keys since `startTiming()` cost, handlers and layout. */
        stopTiming() {
            return new Promise((resolve) => setTimeout(() => {
                timing.isOn = false;
                resolve(Math.round(timing.handlers + timing.layout));
            }));
        },
        /**
         * What is wrong with the model: content or attributes that the schema does not allow,
         * broken lists, containers left without what they need, a selection outside the note.
         */
        validate() {
            const model = editor().model;
            const schema = model.schema;
            const problems = [];
            const walk = (parent, path) => {
                let previous = null;
                let previousItem = null;
                for (const child of parent.getChildren()) {
                    const name = child.is("$text") ? "$text" : child.name;
                    const here = `${path}/${name}`;
                    if (!schema.checkChild(parent, child)) {
                        problems.push(`${here}: not allowed in ${parent.name}`);
                    }
                    for (const [ key ] of child.getAttributes()) {
                        if (!key.startsWith("selection:") && !schema.checkAttribute(child, key)) {
                            problems.push(`${here}: attribute ${key} not allowed`);
                        }
                    }
                    if (child.is("$text")) {
                        const isSplit = previous?.is("$text")
                            && attributesOf(previous) === attributesOf(child);
                        if (isSplit) {
                            problems.push(`${here}: two text nodes with the same attributes`);
                        }
                        previous = child;
                        continue;
                    }
                    if (child.hasAttribute("listItemId")) {
                        const indent = Number(child.getAttribute("listIndent"));
                        const before = previousItem
                            ? Number(previousItem.getAttribute("listIndent"))
                            : -1;
                        if (indent > before + 1) {
                            problems.push(`${here}: list indent jumps from ${before} to ${indent}`);
                        }
                        previousItem = child;
                    } else {
                        previousItem = null;
                    }
                    if (child.is("element", "details")
                        && !child.getChild(0)?.is("element", "summary")) {
                        problems.push(`${here}: no title first`);
                    }
                    const isBox = schema.isLimit(child) && !schema.isObject(child)
                        && schema.checkChild(child, "paragraph");
                    if (isBox && child.isEmpty) {
                        problems.push(`${here}: empty`);
                    }
                    walk(child, here);
                    previous = child;
                }
            };
            const root = model.document.getRoot();
            walk(root, "");
            for (const range of model.document.selection.getRanges()) {
                for (const position of [ range.start, range.end ]) {
                    if (position.root !== root || position.offset > position.parent.maxOffset) {
                        problems.push("the selection is outside the note");
                    }
                }
            }
            const cursors = editor().ui.getEditableElement().querySelectorAll(".ck-vim-cursor");
            if (plugin().status.mode === "insert" && cursors.length) {
                problems.push("a block cursor shows in Insert mode");
            }
            return problems.slice(0, 20);
        },
        /** What Vim mode shows. With `isBrief`, without the lines and the HTML of the note. */
        state(isBrief = false) {
            const status = plugin().status;
            const cursor = adapter()?.getCursor();
            const input = status.commandLine?.element.querySelector("input");
            return {
                mode: status.mode,
                isOneCommand: status.isOneCommand,
                cursor: cursor ? `${cursor.line}:${cursor.ch}` : null,
                pending: status.pendingKeys,
                recording: status.recording,
                message: status.message?.text ?? null,
                commandLine: input ? input.value : null,
                isSelectionCollapsed: editor().model.document.selection.isCollapsed,
                isWidgetSelected: adapter()?.getSelectedObjectLine() !== null,
                ...isBrief ? {} : { lines: this.lines(), data: editor().getData() }
            };
        }
    };
}
