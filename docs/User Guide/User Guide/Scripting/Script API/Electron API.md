# Electron API
The Electron API is the bridge between Trilium's interface and Electron's main process, exposed as the global `window.electronApi` in the desktop application.

It is not part of the `api` global of script notes, but frontend scripts running in the desktop application can call it directly. It is `undefined` in the browser and in the standalone build, so guard calls with `if (window.electronApi)`.

## <a id="type-Api"></a>`Api`

The complete surface exposed to the renderer as `window.electronApi` via `contextBridge`. The renderer must access Electron-only functionality through this object — direct `require("electron")` and `@electron/remote` are unavailable because `nodeIntegration` is disabled and `contextIsolation` is enabled.

The runtime value lives in `apps/desktop/src/preload.ts`; this interface is the contract both the preload script (`satisfies ElectronApi`) and the client (`window.electronApi`) share.

| Property | Description |
| --- | --- |
| `window` | [`WindowApi`](#type-WindowApi)  <br>Window chrome, zoom, theme, lifecycle, and main → renderer events. |
| `clipboard` | [`ClipboardApi`](#type-ClipboardApi)  <br>System clipboard access beyond what the standard Web Clipboard API offers. |
| `shell` | [`ShellApi`](#type-ShellApi)  <br>Shell integration — opening URLs, files, and downloads with OS handlers. |
| `contextMenu` | [`ContextMenuApi`](#type-ContextMenuApi)  <br>Native context-menu plumbing for right-click events on web contents. |
| `spellcheck` | [`SpellcheckApi`](#type-SpellcheckApi)  <br>Chromium spell checker controls (dictionary, language list). |
| `systemIntegration` | [`SystemIntegrationApi`](#type-SystemIntegrationApi)  <br>OS integration — system tray and autostart / launch-on-login. |
| `printing` | [`PrintingApi`](#type-PrintingApi)  <br>Printing and PDF export pipeline. |
| `navigation` | [`NavigationApi`](#type-NavigationApi)  <br>Read/write access to Chromium's back/forward navigation history. |
| `ws` | [`WsApi`](#type-WsApi)  <br>In-process bridge that replaces the renderer↔server WebSocket. |
| `security` | [`SecurityApi`](#type-SecurityApi)  <br>Security settings (backend scripting, SQL console) stored outside the DB. |
| `backupPassphrase` | [`BackupPassphraseApi`](#type-BackupPassphraseApi)  <br>Write-only access to the backup passphrase, kept in the OS keyring. |
| `onenote` | [`OneNoteApi`](#type-OneNoteApi)  <br>OneNote importer sign-in via a loopback OAuth redirect (desktop only). |
| `nativeExport` | [`NativeExportApi`](#type-NativeExportApi)  <br>Desktop-native subtree export that streams a `.zip` straight to a file. |
| `nativeImport` | [`NativeImportApi`](#type-NativeImportApi)  <br>Desktop-native large-`.zip` import that reads the user's file in place via a capability token. |
| `dialog` | [`DialogApi`](#type-DialogApi)  <br>Native OS pickers that hand the renderer a location the user chose themselves. |
| `restore` | [`RestoreApi`](#type-RestoreApi)  <br>Choosing a backup to restore during setup, read where it lies rather than uploaded. |
| `transcription` | [`TranscriptionApi`](#type-TranscriptionApi)  <br>Meeting transcription: starting and stopping a recording, and following its state. |

## <a id="type-WindowApi"></a>`WindowApi`

Window-level controls: zoom, theme, title bar, full screen, lifecycle, and a handful of main → renderer event subscriptions.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>setZoomFactor</code></td>
            <td><pre><code class="language-application-typescript">setZoomFactor(factor: number): void</code></pre><p>Sets the page zoom factor for the current window.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>factor</code></td><td><code>number</code><br><code>1.0</code> is 100%; e.g. <code>1.2</code> zooms to 120%.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getZoomFactor</code></td>
            <td><pre><code class="language-application-typescript">getZoomFactor(): number</code></pre><p>Returns the current page zoom factor (<code>1.0</code> = 100%).</p></td>
        </tr>
        <tr>
            <td><code>setNativeThemeSource</code></td>
            <td><pre><code class="language-application-typescript">setNativeThemeSource(source: "system" | "light" | "dark"): void</code></pre><p>Overrides the operating system's reported color scheme for this app.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>source</code></td><td><code>"system" | "light" | "dark"</code><br>The color scheme to report, or <code>"system"</code> to follow the OS setting.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setTitleBarOverlay</code></td>
            <td><pre><code class="language-application-typescript">setTitleBarOverlay(options: { color: string; symbolColor: string; height?: number }): void</code></pre><p>Customizes the Windows and Linux native title bar overlay (the area containing the minimize / maximize / close buttons). <code>height</code> also controls their vertical placement, since the buttons are centered within the overlay. It is given in device-independent pixels, which the page zoom does not scale — see <code>setWindowButtonPosition</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>options</code></td><td><code>{ color: string; symbolColor: string; height?: number }</code><br>The overlay's background color, the color of the button symbols, and the overlay's height.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setWindowButtonPosition</code></td>
            <td><pre><code class="language-application-typescript">setWindowButtonPosition(position: { x: number; y: number }): void</code></pre><p>Repositions the macOS traffic-light window buttons. Coordinates are relative to the window's top-left corner and given in device-independent pixels: the buttons are drawn by the system rather than by the page, so unlike the surrounding chrome they are unaffected by the page zoom factor and callers have to scale the offsets themselves.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>position</code></td><td><code>{ x: number; y: number }</code><br>The offset of the buttons from the window's top-left corner.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onEnterFullScreen</code></td>
            <td><pre><code class="language-application-typescript">onEnterFullScreen(callback: () =&gt; void): void</code></pre><p>Registers a callback fired whenever the window enters full-screen mode.</p></td>
        </tr>
        <tr>
            <td><code>onLeaveFullScreen</code></td>
            <td><pre><code class="language-application-typescript">onLeaveFullScreen(callback: () =&gt; void): void</code></pre><p>Registers a callback fired whenever the window leaves full-screen mode.</p></td>
        </tr>
        <tr>
            <td><code>isFullScreen</code></td>
            <td><pre><code class="language-application-typescript">isFullScreen(): boolean</code></pre><p>Synchronously returns whether the window is currently in full-screen mode.</p></td>
        </tr>
        <tr>
            <td><code>setFullScreen</code></td>
            <td><pre><code class="language-application-typescript">setFullScreen(enabled: boolean): void</code></pre><p>Enters or leaves full-screen mode.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to enter full-screen mode, <code>false</code> to leave it.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>minimizeWindow</code></td>
            <td><pre><code class="language-application-typescript">minimizeWindow(): void</code></pre><p>Minimizes the current window to the taskbar / dock.</p></td>
        </tr>
        <tr>
            <td><code>maximizeWindow</code></td>
            <td><pre><code class="language-application-typescript">maximizeWindow(): void</code></pre><p>Maximizes the current window to fill the available screen area.</p></td>
        </tr>
        <tr>
            <td><code>unmaximizeWindow</code></td>
            <td><pre><code class="language-application-typescript">unmaximizeWindow(): void</code></pre><p>Restores the window from a maximized state to its previous size.</p></td>
        </tr>
        <tr>
            <td><code>isMaximized</code></td>
            <td><pre><code class="language-application-typescript">isMaximized(): boolean</code></pre><p>Synchronously returns whether the window is currently maximized.</p></td>
        </tr>
        <tr>
            <td><code>closeWindow</code></td>
            <td><pre><code class="language-application-typescript">closeWindow(): void</code></pre><p>Closes the current window.</p></td>
        </tr>
        <tr>
            <td><code>isAlwaysOnTop</code></td>
            <td><pre><code class="language-application-typescript">isAlwaysOnTop(): boolean</code></pre><p>Synchronously returns whether the window is pinned above all others.</p></td>
        </tr>
        <tr>
            <td><code>setAlwaysOnTop</code></td>
            <td><pre><code class="language-application-typescript">setAlwaysOnTop(enabled: boolean): void</code></pre><p>Pins the window above all others, or unpins it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to pin the window, <code>false</code> to unpin it.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>toggleDevTools</code></td>
            <td><pre><code class="language-application-typescript">toggleDevTools(): void</code></pre><p>Opens or closes Chromium DevTools for the current window.</p></td>
        </tr>
        <tr>
            <td><code>isDevToolsDocked</code></td>
            <td><pre><code class="language-application-typescript">isDevToolsDocked(): boolean</code></pre><p>Synchronously returns whether DevTools is currently open and docked into this window (as opposed to detached into a separate window).</p></td>
        </tr>
        <tr>
            <td><code>setBackgroundMaterial</code></td>
            <td><pre><code class="language-application-typescript">setBackgroundMaterial(material: string): void</code></pre><p>Sets the Windows 11 backdrop material applied behind the window contents. No-op on other platforms.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>material</code></td><td><code>string</code><br>The material, such as <code>"mica"</code>, <code>"acrylic"</code>, <code>"tabbed"</code> or <code>"none"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setVibrancy</code></td>
            <td><pre><code class="language-application-typescript">setVibrancy(vibrancy: string): void</code></pre><p>Sets the macOS vibrancy effect applied behind the window contents. No-op on other platforms.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>vibrancy</code></td><td><code>string</code><br>The effect, such as <code>"sidebar"</code>, <code>"under-window"</code> or <code>"fullscreen-ui"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>reloadAllWindows</code></td>
            <td><pre><code class="language-application-typescript">reloadAllWindows(): void</code></pre><p>Triggers a hard reload of every open Trilium window.</p></td>
        </tr>
        <tr>
            <td><code>restartApp</code></td>
            <td><pre><code class="language-application-typescript">restartApp(): void</code></pre><p>Quits the app and immediately relaunches it.</p></td>
        </tr>
        <tr>
            <td><code>toggleAllWindows</code></td>
            <td><pre><code class="language-application-typescript">toggleAllWindows(): void</code></pre><p>Shows all hidden windows or hides all visible ones — used by the "show/hide app" global shortcut and tray menu entry.</p></td>
        </tr>
        <tr>
            <td><code>clearCache</code></td>
            <td><pre><code class="language-application-typescript">clearCache(): Promise&lt;void&gt;</code></pre><p>Clears the underlying Chromium HTTP cache. Resolves once the cache is empty.</p></td>
        </tr>
        <tr>
            <td><code>showWindow</code></td>
            <td><pre><code class="language-application-typescript">showWindow(): void</code></pre><p>Brings the main window to the foreground, restoring it if minimized.</p></td>
        </tr>
        <tr>
            <td><code>reportStartupMetric</code></td>
            <td><pre><code class="language-application-typescript">reportStartupMetric(metric: "client-full-render"): void</code></pre><p>Reports a renderer startup milestone to the main process, which records it relative to OS process creation alongside the main-process startup metrics. Only the first report of each metric is recorded; later reports (e.g. after a window reload or from extra windows) are ignored.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>metric</code></td><td><code>"client-full-render"</code><br>The milestone the renderer reached.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onGlobalShortcut</code></td>
            <td><pre><code class="language-application-typescript">onGlobalShortcut(callback: (actionName: string) =&gt; void): void</code></pre><p>Subscribes to globally registered keyboard shortcuts.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(actionName: string) =&gt; void</code><br>Receives the name of the action the shortcut triggers, not the keystroke.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onOpenInSameTab</code></td>
            <td><pre><code class="language-application-typescript">onOpenInSameTab(callback: (noteId: string) =&gt; void): void</code></pre><p>Subscribes to "open note in active tab" requests originating from outside the renderer (e.g. tray menu, deep links).</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(noteId: string) =&gt; void</code><br>Receives the ID of the note to open.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onDevToolsDockChanged</code></td>
            <td><pre><code class="language-application-typescript">onDevToolsDockChanged(callback: (docked: boolean) =&gt; void): void</code></pre><p>Subscribes to changes of the DevTools docking state. While DevTools is docked, Chromium disables the native window material (Mica / vibrancy).</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(docked: boolean) =&gt; void</code><br>Receives <code>true</code> while DevTools is attached to this window, and <code>false</code> when it is closed or in a separate window.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-ClipboardApi"></a>`ClipboardApi`

Renderer access to the system clipboard for cases the standard Web API can't cover.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>copyImageToClipboard</code></td>
            <td><pre><code class="language-application-typescript">copyImageToClipboard(buffer: Uint8Array): void</code></pre><p>Writes a raw image (PNG-encoded bytes) to the system clipboard so it can be pasted into other applications as an image rather than as a file.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>buffer</code></td><td><code>Uint8Array</code><br>The PNG-encoded image.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>readText</code></td>
            <td><pre><code class="language-application-typescript">readText(): Promise&lt;string&gt;</code></pre><p>Reads plain text from the system clipboard via the main-process <code>electron.clipboard</code>. Used instead of <code>navigator.clipboard.readText()</code> so the renderer's deny-by-default permission policy does not have to grant the sensitive <code>clipboard-read</code> permission to the whole session.</p></td>
        </tr>
        <tr>
            <td><code>readHTML</code></td>
            <td><pre><code class="language-application-typescript">readHTML(): Promise&lt;string&gt;</code></pre><p>Reads the HTML flavor of the system clipboard, the same way as <code>readText</code>. Empty when the clipboard has no HTML.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-ShellApi"></a>`ShellApi`

Wrappers around Electron's `shell` module for interacting with the OS (default browser, default file handler, downloads, etc.).

Every method here is validated in the main process before dispatch — see `apps/server/src/services/shell_validators.ts`. The renderer is treated as untrusted: invalid input throws on the main side rather than being silently passed through to `electron.shell` / `WebContents`.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>openExternal</code></td>
            <td><pre><code class="language-application-typescript">openExternal(url: string): void</code></pre><p>Opens a URL in the user's default external browser via <code>electron.shell.openExternal</code>.</p><p><strong>Security:</strong> the scheme is matched against the allowlist in <code>SHELL_OPEN_EXTERNAL_PROTOCOLS</code> (commons). Blocked schemes include <code>file:</code>, <code>data:</code>, <code>smb:</code>, <code>ldap:</code>, <code>ldaps:</code>, <code>jar:</code>, and <code>view-source:</code> — they cover Follina-class RCE primitives (<code>ms-msdt:</code>, <code>search-ms:</code>), NTLM credential theft, and Java loader vectors. URLs that fail to parse are rejected outright.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>url</code></td><td><code>string</code><br>The URL to open.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>openPath</code></td>
            <td><pre><code class="language-application-typescript">openPath(path: string): Promise&lt;string&gt;</code></pre><p>Opens a local path with its default OS handler.</p><p><strong>Security:</strong> the path is canonicalized and must resolve to either the Trilium data directory (or a descendant) or the Trilium tmp directory (or a descendant). Anything else — absolute paths elsewhere on disk, traversal attempts, UNC paths that don't normalize under those roots — is rejected. Null bytes, empty strings, and non-existent files are also rejected.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>path</code></td><td><code>string</code><br>A file in the Trilium data or tmp directory.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: An empty string on success, or an error message on failure.</p></td>
        </tr>
        <tr>
            <td><code>showItemInFolder</code></td>
            <td><pre><code class="language-application-typescript">showItemInFolder(path: string): void</code></pre><p>Shows a local file in the OS file manager, with the file itself selected, via <code>electron.shell.showItemInFolder</code>. For pointing at a file the user is not meant to open — the database, whose reader is Trilium itself.</p><p><strong>Security:</strong> the same sandbox as <code>openPath</code>, with the database file added as a root of its own, since <code>TRILIUM_DOCUMENT_PATH</code> may put it outside the data directory. Revealing is the milder act of the two, the file being selected rather than launched, but a path the renderer names is still a path the renderer must not be free to choose.</p><p>Nothing is reported back: the OS is asked to bring a window forward, and whether it did is not something Electron answers.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>path</code></td><td><code>string</code><br>A file in the Trilium data or tmp directory, or the database file.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>openFileUrl</code></td>
            <td><pre><code class="language-application-typescript">openFileUrl(fileUrl: string): Promise&lt;string&gt;</code></pre><p>Opens a <code>file://</code> URL with its default OS handler. Exists as a separate channel from <code>openExternal</code> because neither Electron API opens every target correctly on Windows: <code>shell.openExternal</code> mishandles Unicode characters in <code>file:</code> URLs, while <code>shell.openPath</code> opens a directory with the Explorer-specific <code>explore</code> verb, bypassing the user's file manager. The main process picks between them per target.</p><p><strong>Security:</strong> the URL must use the <code>file:</code> scheme and must have an empty hostname. UNC paths (<code>file://attacker.example/share/x</code>) are explicitly blocked because Windows would otherwise resolve them to <code>\\attacker.example\share\x</code> and leak the user's NTLM hash via SMB authentication. Drive-letter-as-host malformations like <code>file://C:/path</code> are normalized to <code>file:///C:/path</code> before parsing.</p><p>Note: unlike <code>openPath</code>, the resolved path is NOT confined to the Trilium data / tmp directories — this channel handles user-clicked <code>file://</code> links inside note content, which routinely reference arbitrary locations on disk (<code>file:///C:/Users/me/Documents/contract.pdf</code> and similar). Equivalent to a browser following a <code>file:</code> link the user clicked. Treat clicks on attacker-influenced note content accordingly.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>fileUrl</code></td><td><code>string</code><br>A <code>file:</code> URL with an empty hostname.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: An empty string on success, or an error message on failure.</p></td>
        </tr>
        <tr>
            <td><code>downloadURL</code></td>
            <td><pre><code class="language-application-typescript">downloadURL(url: string): void</code></pre><p>Triggers a Chromium download for the given URL — the file is saved through the normal "Save As" flow instead of being opened in the renderer.</p><p><strong>Security:</strong> locked to the renderer's own origin. The scheme, hostname, and port must all match the running app's origin (<code>http://localhost:PORT</code> for the dev server, or the custom <code>trilium-app://app/</code> protocol for packaged Electron). Cross-origin downloads, hostless URLs (<code>data:</code>, <code>blob:</code>, <code>about:</code>, plain <code>file:///</code>), and unparseable URLs are rejected. This stops a compromised renderer from pre-positioning a remote payload in the user's Downloads folder under a familiar name.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>url</code></td><td><code>string</code><br>A URL on the app's own origin.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>openCustom</code></td>
            <td><pre><code class="language-application-typescript">openCustom(filePath: string): void</code></pre><p>Opens a file with a Trilium-specific custom handler (configured via the "Open With" option), falling back to the OS default if none is set.</p><p><strong>Security:</strong> the path must resolve to a strict descendant of Trilium's tmp directory and the file must exist on disk. The legitimate caller always passes a path that was just written by <code>saveToTmpDir</code>; anything else (the data dir itself, paths elsewhere on disk, null bytes, empty strings) is rejected.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>filePath</code></td><td><code>string</code><br>A file in Trilium's tmp directory, as written by <code>saveToTmpDir</code>.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-ContextMenuApi"></a>`ContextMenuApi`

Bridge for the native context menu shown over web contents.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>onContextMenu</code></td>
            <td><pre><code class="language-application-typescript">onContextMenu(callback: (params: ContextMenuParams) =&gt; void): void</code></pre><p>Subscribes to right-click events forwarded from the main process.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(params:</code> <a href="#type-ContextMenuParams"><code>ContextMenuParams</code></a><code>) =&gt; void</code><br>Receives where the user clicked and what is under the cursor.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>webContentsAction</code></td>
            <td><pre><code class="language-application-typescript">webContentsAction(action: "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "insertText", text?: string): void</code></pre><p>Executes a clipboard / text-input action on the focused web contents.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>action</code></td><td><code>"cut" | "copy" | "paste" | "pasteAndMatchStyle" | "insertText"</code><br>The action to execute.</td></tr><tr><td><code>text</code><br><em>optional</em></td><td><code>string</code><br>The text to insert. <code>"insertText"</code> requires it; the other actions ignore it.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-SpellcheckApi"></a>`SpellcheckApi`

Renderer-side access to Chromium's built-in spell checker.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>addWordToDictionary</code></td>
            <td><pre><code class="language-application-typescript">addWordToDictionary(word: string): void</code></pre><p>Adds a word to the user's personal dictionary so it is no longer flagged.</p></td>
        </tr>
        <tr>
            <td><code>getAvailableSpellCheckerLanguages</code></td>
            <td><pre><code class="language-application-typescript">getAvailableSpellCheckerLanguages(): string[]</code></pre><p>Returns the BCP-47 language tags Chromium can spell-check on this platform.</p></td>
        </tr>
        <tr>
            <td><code>setSpellCheckerLanguages</code></td>
            <td><pre><code class="language-application-typescript">setSpellCheckerLanguages(languageCodes: string[]): void</code></pre><p>Applies the spell-check language list to every open window's session immediately, without an application restart. No-op on macOS, where the OS spell checker auto-detects the language.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>languageCodes</code></td><td><code>string[]</code><br>Language tags returned by <code>getAvailableSpellCheckerLanguages</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setSpellCheckerEnabled</code></td>
            <td><pre><code class="language-application-typescript">setSpellCheckerEnabled(enabled: boolean): void</code></pre><p>Enables or disables the built-in spell checker on every open window's session immediately, without an application restart.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to enable the spell checker, <code>false</code> to disable it.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-SystemIntegrationApi"></a>`SystemIntegrationApi`

OS integration controls — system tray and autostart / launch-on-login.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>reloadTray</code></td>
            <td><pre><code class="language-application-typescript">reloadTray(): void</code></pre><p>Rebuilds the tray icon and menu — call after changing tray-related settings.</p></td>
        </tr>
        <tr>
            <td><code>reapplyLaunchOnStartup</code></td>
            <td><pre><code class="language-application-typescript">reapplyLaunchOnStartup(): void</code></pre><p>Re-applies the OS autostart entry after the <code>launchOnStartup</code> / <code>hideOnAutoStart</code> options change.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-PrintingApi"></a>`PrintingApi`

Printing and PDF export flow. Trilium drives Electron's printing pipeline through a small state machine that the main process owns, with progress and results pushed back to the renderer via IPC events.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>sendPrintProgress</code></td>
            <td><pre><code class="language-application-typescript">sendPrintProgress(progress: number): void</code></pre><p>Reports rendering progress from the renderer to the main process.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>progress</code></td><td><code>number</code><br>The percentage rendered, from 0 to 100.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onPrintProgress</code></td>
            <td><pre><code class="language-application-typescript">onPrintProgress(callback: (data: { progress: number; action: string }) =&gt; void): void</code></pre><p>Subscribes to progress updates emitted by the main process during a print or PDF export run.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(data: { progress: number; action: string }) =&gt; void</code><br>Receives the percentage done and the current stage, such as <code>"rendering"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onPrintDone</code></td>
            <td><pre><code class="language-application-typescript">onPrintDone(callback: (printReport: unknown, liveJobId?: number) =&gt; void): void</code></pre><p>Subscribes to the "print finished" event, fired once the OS print job is dispatched.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(printReport: unknown, liveJobId?: number) =&gt; void</code><br>Receives the main process's report on the job, or an error with a <code>message</code>, and, for a job that printed the app window itself, the ID of the live print the job ended.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>removePrintListeners</code></td>
            <td><pre><code class="language-application-typescript">removePrintListeners(): void</code></pre><p>Removes all listeners registered via <code>onPrintProgress</code> and <code>onPrintDone</code>.</p></td>
        </tr>
        <tr>
            <td><code>getPrinters</code></td>
            <td><pre><code class="language-application-typescript">getPrinters(): Promise&lt;unknown[]&gt;</code></pre><p>Returns the list of printers known to the OS.</p></td>
        </tr>
        <tr>
            <td><code>exportAsPdfPreview</code></td>
            <td><pre><code class="language-application-typescript">exportAsPdfPreview(opts: Record&lt;string, unknown&gt;): void</code></pre><p>Asks the main process to render the current note as a PDF and return the resulting bytes for the in-app preview. Result is delivered via <code>onExportAsPdfPreviewResult</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code></td><td><code>Record&lt;string, unknown&gt;</code><br>The note path, the page size, orientation, scale, margins and page ranges, and a <code>requestId</code> the result echoes back.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onExportAsPdfPreviewResult</code></td>
            <td><pre><code class="language-application-typescript">onExportAsPdfPreviewResult(callback: (result: { buffer?: Uint8Array&lt;ArrayBufferLike&gt;; error?: string; requestId?: number }) =&gt; void): void</code></pre><p>Subscribes to the result of an <code>exportAsPdfPreview</code> call.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(result: { buffer?: Uint8Array&lt;ArrayBufferLike&gt;; error?: string; requestId?: number }) =&gt; void</code><br>Receives the PDF bytes or an error message, and the <code>requestId</code> of the call the result answers.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>removeExportAsPdfPreviewResultListener</code></td>
            <td><pre><code class="language-application-typescript">removeExportAsPdfPreviewResultListener(): void</code></pre><p>Removes the listener registered via <code>onExportAsPdfPreviewResult</code>.</p></td>
        </tr>
        <tr>
            <td><code>savePdf</code></td>
            <td><pre><code class="language-application-typescript">savePdf(data: { title: string; buffer: Uint8Array }): void</code></pre><p>Persists a previously generated PDF buffer to disk via the native save dialog.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>data</code></td><td><code>{ title: string; buffer: Uint8Array }</code><br>The PDF bytes, and the title to suggest as the file name.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>printFromPreview</code></td>
            <td><pre><code class="language-application-typescript">printFromPreview(opts: Record&lt;string, unknown&gt;): void</code></pre><p>Sends the previewed PDF to the OS print dialog with the given options.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code></td><td><code>Record&lt;string, unknown&gt;</code><br>The options of <code>exportAsPdfPreview</code>, plus <code>silent</code> to print without the dialog and <code>deviceName</code> to choose the printer.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-NavigationApi"></a>`NavigationApi`

Accessors for the underlying Chromium navigation history of the current web contents (back/forward stack), exposed so the renderer can mirror it in custom UI such as the breadcrumb / tab back button.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>clearNavigationHistory</code></td>
            <td><pre><code class="language-application-typescript">clearNavigationHistory(): void</code></pre><p>Clears the entire back/forward navigation history.</p></td>
        </tr>
        <tr>
            <td><code>navigationCanGoBack</code></td>
            <td><pre><code class="language-application-typescript">navigationCanGoBack(): boolean</code></pre><p>Synchronously returns whether a back navigation is possible.</p></td>
        </tr>
        <tr>
            <td><code>navigationCanGoForward</code></td>
            <td><pre><code class="language-application-typescript">navigationCanGoForward(): boolean</code></pre><p>Synchronously returns whether a forward navigation is possible.</p></td>
        </tr>
        <tr>
            <td><code>navigationGetAllEntries</code></td>
            <td><pre><code class="language-application-typescript">navigationGetAllEntries(): { url: string; title: string }[]</code></pre><p>Returns every entry in the navigation history, oldest first.</p></td>
        </tr>
        <tr>
            <td><code>navigationGetActiveIndex</code></td>
            <td><pre><code class="language-application-typescript">navigationGetActiveIndex(): number</code></pre><p>Returns the index of the currently active entry inside <code>navigationGetAllEntries</code>.</p></td>
        </tr>
        <tr>
            <td><code>navigationLength</code></td>
            <td><pre><code class="language-application-typescript">navigationLength(): number</code></pre><p>Returns the total number of entries in the navigation history.</p></td>
        </tr>
        <tr>
            <td><code>navigationGoToIndex</code></td>
            <td><pre><code class="language-application-typescript">navigationGoToIndex(index: number): void</code></pre><p>Navigates to the entry at the given index in the history stack.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>index</code></td><td><code>number</code><br>An index into <code>navigationGetAllEntries</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onDidNavigate</code></td>
            <td><pre><code class="language-application-typescript">onDidNavigate(callback: () =&gt; void): void</code></pre><p>Subscribes to top-level navigation events (URL changes that load a new document).</p></td>
        </tr>
        <tr>
            <td><code>onDidNavigateInPage</code></td>
            <td><pre><code class="language-application-typescript">onDidNavigateInPage(callback: () =&gt; void): void</code></pre><p>Subscribes to in-page navigation events (hash changes, <code>history.pushState</code>).</p></td>
        </tr>
        <tr>
            <td><code>removeDidNavigateListeners</code></td>
            <td><pre><code class="language-application-typescript">removeDidNavigateListeners(): void</code></pre><p>Removes all listeners registered via <code>onDidNavigate</code> and <code>onDidNavigateInPage</code>.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-WsApi"></a>`WsApi`

In-process replacement for the renderer↔server WebSocket. Backed by Chromium IPC instead of a TCP socket — no port is bound and no auth check is needed because the channel is only reachable from the renderer the BrowserWindow owns. Wire format is whatever the server's `MessagingProvider` accepts (currently `WebSocketMessage` / log-error / log-info / ping).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>send</code></td>
            <td><pre><code class="language-application-typescript">send(message: unknown): void</code></pre><p>Sends a message from the renderer to the main-process messaging hub.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>message</code></td><td><code>unknown</code><br>A message the server's <code>MessagingProvider</code> accepts.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>onMessage</code></td>
            <td><pre><code class="language-application-typescript">onMessage(callback: (message: unknown) =&gt; void): () =&gt; void</code></pre><p>Subscribes to messages pushed from the main process.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(message: unknown) =&gt; void</code><br>Receives each message.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>() =&gt; void</code>: An unsubscribe function. Call it when the listener is no longer needed (e.g. when a BrowserWindow is unloaded) to avoid leaking handlers.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-SecurityApi"></a>`SecurityApi`

Security settings that live outside the database (in `data_dir/security.json`) to prevent malicious scripts from modifying them. Changes require a native OS confirmation dialog and an app restart to take effect.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>setLanAccessEnabled</code></td>
            <td><pre><code class="language-application-typescript">setLanAccessEnabled(enabled: boolean): Promise&lt;boolean&gt;</code></pre><p>Requests enabling/disabling LAN access. When enabled, the desktop binds its TCP listener to all interfaces (instead of loopback) so other devices can reach it — e.g. to sync from another device. Same confirmation + restart flow as above.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to listen on all interfaces, <code>false</code> to listen on loopback only.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;boolean&gt;</code>: <code>true</code> once the user agreed and the change was written.</p></td>
        </tr>
        <tr>
            <td><code>setBackendScriptingEnabled</code></td>
            <td><pre><code class="language-application-typescript">setBackendScriptingEnabled(enabled: boolean): Promise&lt;boolean&gt;</code></pre><p>Requests backend script execution be turned on or off.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to allow backend scripts to run, <code>false</code> to block them.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setSqlConsoleEnabled</code></td>
            <td><pre><code class="language-application-typescript">setSqlConsoleEnabled(enabled: boolean): Promise&lt;boolean&gt;</code></pre><p>Requests the SQL console be turned on or off.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code><br><code>true</code> to enable the SQL console, <code>false</code> to disable it.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-BackupPassphraseApi"></a>`BackupPassphraseApi`

The backup passphrase, kept encrypted by the OS keyring in a file outside the database (the database is what ends up inside the backup, so a passphrase stored there would ride along inside the very container it protects).

Deliberately write-only: there is no way to read the passphrase back, so a frontend script cannot exfiltrate it. Only the main process ever sees the plaintext again, when it writes a backup.

Both changes are also gated on a native OS confirmation, which a script can request but cannot answer. Without that, a script could quietly swap in a passphrase of its own and every later backup would be encrypted to it.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>getStatus</code></td>
            <td><pre><code class="language-application-typescript">getStatus(): Promise&lt;BackupPassphraseStatus&gt;</code></pre><p>Whether a passphrase can be stored on this system, and whether one already is.</p></td>
        </tr>
        <tr>
            <td><code>set</code></td>
            <td><pre><code class="language-application-typescript">set(passphrase: string): Promise&lt;BackupPassphraseChange&gt;</code></pre><p>Stores a passphrase, replacing any existing one, once the user has confirmed it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>passphrase</code></td><td><code>string</code><br>The passphrase to encrypt later backups with.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>clear</code></td>
            <td><pre><code class="language-application-typescript">clear(): Promise&lt;BackupPassphraseChange&gt;</code></pre><p>Forgets the stored passphrase. Existing backups keep the passphrase they were written with.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-OneNoteApi"></a>`OneNoteApi`

Desktop-only OneNote importer sign-in, driven from the main process via a loopback OAuth redirect.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>login</code></td>
            <td><pre><code class="language-application-typescript">login(): Promise&lt;OneNoteLoginResult&gt;</code></pre><p>Runs the Microsoft delegated-Graph OAuth flow: opens the system browser, captures the redirect on a throwaway loopback server, exchanges the code, and stores the token process-side. Resolves once the desktop session is connected (or with <code>connected: false</code> on failure/timeout).</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-NativeExportApi"></a>`NativeExportApi`

Desktop-native subtree export that streams a `.zip` straight to a file.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>exportSubtreeToFile</code></td>
            <td><pre><code class="language-application-typescript">exportSubtreeToFile(opts: { branchId: string; format: string; title: string; taskId: string }): Promise&lt;NativeExportResult&gt;</code></pre><p>Prompts a native "save as" dialog, then streams a subtree (branch) export to the chosen path on disk. This bypasses the in-memory download path, so memory stays bounded regardless of archive size. Progress/success/error are reported over the WebSocket via <code>taskId</code>. Resolves once the dialog is dismissed (<code>cancelled</code>) or the export finishes (<code>saved</code> / <code>error</code>).</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code></td><td><code>{ branchId: string; format: string; title: string; taskId: string }</code><br>The branch to export, the export format (<code>"html"</code>, <code>"markdown"</code> or <code>"share"</code>), the title to suggest as the file name, and the ID of the task that reports progress.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-NativeImportApi"></a>`NativeImportApi`

Desktop-native import that reads the user's file **in place** (bounded memory, no temp copy) — the whole point being multi-GB `.zip` archives, though any importable file is accepted. The renderer never handles a filesystem path: `pickFiles` runs the OS dialog in the main process and returns opaque capability tokens, which `importFromToken` redeems. A script can't forge a token or pass a path, so it can never read an arbitrary file.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>pickFiles</code></td>
            <td><pre><code class="language-application-typescript">pickFiles(): Promise&lt;NativeImportPickResult&gt;</code></pre><p>Prompts a native "open file" dialog (multi-select, any type) and returns single-use tokens for the chosen files.</p></td>
        </tr>
        <tr>
            <td><code>grantDroppedFiles</code></td>
            <td><pre><code class="language-application-typescript">grantDroppedFiles(files: File[]): Promise&lt;NativeImportPickResult&gt;</code></pre><p>Resolves files the user dropped onto a drop zone to capability tokens, so a drag-and-drop import takes the same in-place (streamed) path as the dialog. The <code>File</code> is the unforgeable capability: the path is obtained via <code>webUtils.getPathForFile</code>, which yields a real path only for a genuinely user-supplied file and an empty string for anything a script constructed — so a script can't smuggle in an arbitrary path. Returns <code>cancelled</code> when no dropped file resolved (e.g. dragged from a browser, not the OS), so the caller falls back to the normal upload route.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>files</code></td><td><code>File[]</code><br>The files of the drop event.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>importFromToken</code></td>
            <td><pre><code class="language-application-typescript">importFromToken(opts: { token: string; parentNoteId: string; taskId: string; options: NativeImportOptions; last: boolean; format?: string }): Promise&lt;NativeImportResult&gt;</code></pre><p>Imports the file behind a token, with progress/success/error reported over the WebSocket like the HTTP import path.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code></td><td><code>{ token: string; parentNoteId: string; taskId: string; options:</code> <a href="#type-NativeImportOptions"><code>NativeImportOptions</code></a><code>; last: boolean; format?: string }</code><br>The <code>token</code> to redeem, the <code>parentNoteId</code> to import under, the <code>taskId</code> that reports progress, and the import <code>options</code>. When importing several files in one batch, set <code>last</code> only on the final call so the success toast fires once, after everything is in. <code>format</code> routes the file to a specific importer (e.g. <code>"obsidian"</code>), mirroring the HTTP route's format tag.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-DialogApi"></a>`DialogApi`

Native OS pickers that hand the renderer a location the user chose themselves.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>pickDirectory</code></td>
            <td><pre><code class="language-application-typescript">pickDirectory(opts?: { defaultPath?: string }): Promise&lt;NativeDirectoryPickResult&gt;</code></pre><p>Prompts a native "select folder" dialog. The renderer cannot supply the answer: a script can at most pop the dialog, which the user still has to accept before any path comes back.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code><br><em>optional</em></td><td><code>{ defaultPath?: string }</code><br>The directory the dialog starts in, as <code>defaultPath</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>confirmStartOver</code></td>
            <td><pre><code class="language-application-typescript">confirmStartOver(): Promise&lt;boolean&gt;</code></pre><p>Prompts a native message box before the application restarts into the setup screen, where the user may replace or erase their knowledge base.</p><p>An OS dialog rather than one of the application's own, for the reason the security toggles use one: a note script can reach every dialog the app draws for itself, and this one guards the path to losing everything. It is never suppressible, so there is no "don't ask again" here.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-RestoreApi"></a>`RestoreApi`

Choosing a backup to restore from the desktop, where the file is already on the same disk as the database it is going to replace and has no business being uploaded to reach it.

Only usable during setup: what it puts forward is restored by the ordinary `POST /api/setup/restore/start`, which refuses once the application is initialized.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>pickBackup</code></td>
            <td><pre><code class="language-application-typescript">pickBackup(): Promise&lt;NativeBackupPickResult&gt;</code></pre><p>Prompts a native "open file" dialog for a <code>.db</code> or <code>.tnbackup</code> backup and, if one is chosen, makes it the backup waiting to be restored.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-TranscriptionApi"></a>`TranscriptionApi`

Meeting transcription, recorded and transcribed on this computer by the main process. The renderer only starts and stops it; the audio never passes through the renderer.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>isSupported</code></td>
            <td><pre><code class="language-application-typescript">isSupported(): Promise&lt;boolean&gt;</code></pre><p>Whether this build can transcribe on this computer: <code>false</code> when it carries no speech recognition engine for the platform and processor it runs on.</p></td>
        </tr>
        <tr>
            <td><code>start</code></td>
            <td><pre><code class="language-application-typescript">start(noteId: string): Promise&lt;string&gt;</code></pre><p>Starts recording the microphone and the system audio for a meeting note.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code><br>The meeting note the transcript belongs to.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: An empty string once recording runs, or an error message when it cannot start.</p></td>
        </tr>
        <tr>
            <td><code>stop</code></td>
            <td><pre><code class="language-application-typescript">stop(): Promise&lt;void&gt;</code></pre><p>Stops the recording, once the speech already captured has been transcribed.</p></td>
        </tr>
        <tr>
            <td><code>getState</code></td>
            <td><pre><code class="language-application-typescript">getState(): Promise&lt;TranscriptionState&gt;</code></pre></td>
        </tr>
        <tr>
            <td><code>renameSpeaker</code></td>
            <td><pre><code class="language-application-typescript">renameSpeaker(attachmentId: string, key: string, name: string): Promise&lt;boolean&gt;</code></pre><p>Names a speaker of a transcript attachment, if a running recording writes that transcript. The recording applies it, so no utterance it writes meanwhile is lost.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>attachmentId</code></td><td><code>string</code><br>The transcript attachment.</td></tr><tr><td><code>key</code></td><td><code>string</code><br>The speaker: <code>microphone</code> for the local speaker, <code>system:&lt;n&gt;</code> for an identified speaker of the system audio.</td></tr><tr><td><code>name</code></td><td><code>string</code><br>The name to give, or a blank string to restore the default name.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;boolean&gt;</code>: <code>false</code> when no recording writes <code>attachmentId</code>; it can then be saved whole.</p></td>
        </tr>
        <tr>
            <td><code>getRecordingsDirectory</code></td>
            <td><pre><code class="language-application-typescript">getRecordingsDirectory(): Promise&lt;string&gt;</code></pre><p>Returns the directory that keeps the audio and the transcript as produced of each recording while <code>transcriptionKeepRecordings</code> is on, creating it if needed.</p></td>
        </tr>
        <tr>
            <td><code>onStateChanged</code></td>
            <td><pre><code class="language-application-typescript">onStateChanged(callback: (state: TranscriptionState) =&gt; void): () =&gt; void</code></pre><p>Subscribes to changes of the transcription state, made from any window.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(state:</code> <a href="#type-TranscriptionState"><code>TranscriptionState</code></a><code>) =&gt; void</code><br>Receives the new state.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>() =&gt; void</code>: A function that removes the listener.</p></td>
        </tr>
        <tr>
            <td><code>onLevel</code></td>
            <td><pre><code class="language-application-typescript">onLevel(callback: (source: TranscriptSource, level: number) =&gt; void): () =&gt; void</code></pre><p>Subscribes to the audio level of the running recording, about four times a second per source.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>(source:</code> <a href="#type-TranscriptSource"><code>TranscriptSource</code></a><code>, level: number) =&gt; void</code><br>Receives the source and the RMS, from 0 to 1, of each chunk it delivers.</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>() =&gt; void</code>: A function that stops the calls.</p></td>
        </tr>
    </tbody>
</table>

## Types

### <a id="type-ContextMenuParams"></a>`ContextMenuParams`

Parameters delivered by the main process to the renderer when the user opens the system context menu (right-click) somewhere inside a web view.

Mirrors the subset of fields from Electron's `Electron.ContextMenuParams` that the renderer actually consumes when building its custom context menu.

| Property | Description |
| --- | --- |
| `x` | `number`  <br>Horizontal position of the click, in CSS pixels, relative to the web view. |
| `y` | `number`  <br>Vertical position of the click, in CSS pixels, relative to the web view. |
| `linkURL` | `string`  <br>URL of the link the user clicked on, or an empty string if not on a link. |
| `linkText` | `string`  <br>Visible text of the link the user clicked on, or an empty string. |
| `mediaType` | `string`  <br>Media kind under the cursor (e.g. `"none"`, `"image"`, `"video"`, `"audio"`). |
| `isEditable` | `boolean`  <br>Whether the element under the cursor is editable (input, textarea, contenteditable). |
| `selectionText` | `string`  <br>Currently selected text, or an empty string if nothing is selected. |
| `misspelledWord` | `string`  <br>The misspelled word under the cursor, or an empty string if none. |
| `dictionarySuggestions` | `string[]`  <br>Spell-check suggestions for `misspelledWord`, in order of relevance. |
| `editFlags` | `{ canCut: boolean; canCopy: boolean; canPaste: boolean }`  <br>Hints about which clipboard operations are currently available. |

### <a id="type-BackupPassphraseStatus"></a>`BackupPassphraseStatus`

What the Options UI needs to know about the stored backup passphrase.

| Property | Description |
| --- | --- |
| `available` | `boolean`  <br>Whether the OS offers a keyring to keep the passphrase in. Without one it cannot be stored safely, and since unattended backups cannot ask for it, encryption is unavailable altogether. |
| `set` | `boolean`  <br>Whether a passphrase is currently stored. |

### <a id="type-BackupPassphraseChange"></a>`BackupPassphraseChange`

What became of a request to change the stored backup passphrase.

| Value | Description |
| --- | --- |
| `"applied"` | The change was confirmed and carried out. |
| `"cancelled"` | The user declined the OS confirmation, so nothing changed. |
| `"unavailable"` | There is no keyring on this system to keep a passphrase in. |

### <a id="type-OneNoteLoginResult"></a>`OneNoteLoginResult`

Outcome of a [`OneNoteApi.login`](#type-OneNoteApi) attempt.

| Property | Description |
| --- | --- |
| `connected` | `boolean`  <br>True if sign-in completed and a Microsoft Graph token was stored. |
| `account`  <br>_optional_ | `{ name: string; email: string }`  <br>The connected Microsoft account, present when `connected` is true. |
| `error`  <br>_optional_ | `string`  <br>A human-readable failure reason when `connected` is false (absent on user cancellation). |

### <a id="type-NativeExportResult"></a>`NativeExportResult`

Outcome of a [`NativeExportApi.exportSubtreeToFile`](#type-NativeExportApi) request.

| Property | Description |
| --- | --- |
| `status` | `"cancelled" \| "saved" \| "error"` |
| `filePath`  <br>_optional_ | `string`  <br>Absolute path the archive was written to (when `status === "saved"`). |
| `message`  <br>_optional_ | `string`  <br>Failure detail (when `status === "error"`). |

### <a id="type-NativeImportPickResult"></a>`NativeImportPickResult`

Outcome of [`NativeImportApi.pickFiles`](#type-NativeImportApi): capability tokens, never paths.

| Property | Description |
| --- | --- |
| `status` | `"cancelled" \| "selected"` |
| `files`  <br>_optional_ | [`NativeImportPickedFile`](#type-NativeImportPickedFile)`[]`  <br>The user-chosen files (when `status === "selected"`); one or more, since the dialog allows multi-select. |

### <a id="type-NativeImportOptions"></a>`NativeImportOptions`

Import flags forwarded to the native importer (mirrors the HTTP route's options; no path).

| Property | Description |
| --- | --- |
| `safeImport` | `boolean` |
| `shrinkImages` | `boolean` |
| `textImportedAsText` | `boolean` |
| `codeImportedAsCode` | `boolean` |
| `spreadsheetImportedAsSpreadsheet` | `boolean` |
| `explodeArchives` | `boolean` |
| `replaceUnderscoresWithSpaces` | `boolean` |

### <a id="type-NativeImportResult"></a>`NativeImportResult`

Outcome of [`NativeImportApi.importFromToken`](#type-NativeImportApi).

| Property | Description |
| --- | --- |
| `status` | `"error" \| "imported"` |
| `importedNoteId`  <br>_optional_ | `string`  <br>Root note of the import (when `status === "imported"`). |
| `message`  <br>_optional_ | `string`  <br>Failure detail (when `status === "error"`). |

### <a id="type-NativeDirectoryPickResult"></a>`NativeDirectoryPickResult`

Outcome of [`DialogApi.pickDirectory`](#type-DialogApi).

| Property | Description |
| --- | --- |
| `status` | `"cancelled" \| "selected"` |
| `path`  <br>_optional_ | `string`  <br>Absolute path of the chosen directory (when `status === "selected"`). |

### <a id="type-NativeBackupPickResult"></a>`NativeBackupPickResult`

Outcome of [`RestoreApi.pickBackup`](#type-RestoreApi): what the chosen backup is, never where it is.

The file itself stays with the main process, which holds it as the one waiting to be restored, so the renderer is given only what the screen has to show and decide with.

| Property | Description |
| --- | --- |
| `status` | `"cancelled" \| "error" \| "selected"` |
| `fileName`  <br>_optional_ | `string`  <br>Display name of the chosen backup (when `status === "selected"`). |
| `encrypted`  <br>_optional_ | `boolean`  <br>Whether a passphrase has to be asked for before it can be restored. |
| `message`  <br>_optional_ | `string`  <br>Failure detail (when `status === "error"`), e.g. setup already being busy. |

### <a id="type-TranscriptionState"></a>`TranscriptionState`

What [`TranscriptionApi`](#type-TranscriptionApi) reports to every window.

| Property | Description |
| --- | --- |
| `status` | `"idle" \| "starting" \| "recording" \| "stopping"`  <br>Phase of the meeting transcription; at most one recording runs at a time. |
| `noteId` | `string \| null`  <br>The meeting note the recording belongs to, or `null` when idle. |
| `pendingSources` | [`TranscriptSource`](#type-TranscriptSource)`[]`  <br>The sources heard speaking, or whose speech is still being transcribed. |
| `sourceIssues`  <br>_optional_ | `Partial<Record<`[`TranscriptSource`](#type-TranscriptSource)`, "not_captured" \| "no_audio" \| "silent">>`  <br>While recording, the sources whose audio is not being transcribed, and why; absent when every source delivers sound.  <br>Why a source's audio is not being transcribed: its capture did not start (`not_captured`), it has delivered no audio for 10 s (`no_audio`), as when its capture hangs, or it has delivered only digital silence for a while (`silent`), as from a muted device. |
| `startedAt`  <br>_optional_ | `number`  <br>When the recording started, in milliseconds since the epoch: set once it records, kept while it stops, absent otherwise. |
| `error`  <br>_optional_ | `string`  <br>A problem to tell the user about, sent once with the state it concerns: the recording ended without being stopped, or its transcript cannot be saved. `getState()` never returns it. |

### <a id="type-TranscriptSource"></a>`TranscriptSource`

Where an utterance was heard: the local speaker's microphone, or everyone else on the system output.

```typescript
type TranscriptSource = "microphone" | "system"
```

### <a id="type-NativeImportPickedFile"></a>`NativeImportPickedFile`

A single user-chosen file: a capability token (redeemed to import it) and its display name — never a path.

| Property | Description |
| --- | --- |
| `token` | `string`  <br>Single-use, short-lived grant for the chosen file. |
| `fileName` | `string`  <br>Display name of the chosen file. |