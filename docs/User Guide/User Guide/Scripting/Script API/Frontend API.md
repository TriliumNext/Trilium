# Frontend API
## <a id="type-FrontendApi"></a>`FrontendApi`

The `api` global available inside **frontend** script notes (`application/javascript;env=frontend`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>$container</code></td>
            <td><p><a href="#type-JQuery"><code>JQuery</code></a> | <code>null</code><br>The element a render note's script renders into: the script of a note that a <code>~renderNote</code> relation points to. It is <code>null</code> for scripts that run any other way.</p></td>
        </tr>
        <tr>
            <td><code>startNote</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a><br>Note where the script execution started — the entry point of the current script bundle (in C terms, the file containing <code>main()</code>). When a script is spread across multiple code notes (descendant code notes loaded as modules via <code>require()</code>), every note in the bundle shares the same <code>startNote</code>, while <code>currentNote</code> differs per note. Messages from <code>api.log()</code> are grouped under this note.</p></td>
        </tr>
        <tr>
            <td><code>currentNote</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a><br>Note containing the source code that is currently executing (in C terms, <code>__FILE__</code>). Equal to <code>startNote</code> unless execution has moved into a descendant module note loaded via <code>require()</code>. Don't confuse this with the note open in the UI — use <code>api.getActiveContextNote()</code> for that.</p></td>
        </tr>
        <tr>
            <td><code>originEntity</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a> | <code>null</code><br>Entity whose event triggered this execution, or <code>null</code>. Most frontend scripts are started by the user or by the UI (startup scripts, widgets), so this is usually <code>null</code>. It is set to a note when: - the script runs through a <code>~renderNote</code> relation — then it's the note being rendered (the one carrying the relation), not the script note; - a backend script calls <code>api.runOnFrontend()</code> — then it's the backend execution's <code>originEntity</code>, provided that entity was a note.</p></td>
        </tr>
        <tr>
            <td><code>dayjs</code></td>
            <td><p><a href="#type-Dayjs"><code>Dayjs</code></a><br>day.js library for date manipulation. See <code>https://day.js.org</code> for documentation</p></td>
        </tr>
        <tr>
            <td><code>RightPanelWidget</code></td>
            <td><p><a href="#type-WidgetClass"><code>WidgetClass</code></a><code>&lt;</code><a href="#type-RightPanelWidget"><code>RightPanelWidget</code></a><code>&gt;</code><br>Base class for right-panel widgets — <code>class X extends api.RightPanelWidget { … }</code>.</p></td>
        </tr>
        <tr>
            <td><code>NoteContextAwareWidget</code></td>
            <td><p><a href="#type-WidgetClass"><code>WidgetClass</code></a><code>&lt;</code><a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a><code>&gt;</code><br>Base class for note-context-aware widgets — <code>class X extends api.NoteContextAwareWidget { … }</code>.</p></td>
        </tr>
        <tr>
            <td><code>BasicWidget</code></td>
            <td><p><a href="#type-WidgetClass"><code>WidgetClass</code></a><code>&lt;</code><a href="#type-BasicWidget"><code>BasicWidget</code></a><code>&gt;</code><br>Base class for basic widgets — <code>class X extends api.BasicWidget { … }</code>.</p></td>
        </tr>
        <tr>
            <td><code>activateNote</code></td>
            <td><pre><code class="language-application-typescript">activateNote(notePath: string): Promise&lt;void&gt;</code></pre><p>Activates note in the tree and in the note detail.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>notePath</code></td><td><code>string</code><br>(or noteId)</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>activateNewNote</code></td>
            <td><pre><code class="language-application-typescript">activateNewNote(notePath: string): Promise&lt;void&gt;</code></pre><p>Activates newly created note. Compared to this.activateNote() also makes sure that frontend has been fully synced.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>notePath</code></td><td><code>string</code><br>(or noteId)</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>openTabWithNote</code></td>
            <td><pre><code class="language-application-typescript">openTabWithNote(notePath: string, activate: boolean): Promise&lt;void&gt;</code></pre><p>Open a note in a new tab.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>notePath</code></td><td><code>string</code><br>(or noteId)</td></tr><tr><td><code>activate</code></td><td><code>boolean</code><br>set to true to activate the new tab, false to stay on the current tab</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>openSplitWithNote</code></td>
            <td><pre><code class="language-application-typescript">openSplitWithNote(notePath: string, activate: boolean): Promise&lt;void&gt;</code></pre><p>Open a note in a new split.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>notePath</code></td><td><code>string</code><br>(or noteId)</td></tr><tr><td><code>activate</code></td><td><code>boolean</code><br>set to true to activate the new split, false to stay on the current split</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>runOnBackend</code></td>
            <td><pre><code class="language-application-typescript">runOnBackend(func: Func, params?: unknown[]): Promise&lt;unknown&gt;</code></pre><p>Executes given anonymous function on the backend. Internally this serializes the anonymous function into string and sends it to backend via AJAX. Please make sure that the supplied function is synchronous. Only sync functions will work correctly with transaction management. If you really know what you're doing, you can call api.runAsyncOnBackendWithManualTransactionHandling()</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>func</code></td><td><a href="#type-Func"><code>Func</code></a><br>(synchronous) function to be executed on the backend</td></tr><tr><td><code>params</code><br><em>optional</em></td><td><code>unknown[]</code><br>list of parameters to the anonymous function to be sent to backend</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;unknown&gt;</code>: return value of the executed function on the backend</p></td>
        </tr>
        <tr>
            <td><code>runAsyncOnBackendWithManualTransactionHandling</code></td>
            <td><pre><code class="language-application-typescript">runAsyncOnBackendWithManualTransactionHandling(func: Func, params?: unknown[]): Promise&lt;unknown&gt;</code></pre><p>Executes given anonymous function on the backend. Internally this serializes the anonymous function into string and sends it to backend via AJAX. This function is meant for advanced needs where an async function is necessary. In this case, the automatic request-scoped transaction management is not applied, and you need to manually define transaction via api.transactional().</p><p>If you have a synchronous function, please use api.runOnBackend().</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>func</code></td><td><a href="#type-Func"><code>Func</code></a><br>(synchronous) function to be executed on the backend</td></tr><tr><td><code>params</code><br><em>optional</em></td><td><code>unknown[]</code><br>list of parameters to the anonymous function to be sent to backend</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;unknown&gt;</code>: return value of the executed function on the backend</p></td>
        </tr>
        <tr>
            <td><code>isBackendScriptingEnabled</code></td>
            <td><pre><code class="language-application-typescript">isBackendScriptingEnabled(): boolean</code></pre><p>Whether backend script execution is enabled on the server (the <code>[Security] backendScriptingEnabled</code> config toggle). When it's disabled, <code>api.runOnBackend()</code> / <code>api.runAsyncOnBackendWithManualTransactionHandling()</code> reject with a "Backend script execution is disabled" error, so check this first to let a script degrade gracefully instead of throwing.</p></td>
        </tr>
        <tr>
            <td><code>isSqlConsoleEnabled</code></td>
            <td><pre><code class="language-application-typescript">isSqlConsoleEnabled(): boolean</code></pre><p>Whether the SQL console is enabled on the server (the <code>[Security] sqlConsoleEnabled</code> config toggle). When it's disabled, backend scripts that run raw SQL (<code>api.sql.*</code>) fail, so check this before invoking SQL-backed logic via <code>api.runOnBackend()</code>.</p></td>
        </tr>
        <tr>
            <td><code>searchForNotes</code></td>
            <td><pre><code class="language-application-typescript">searchForNotes(searchString: string): Promise&lt;FNote[]&gt;</code></pre><p>This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". See full documentation for all options at: <a href="https://triliumnext.github.io/Docs/Wiki/search.html">https://triliumnext.github.io/Docs/Wiki/search.html</a></p></td>
        </tr>
        <tr>
            <td><code>searchForNote</code></td>
            <td><pre><code class="language-application-typescript">searchForNote(searchString: string): Promise&lt;FNote | null&gt;</code></pre><p>This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". See full documentation for all options at: <a href="https://triliumnext.github.io/Docs/Wiki/search.html">https://triliumnext.github.io/Docs/Wiki/search.html</a></p></td>
        </tr>
        <tr>
            <td><code>getNote</code></td>
            <td><pre><code class="language-application-typescript">getNote(noteId: string): Promise&lt;FNote | null&gt;</code></pre><p>Returns note by given noteId. If note is missing from the cache, it's loaded.</p></td>
        </tr>
        <tr>
            <td><code>getNotes</code></td>
            <td><pre><code class="language-application-typescript">getNotes(noteIds: string[], silentNotFoundError?: boolean): Promise&lt;FNote[]&gt;</code></pre><p>Returns list of notes. If note is missing from the cache, it's loaded.</p><p>This is often used to bulk-fill the cache with notes which would have to be picked one by one otherwise (by e.g. createLink())</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteIds</code></td><td><code>string[]</code></td></tr><tr><td><code>silentNotFoundError</code><br><em>optional</em></td><td><code>boolean</code><br>don't report error if the note is not found</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>reloadNotes</code></td>
            <td><pre><code class="language-application-typescript">reloadNotes(noteIds: string[]): Promise&lt;void&gt;</code></pre><p>Update frontend tree (note) cache from the backend.</p></td>
        </tr>
        <tr>
            <td><code>createNote</code></td>
            <td><pre><code class="language-application-typescript">createNote(parentNotePath: string, opts?: CreateNoteOpts): Promise&lt;{ note: FNote | null; branch: FBranch | undefined }&gt;</code></pre><p>Creates a new note as a child of the given parent, entirely on the frontend — no backend scripting required (unlike <code>api.runOnBackend(() =&gt; api.createTextNote(...))</code>). By default the new note is activated in the current tab with its title focused for editing; pass <code>{ activate: false }</code> to create it silently.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>parentNotePath</code></td><td><code>string</code><br>note path (or noteId) of the parent under which to create the note</td></tr><tr><td><code>opts</code><br><em>optional</em></td><td><a href="#type-CreateNoteOpts"><code>CreateNoteOpts</code></a><br>creation options — e.g. <code>{ title, content, type, mime, activate }</code></td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;{ note:</code> <a href="#type-FNote"><code>FNote</code></a> | <code>null; branch:</code> <a href="#type-FBranch"><code>FBranch</code></a> | <code>undefined }&gt;</code>: the created note and its branch, resolved from the frontend cache</p></td>
        </tr>
        <tr>
            <td><code>getInstanceName</code></td>
            <td><pre><code class="language-application-typescript">getInstanceName(): string | null</code></pre><p>Instance name identifies particular Trilium instance. It can be useful for scripts if some action needs to happen on only one specific instance.</p></td>
        </tr>
        <tr>
            <td><code>addTextToActiveContextEditor</code></td>
            <td><pre><code class="language-application-typescript">addTextToActiveContextEditor(text: string): void</code></pre><p>Adds given text to the editor cursor</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>text</code></td><td><code>string</code><br>this must be clear text, HTML is not supported.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getActiveContextNote</code></td>
            <td><pre><code class="language-application-typescript">getActiveContextNote(): FNote</code></pre><p><strong>Returns</strong> <a href="#type-FNote"><code>FNote</code></a>: active note (loaded into center pane)</p></td>
        </tr>
        <tr>
            <td><code>getActiveContext</code></td>
            <td><pre><code class="language-application-typescript">getActiveContext(): NoteContext</code></pre><p>Obtains the currently active/focused split in the current tab.</p><p>Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.</p></td>
        </tr>
        <tr>
            <td><code>getActiveMainContext</code></td>
            <td><pre><code class="language-application-typescript">getActiveMainContext(): NoteContext</code></pre><p>Obtains the main context of the current tab. This is the left-most split.</p><p>Note that this method does not return the note context of the "Quick edit" panel, it will return the note context behind it.</p></td>
        </tr>
        <tr>
            <td><code>getNoteContexts</code></td>
            <td><pre><code class="language-application-typescript">getNoteContexts(): NoteContext[]</code></pre><p><strong>Returns</strong> <a href="#type-NoteContext"><code>NoteContext</code></a><code>[]</code>: returns all note contexts (splits) in all tabs</p></td>
        </tr>
        <tr>
            <td><code>getMainNoteContexts</code></td>
            <td><pre><code class="language-application-typescript">getMainNoteContexts(): NoteContext[]</code></pre><p><strong>Returns</strong> <a href="#type-NoteContext"><code>NoteContext</code></a><code>[]</code>: returns all main contexts representing tabs</p></td>
        </tr>
        <tr>
            <td><code>getActiveContextTextEditor</code></td>
            <td><pre><code class="language-application-typescript">getActiveContextTextEditor(): Promise&lt;TextEditor | null&gt;</code></pre><p>Returns the editor of the text note in the active tab or split. Resolves to <code>null</code> if it shows no editable text note within 200 ms, and throws an error when no tab is active.</p></td>
        </tr>
        <tr>
            <td><code>getActiveContextCodeEditor</code></td>
            <td><pre><code class="language-application-typescript">getActiveContextCodeEditor(): Promise&lt;CodeEditor | null&gt;</code></pre><p>Returns the editor of the code note in the active tab or split. Resolves to <code>null</code> if it shows no code editor within 200 ms, and throws an error when no tab is active.</p></td>
        </tr>
        <tr>
            <td><code>getActiveNoteDetailWidget</code></td>
            <td><pre><code class="language-application-typescript">getActiveNoteDetailWidget(): Promise&lt;unknown&gt;</code></pre><p>Get access to the widget handling note detail. Methods like <code>getWidgetType()</code> and <code>getTypeWidget()</code> to get to the implementation of actual widget type.</p></td>
        </tr>
        <tr>
            <td><code>getActiveContextNotePath</code></td>
            <td><pre><code class="language-application-typescript">getActiveContextNotePath(): string | null</code></pre><p><strong>Returns</strong> <code>string | null</code>: returns a note path of active note or null if there isn't active note</p></td>
        </tr>
        <tr>
            <td><code>getComponentByEl</code></td>
            <td><pre><code class="language-application-typescript">getComponentByEl(el: HTMLElement): unknown</code></pre><p>Returns component which owns the given DOM element (the nearest parent component in DOM tree)</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>el</code></td><td><code>HTMLElement</code><br>DOM element</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>showMessage</code></td>
            <td><pre><code class="language-application-typescript">showMessage(message: string, delay?: number): void</code></pre><p>Show an info toast message to the user.</p></td>
        </tr>
        <tr>
            <td><code>showError</code></td>
            <td><pre><code class="language-application-typescript">showError(message: string, delay?: number): void</code></pre><p>Show an error toast message to the user.</p></td>
        </tr>
        <tr>
            <td><code>showInfoDialog</code></td>
            <td><pre><code class="language-application-typescript">showInfoDialog(message: string): Promise&lt;void&gt;</code></pre><p>Show an info dialog to the user.</p></td>
        </tr>
        <tr>
            <td><code>showConfirmDialog</code></td>
            <td><pre><code class="language-application-typescript">showConfirmDialog(message: string): Promise&lt;boolean&gt;</code></pre><p>Show confirm dialog to the user.</p><p><strong>Returns</strong> <code>Promise&lt;boolean&gt;</code>: promise resolving to true if the user confirmed</p></td>
        </tr>
        <tr>
            <td><code>showPromptDialog</code></td>
            <td><pre><code class="language-application-typescript">showPromptDialog(props: { title?: string; message?: string; defaultValue?: string }): Promise&lt;string | null&gt;</code></pre><p>Show prompt dialog to the user.</p><p><strong>Returns</strong> <code>Promise&lt;string | null&gt;</code>: promise resolving to the answer provided by the user</p></td>
        </tr>
        <tr>
            <td><code>pickSingleItem</code></td>
            <td><pre><code class="language-application-typescript">pickSingleItem(props: { title?: string; items: PickerItem[] | PickerItemGroup[]; placeholder?: string }): Promise&lt;PickerItem | null&gt;</code></pre><p>Show a dialog for picking one item out of many, grouped and searchable.</p><p><code>items</code> are either the items themselves or groups of them, never the two mixed. Named for the one thing it does now: picking several at once will be a method of its own beside this.</p><p><strong>Returns</strong> <code>Promise&lt;</code><a href="#type-PickerItem"><code>PickerItem</code></a> | <code>null&gt;</code>: promise resolving to the item picked, or null where the user backed out.</p></td>
        </tr>
        <tr>
            <td><code>createLink</code></td>
            <td><pre><code class="language-application-typescript">createLink(notePath: string, params?: LinkOptions): Promise&lt;JQuery&gt;</code></pre><p>Create a note link (jQuery object) for given note.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>notePath</code></td><td><code>string</code><br>(or noteId)</td></tr><tr><td><code>params</code><br><em>optional</em></td><td><a href="#type-LinkOptions"><code>LinkOptions</code></a></td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;</code><a href="#type-JQuery"><code>JQuery</code></a><code>&gt;</code>: - jQuery element with the link (wrapped in <span>)</span></p></td>
        </tr>
        <tr>
            <td><code>createNoteLink</code></td>
            <td><pre><code class="language-application-typescript">createNoteLink(notePath: string, params?: LinkOptions): Promise&lt;JQuery&gt;</code></pre><aside class="admonition warning"><p>Deprecated. - use api.createLink() instead</p></aside></td>
        </tr>
        <tr>
            <td><code>triggerCommand</code></td>
            <td><pre><code class="language-application-typescript">triggerCommand(name: string, data?: Record&lt;string, unknown&gt;): Promise&lt;unknown&gt;</code></pre><p>Trigger command. This is a very low-level API which should be avoided if possible.</p></td>
        </tr>
        <tr>
            <td><code>triggerEvent</code></td>
            <td><pre><code class="language-application-typescript">triggerEvent(name: string, data?: Record&lt;string, unknown&gt;): Promise&lt;unknown&gt;</code></pre><p>Trigger event. This is a very low-level API which should be avoided if possible.</p></td>
        </tr>
        <tr>
            <td><code>setupElementTooltip</code></td>
            <td><pre><code class="language-application-typescript">setupElementTooltip(el: JQuery): void</code></pre><p>Shows a preview of the linked note while the mouse pointer rests on the element, as Trilium does for links in note content. The element must be a link whose <code>href</code> or <code>data-href</code> points to a note, such as <code>#root/abc123</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>el</code></td><td><a href="#type-JQuery"><code>JQuery</code></a><br>The link, as a jQuery object.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>protectNote</code></td>
            <td><pre><code class="language-application-typescript">protectNote(noteId: string, protect: boolean): Promise&lt;void&gt;</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code></td></tr><tr><td><code>protect</code></td><td><code>boolean</code><br>true to protect note, false to unprotect</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>protectSubTree</code></td>
            <td><pre><code class="language-application-typescript">protectSubTree(noteId: string, protect: boolean): Promise&lt;void&gt;</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code></td></tr><tr><td><code>protect</code></td><td><code>boolean</code><br>true to protect subtree, false to unprotect</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getTodayNote</code></td>
            <td><pre><code class="language-application-typescript">getTodayNote(): Promise&lt;FNote&gt;</code></pre><p>Returns date-note for today. If it doesn't exist, it is automatically created.</p></td>
        </tr>
        <tr>
            <td><code>getDayNote</code></td>
            <td><pre><code class="language-application-typescript">getDayNote(date: string): Promise&lt;FNote&gt;</code></pre><p>Returns day note for a given date. If it doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>e.g. "2019-04-29"</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getWeekFirstDayNote</code></td>
            <td><pre><code class="language-application-typescript">getWeekFirstDayNote(date: string): Promise&lt;FNote&gt;</code></pre><p>Returns day note for the first date of the week of the given date. If it doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>e.g. "2019-04-29"</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getWeekNote</code></td>
            <td><pre><code class="language-application-typescript">getWeekNote(date: string): Promise&lt;FNote&gt;</code></pre><p>Returns week note for given date. If such a note doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM-DD format</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getMonthNote</code></td>
            <td><pre><code class="language-application-typescript">getMonthNote(month: string): Promise&lt;FNote&gt;</code></pre><p>Returns month-note. If it doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>month</code></td><td><code>string</code><br>e.g. "2019-04"</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getQuarterNote</code></td>
            <td><pre><code class="language-application-typescript">getQuarterNote(date: string): Promise&lt;FNote&gt;</code></pre><p>Returns quarter note for given date. If such a note doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM format</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getYearNote</code></td>
            <td><pre><code class="language-application-typescript">getYearNote(year: string): Promise&lt;FNote&gt;</code></pre><p>Returns year-note. If it doesn't exist, it is automatically created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>year</code></td><td><code>string</code><br>e.g. "2019"</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setHoistedNoteId</code></td>
            <td><pre><code class="language-application-typescript">setHoistedNoteId(noteId: string): void</code></pre><p>Hoist note in the current tab. See <a href="https://triliumnext.github.io/Docs/Wiki/note-hoisting.html">https://triliumnext.github.io/Docs/Wiki/note-hoisting.html</a></p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code><br>set hoisted note. 'root' will effectively unhoist</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>bindGlobalShortcut</code></td>
            <td><pre><code class="language-application-typescript">bindGlobalShortcut(keyboardShortcut: string, handler: () =&gt; void, namespace?: string): void</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>keyboardShortcut</code></td><td><code>string</code><br>e.g. "ctrl+shift+a"</td></tr><tr><td><code>handler</code></td><td><code>() =&gt; void</code></td></tr><tr><td><code>namespace</code><br><em>optional</em></td><td><code>string</code><br>specify namespace of the handler for the cases where call for bind may be repeated. If a handler with this ID exists, it's replaced by the new handler.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>waitUntilSynced</code></td>
            <td><pre><code class="language-application-typescript">waitUntilSynced(): Promise&lt;unknown&gt;</code></pre><p>Trilium runs in a backend and frontend process, when something is changed on the backend from a script, frontend will get asynchronously synchronized.</p><p>This method returns a promise which resolves once all the backend -&gt; frontend synchronization is finished. Typical use case is when a new note has been created, we should wait until it is synced into frontend and only then activate it.</p></td>
        </tr>
        <tr>
            <td><code>refreshIncludedNote</code></td>
            <td><pre><code class="language-application-typescript">refreshIncludedNote(includedNoteId: string): void</code></pre><p>This will refresh all currently opened notes which have included note specified in the parameter</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>includedNoteId</code></td><td><code>string</code><br>noteId of the included note</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>randomString</code></td>
            <td><pre><code class="language-application-typescript">randomString(length: number): string</code></pre><p>Return randomly generated string of given length. This random string generation is NOT cryptographically secure.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>length</code></td><td><code>number</code><br>of the string</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: random string</p></td>
        </tr>
        <tr>
            <td><code>formatSize</code></td>
            <td><pre><code class="language-application-typescript">formatSize(size: number): string</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>size</code></td><td><code>number</code><br>in bytes</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: formatted string</p></td>
        </tr>
        <tr>
            <td><code>formatNoteSize</code></td>
            <td><pre><code class="language-application-typescript">formatNoteSize(size: number): string</code></pre><aside class="admonition warning"><p>Deprecated. - use api.formatSize()</p></aside><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>size</code></td><td><code>number</code><br>in bytes</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: formatted string</p></td>
        </tr>
        <tr>
            <td><code>htmlToMarkdown</code></td>
            <td><pre><code class="language-application-typescript">htmlToMarkdown(html: string): Promise&lt;string&gt;</code></pre><p>Converts the given HTML string to Markdown.</p><p>Unlike the backend API, this runs on the server (the HTML→Markdown converter is backend-only), so it returns a promise.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>html</code></td><td><code>string</code><br>HTML content to convert</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: Markdown representation of the input HTML</p></td>
        </tr>
        <tr>
            <td><code>markdownToHtml</code></td>
            <td><pre><code class="language-application-typescript">markdownToHtml(markdown: string): Promise&lt;string&gt;</code></pre><p>Converts the given Markdown string to HTML.</p><p>Runs entirely in the browser; the promise is only needed because the Markdown renderer is loaded on demand.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>markdown</code></td><td><code>string</code><br>Markdown content to convert</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: HTML representation of the input Markdown</p></td>
        </tr>
        <tr>
            <td><code>formatDateISO</code></td>
            <td><pre><code class="language-application-typescript">formatDateISO(date: Date): string</code></pre><p><strong>Returns</strong> <code>string</code>: date in YYYY-MM-DD format</p></td>
        </tr>
        <tr>
            <td><code>parseDate</code></td>
            <td><pre><code class="language-application-typescript">parseDate(str: string): Date</code></pre><p>Parses a date string into a Date.</p></td>
        </tr>
        <tr>
            <td><code>logMessages</code></td>
            <td><p><code>Record&lt;string, string[]&gt;</code><br>Per-note log message buffers shown in the UI log pane.</p></td>
        </tr>
        <tr>
            <td><code>logSpacedUpdates</code></td>
            <td><p><code>Record&lt;string, unknown&gt;</code><br>Per-note spaced-update handlers for the log pane.</p></td>
        </tr>
        <tr>
            <td><code>log</code></td>
            <td><pre><code class="language-application-typescript">log(...args: unknown[]): void</code></pre><p>Log given message to the log pane in UI. Accepts multiple arguments which are joined with spaces, similar to <code>console.log</code>.</p></td>
        </tr>
        <tr>
            <td><code>preact</code></td>
            <td><p><a href="#type-Preact"><code>Preact</code></a><br>The Preact API surface (components, hooks) for render scripts.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-FNote"></a>`FNote`

A note as seen by frontend scripts (subset of the client's `FNote`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string</code><br>The ID of the note.</p></td>
        </tr>
        <tr>
            <td><code>title</code></td>
            <td><p><code>string</code><br>The title of the note. For a protected note, it is <code>[protected]</code> until a protected session is started.</p></td>
        </tr>
        <tr>
            <td><code>type</code></td>
            <td><p><code>string</code><br>The note type, such as <code>text</code>, <code>code</code>, <code>file</code>, <code>image</code>, <code>search</code>, <code>book</code>, <code>render</code> or <code>launcher</code>.</p></td>
        </tr>
        <tr>
            <td><code>mime</code></td>
            <td><p><code>string</code><br>The MIME type of the note's content, such as <code>application/json</code>.</p></td>
        </tr>
        <tr>
            <td><code>isProtected</code></td>
            <td><p><code>boolean</code><br>Whether the note is protected (encrypted).</p></td>
        </tr>
        <tr>
            <td><code>isArchived</code></td>
            <td><p><code>boolean</code><br>Whether the note is archived (has the <code>archived</code> label).</p></td>
        </tr>
        <tr>
            <td><code>isMetadataReadOnly</code></td>
            <td><p><code>boolean</code><br>Whether the note's title and icon cannot be edited, which is the case for the system notes behind the options, the in-app help and the launch bar configuration.</p></td>
        </tr>
        <tr>
            <td><code>attributes</code></td>
            <td><p><code>string[]</code><br>IDs of this note's owned attributes.</p></td>
        </tr>
        <tr>
            <td><code>targetRelations</code></td>
            <td><p><code>string[]</code><br>IDs of relations pointing <em>at</em> this note.</p></td>
        </tr>
        <tr>
            <td><code>parents</code></td>
            <td><p><code>string[]</code><br>Parent note IDs.</p></td>
        </tr>
        <tr>
            <td><code>children</code></td>
            <td><p><code>string[]</code><br>Child note IDs.</p></td>
        </tr>
        <tr>
            <td><code>getParentNotes</code></td>
            <td><pre><code class="language-application-typescript">getParentNotes(): FNote[]</code></pre><p>Returns the parent notes that the client has already loaded. A parent that is not loaded is skipped, and a search note that shows this note in its results counts as a parent.</p></td>
        </tr>
        <tr>
            <td><code>getChildNotes</code></td>
            <td><pre><code class="language-application-typescript">getChildNotes(): Promise&lt;FNote[]&gt;</code></pre><p>Loads any missing child notes from the server, then returns all child notes in tree order. Archived children are included.</p></td>
        </tr>
        <tr>
            <td><code>getParentNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getParentNoteIds(): string[]</code></pre><p>Returns the IDs of the parent notes. The returned array is the note's own list, so do not change it.</p></td>
        </tr>
        <tr>
            <td><code>getChildNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getChildNoteIds(): string[]</code></pre><p>Returns the IDs of the child notes in tree order, archived ones included. The returned array is the note's own list, so do not change it.</p></td>
        </tr>
        <tr>
            <td><code>getChildNoteIdsWithArchiveFiltering</code></td>
            <td><pre><code class="language-application-typescript">getChildNoteIdsWithArchiveFiltering(includeArchived?: boolean): Promise&lt;string[]&gt;</code></pre><p>Returns the IDs of the child notes in tree order, leaving out archived notes unless <code>includeArchived</code> is <code>true</code>. Leaving out archived notes takes a search on the server; for a search note or a note in the hidden subtree, all children are returned.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>includeArchived</code><br><em>optional</em></td><td><code>boolean</code><br>whether to keep archived children. Defaults to <code>false</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getSubtreeNotes</code></td>
            <td><pre><code class="language-application-typescript">getSubtreeNotes(): Promise&lt;FNote[]&gt;</code></pre><p>Returns all descendants of the note, loading missing ones from the server one level at a time. An archived note and everything below it are left out, and the note itself is not included.</p></td>
        </tr>
        <tr>
            <td><code>getSubtreeNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getSubtreeNoteIds(includeArchived?: boolean): Promise&lt;string[]&gt;</code></pre><p>Returns the IDs of all the note's descendants, depth-first, without the note itself. Archived notes and the notes below them are left out unless <code>includeArchived</code> is <code>true</code>.</p></td>
        </tr>
        <tr>
            <td><code>hasChildren</code></td>
            <td><pre><code class="language-application-typescript">hasChildren(): boolean</code></pre><p>Returns <code>true</code> if the note has at least one child, archived ones included. For a search note, the results count as children only once they are loaded.</p></td>
        </tr>
        <tr>
            <td><code>hasAncestor</code></td>
            <td><pre><code class="language-application-typescript">hasAncestor(ancestorNoteId: string, followTemplates?: boolean): boolean</code></pre><p>Returns <code>true</code> if the note with the given ID is this note or one of its ancestors. It walks only parents the client has already loaded.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>ancestorNoteId</code></td><td><code>string</code></td></tr><tr><td><code>followTemplates</code><br><em>optional</em></td><td><code>boolean</code><br>whether to also walk up from the notes this note takes attributes from through <code>~template</code> and <code>~inherit</code> relations. Defaults to <code>false</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>isRoot</code></td>
            <td><pre><code class="language-application-typescript">isRoot(): boolean</code></pre><p>Returns <code>true</code> if this is the root note of the tree.</p></td>
        </tr>
        <tr>
            <td><code>getParentBranchIds</code></td>
            <td><pre><code class="language-application-typescript">getParentBranchIds(): string[]</code></pre><p>Returns the IDs of the branches that place this note under each of its parents.</p></td>
        </tr>
        <tr>
            <td><code>getBranchIds</code></td>
            <td><pre><code class="language-application-typescript">getBranchIds(): string[]</code></pre><p>Returns the IDs of the branches that place the note under its parents.</p><aside class="admonition warning"><p>Deprecated. Use <code>getParentBranchIds()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>getParentBranches</code></td>
            <td><pre><code class="language-application-typescript">getParentBranches(): FBranch[]</code></pre><p>Returns the branches that place this note under each of its parents. A branch the client has not loaded is skipped.</p></td>
        </tr>
        <tr>
            <td><code>getChildBranches</code></td>
            <td><pre><code class="language-application-typescript">getChildBranches(): FBranch[]</code></pre><p>Returns the branches to this note's children, in tree order. A branch the client has not loaded is skipped.</p></td>
        </tr>
        <tr>
            <td><code>getBranches</code></td>
            <td><pre><code class="language-application-typescript">getBranches(): FBranch[]</code></pre><p>Returns the branches that place the note under its parents.</p><aside class="admonition warning"><p>Deprecated. Use <code>getParentBranches()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>getFilteredChildBranches</code></td>
            <td><pre><code class="language-application-typescript">getFilteredChildBranches(): FBranch[]</code></pre><p>Returns the same branches as <code>getChildBranches()</code>. Despite the name, archived children are not filtered out.</p></td>
        </tr>
        <tr>
            <td><code>getAllNotePaths</code></td>
            <td><pre><code class="language-application-typescript">getAllNotePaths(): string[][]</code></pre><p>Returns every path from the root to the note, each as a list of note IDs that starts with <code>root</code>. Paths that pass through a search note are left out.</p></td>
        </tr>
        <tr>
            <td><code>getBestNotePath</code></td>
            <td><pre><code class="language-application-typescript">getBestNotePath(hoistedNoteId?: string, activeNotePath?: string | null): string[]</code></pre><p>Returns the note's best path as a list of note IDs that starts with <code>root</code>. Paths inside the hoisted note's subtree come first, then paths without archived or hidden notes; among equal paths, the one sharing the longest start with <code>activeNotePath</code> wins, then the shortest.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>The hoisted note, <code>root</code> by default.</td></tr><tr><td><code>activeNotePath</code><br><em>optional</em></td><td><code>string | null</code><br>The path of the active note, as note IDs joined by <code>/</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getBestNotePathString</code></td>
            <td><pre><code class="language-application-typescript">getBestNotePathString(hoistedNoteId?: string): string</code></pre><p>Returns the note's best path, as <code>getBestNotePath()</code> chooses it, as note IDs joined by <code>/</code>, such as <code>root/a1h315/js725h</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>The hoisted note, <code>root</code> by default.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getSortedNotePathRecords</code></td>
            <td><pre><code class="language-application-typescript">getSortedNotePathRecords(hoistedNoteId?: string, activeNotePath?: string | null): NotePathRecord[]</code></pre><p>Returns every path from the root to this note, best first. Paths inside the hoisted note come first, then paths that do not pass through an archived note or the hidden subtree, then paths that share the most with <code>activeNotePath</code>, then shorter paths. Paths through search notes are left out, and only parents the client has loaded are followed.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>the ID of the hoisted note. Defaults to <code>root</code>.</td></tr><tr><td><code>activeNotePath</code><br><em>optional</em></td><td><code>string | null</code><br>a note path such as <code>root/abc123/def456</code>, used to prefer paths close to it.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttributes</code></td>
            <td><pre><code class="language-application-typescript">getAttributes(type?: string, name?: string): Attribute[]</code></pre><p>Returns the note's attributes, including inherited ones, optionally only those of the given type and name. The note's own attributes come first, then the ones inherited from its parents, then the ones from its templates.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code><br><em>optional</em></td><td><code>string</code><br><code>label</code> or <code>relation</code>; any other value throws an error.</td></tr><tr><td><code>name</code><br><em>optional</em></td><td><code>string</code><br>The attribute name, without the <code>#</code> or <code>~</code> prefix.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttributes</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttributes(type?: string, name?: string): Attribute[]</code></pre><p>Returns the note's own attributes, without inherited ones, optionally only those of the given type and name.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code><br><em>optional</em></td><td><code>string</code><br><code>label</code> or <code>relation</code>; any other value throws an error.</td></tr><tr><td><code>name</code><br><em>optional</em></td><td><code>string</code><br>The attribute name, without the <code>#</code> or <code>~</code> prefix.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttribute</code></td>
            <td><pre><code class="language-application-typescript">getAttribute(type: string, name: string): Attribute | null</code></pre><p>Returns the first attribute of the given type and name, including inherited ones, or <code>undefined</code> if the note has none.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttribute</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttribute(type: string, name: string): Attribute | null</code></pre><p>Returns the first of the note's own attributes with the given type and name, or <code>undefined</code> if the note has none.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttributeValue</code></td>
            <td><pre><code class="language-application-typescript">getAttributeValue(type: string, name: string): string | null</code></pre><p>Returns the value of the first attribute of the given type and name, including inherited ones, or <code>null</code> if the note has none.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttributeValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttributeValue(type: string, name: string): string | null</code></pre><p>Returns the value of the first of the note's own attributes with the given type and name, or <code>null</code> if the note has none.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasAttribute</code></td>
            <td><pre><code class="language-application-typescript">hasAttribute(type: string, name: string): boolean</code></pre><p>Returns whether the note has an attribute of the given type and name, including inherited ones.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasOwnedAttribute</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedAttribute(type: string, name: string): boolean</code></pre><p>Returns whether the note itself has an attribute of the given type and name, without inherited ones.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>label</code> or <code>relation</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttributeDefinitions</code></td>
            <td><pre><code class="language-application-typescript">getAttributeDefinitions(): Attribute[]</code></pre><p>Returns the attribute definitions that apply to the note, at most one per defined name. When the note gets a definition from several places, such as its own, an ancestor's and a template's, the nearest one wins, in the order <code>getAttributes()</code> lists them.</p></td>
        </tr>
        <tr>
            <td><code>getPromotedDefinitionAttributes</code></td>
            <td><pre><code class="language-application-typescript">getPromotedDefinitionAttributes(): Attribute[]</code></pre><p>Returns the attribute definitions that are marked as promoted, at most one per name, grouped by the note that owns them and ordered by position. Returns an empty array if the note has a truthy <code>hidePromotedAttributes</code> label.</p></td>
        </tr>
        <tr>
            <td><code>getLabels</code></td>
            <td><pre><code class="language-application-typescript">getLabels(name?: string): Attribute[]</code></pre><p>Returns the note's labels, including inherited ones, optionally only those with <code>name</code>.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabels</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabels(name?: string): Attribute[]</code></pre><p>Returns the note's own labels, without inherited ones, optionally only those with <code>name</code>.</p></td>
        </tr>
        <tr>
            <td><code>getLabel</code></td>
            <td><pre><code class="language-application-typescript">getLabel(name: string): Attribute | null</code></pre><p>Returns the first label with the given name, including inherited ones, or <code>undefined</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabel</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabel(name: string): Attribute | null</code></pre><p>Returns the first of the note's own labels with the given name, or <code>undefined</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getLabelValue</code></td>
            <td><pre><code class="language-application-typescript">getLabelValue(name: string): string | null</code></pre><p>Returns the value of the first label with the given name, including inherited ones, or <code>null</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabelValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabelValue(name: string): string | null</code></pre><p>Returns the value of the first of the note's own labels with the given name, or <code>null</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>hasLabel</code></td>
            <td><pre><code class="language-application-typescript">hasLabel(name: string): boolean</code></pre><p>Returns whether the note has a label with the given name, including inherited ones.</p></td>
        </tr>
        <tr>
            <td><code>hasOwnedLabel</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedLabel(name: string): boolean</code></pre><p>Returns whether the note itself has a label with the given name, without inherited ones.</p></td>
        </tr>
        <tr>
            <td><code>hasLabelOrDisabled</code></td>
            <td><pre><code class="language-application-typescript">hasLabelOrDisabled(name: string): boolean</code></pre><p>Returns whether the note has a label with the given name, including inherited ones, or the same label with the <code>disabled:</code> prefix, which a safe import gives it.</p></td>
        </tr>
        <tr>
            <td><code>isLabelTruthy</code></td>
            <td><pre><code class="language-application-typescript">isLabelTruthy(name: string): boolean</code></pre><p>Returns whether the note has a label with the given name, including inherited ones, whose value is anything but <code>false</code>. A label without a value counts as true.</p></td>
        </tr>
        <tr>
            <td><code>getRelations</code></td>
            <td><pre><code class="language-application-typescript">getRelations(name?: string): Attribute[]</code></pre><p>Returns the note's relations, including inherited ones, optionally only those with <code>name</code>.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelations</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelations(name: string): Attribute[]</code></pre><p>Returns the note's own relations, without inherited ones, optionally only those with <code>name</code>.</p></td>
        </tr>
        <tr>
            <td><code>getRelation</code></td>
            <td><pre><code class="language-application-typescript">getRelation(name: string): Attribute | null</code></pre><p>Returns the first relation with the given name, including inherited ones, or <code>undefined</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelation</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelation(name: string): Attribute | null</code></pre><p>Returns the first of the note's own relations with the given name, or <code>undefined</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getRelationValue</code></td>
            <td><pre><code class="language-application-typescript">getRelationValue(name: string): string | null</code></pre><p>Returns the target note ID of the first relation with the given name, including inherited ones, or <code>null</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelationValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelationValue(name: string): string | null</code></pre><p>Returns the target note ID of the first of the note's own relations with the given name, or <code>null</code> if the note has none.</p></td>
        </tr>
        <tr>
            <td><code>hasRelation</code></td>
            <td><pre><code class="language-application-typescript">hasRelation(name: string): boolean</code></pre><p>Returns whether the note has a relation with the given name, including inherited ones.</p></td>
        </tr>
        <tr>
            <td><code>hasOwnedRelation</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedRelation(name: string): boolean</code></pre><p>Returns whether the note itself has a relation with the given name, without inherited ones.</p></td>
        </tr>
        <tr>
            <td><code>getLabelOrRelation</code></td>
            <td><pre><code class="language-application-typescript">getLabelOrRelation(nameWithPrefix: string): string | null</code></pre><p>Returns the value of a label or relation, inherited ones included, or <code>null</code> if the note has none. A relation's value is the ID of its target note.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>nameWithPrefix</code></td><td><code>string</code><br>the attribute name prefixed with <code>#</code> for a label or <code>~</code> for a relation. A name without a prefix is looked up as a label.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getRelationTarget</code></td>
            <td><pre><code class="language-application-typescript">getRelationTarget(name: string): Promise&lt;FNote | null&gt;</code></pre><p>Returns the target note of the first relation with the given name, including inherited ones. Returns <code>null</code> if the note has no such relation, the relation has no target, or the target note does not exist.</p></td>
        </tr>
        <tr>
            <td><code>getRelationTargets</code></td>
            <td><pre><code class="language-application-typescript">getRelationTargets(name: string): Promise&lt;(FNote | null)[]&gt;</code></pre><p>Returns the target notes of the note's relations with the given name, including inherited ones, in the order of the relations. A relation whose target is missing gives <code>null</code>.</p></td>
        </tr>
        <tr>
            <td><code>getTargetRelations</code></td>
            <td><pre><code class="language-application-typescript">getTargetRelations(): Attribute[]</code></pre><p>Returns the relations, owned by any note, that point at this note.</p></td>
        </tr>
        <tr>
            <td><code>getTargetRelationSourceNotes</code></td>
            <td><pre><code class="language-application-typescript">getTargetRelationSourceNotes(): Promise&lt;FNote[]&gt;</code></pre><p>Returns the notes that own a relation pointing at this note.</p></td>
        </tr>
        <tr>
            <td><code>getContent</code></td>
            <td><pre><code class="language-application-typescript">getContent(): Promise&lt;string | Uint8Array&lt;ArrayBufferLike&gt;&gt;</code></pre><p>Fetches the note's content from the server. Resolves to a string for text-based notes; for a binary note such as an image or file, the content is not sent, and for a protected note without a protected session, it is an empty string.</p></td>
        </tr>
        <tr>
            <td><code>getJsonContent</code></td>
            <td><pre><code class="language-application-typescript">getJsonContent(): Promise&lt;unknown&gt;</code></pre><p>Fetches the note's content and parses it as JSON. Resolves to <code>null</code> if the content is empty, is not a string, or is not valid JSON.</p></td>
        </tr>
        <tr>
            <td><code>getBlob</code></td>
            <td><pre><code class="language-application-typescript">getBlob(): Promise&lt;Blob | null&gt;</code></pre><p>Fetches the note's content together with its blob ID, length and modification date. Resolves to <code>null</code> if the request fails.</p></td>
        </tr>
        <tr>
            <td><code>getNoteComplement</code></td>
            <td><pre><code class="language-application-typescript">getNoteComplement(): Promise&lt;Blob | null&gt;</code></pre><p>Returns the blob that holds the note's content.</p><aside class="admonition warning"><p>Deprecated. Use <code>getBlob()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>getMetadata</code></td>
            <td><pre><code class="language-application-typescript">getMetadata(): Promise&lt;NoteMetadata&gt;</code></pre><p>Returns the note's creation and modification dates, which it requests from the server.</p></td>
        </tr>
        <tr>
            <td><code>attachments</code></td>
            <td><p><a href="#type-Attachment"><code>Attachment</code></a><code>[] | null</code><br>The note's attachments, or <code>null</code> until <code>getAttachments()</code> loads them. Use <code>getAttachments()</code> instead of reading this property.</p></td>
        </tr>
        <tr>
            <td><code>getAttachments</code></td>
            <td><pre><code class="language-application-typescript">getAttachments(): Promise&lt;Attachment[]&gt;</code></pre><p>Returns the note's attachments. The first call loads them from the server, and later calls reuse that list.</p></td>
        </tr>
        <tr>
            <td><code>getAttachmentsByRole</code></td>
            <td><pre><code class="language-application-typescript">getAttachmentsByRole(role: string): Promise&lt;Attachment[]&gt;</code></pre><p>Returns the note's attachments with the given role, such as <code>image</code> or <code>file</code>.</p></td>
        </tr>
        <tr>
            <td><code>getAttachmentById</code></td>
            <td><pre><code class="language-application-typescript">getAttachmentById(attachmentId: string): Promise&lt;Attachment | undefined&gt;</code></pre><p>Returns the note's attachment with the given ID, or <code>undefined</code> if this note has no such attachment.</p></td>
        </tr>
        <tr>
            <td><code>getNotesToInheritAttributesFrom</code></td>
            <td><pre><code class="language-application-typescript">getNotesToInheritAttributesFrom(): FNote[]</code></pre><p>Returns the target notes of this note's <code>~template</code> and <code>~inherit</code> relations, inherited relations included. A target note that the client has not loaded appears as <code>undefined</code>.</p></td>
        </tr>
        <tr>
            <td><code>getIcon</code></td>
            <td><pre><code class="language-application-typescript">getIcon(): string</code></pre><p>Returns the CSS classes of the note's icon, such as <code>tn-icon bx bx-note</code>. The icon comes from the <code>iconClass</code> label, then the <code>workspaceIconClass</code> label, then a default for the note type.</p></td>
        </tr>
        <tr>
            <td><code>isFolder</code></td>
            <td><pre><code class="language-application-typescript">isFolder(): boolean</code></pre><p>Returns <code>true</code> if the note shows as a folder in the tree: a search note, or a note with children (archived ones included). Always <code>false</code> when the note has a truthy <code>subtreeHidden</code> label.</p></td>
        </tr>
        <tr>
            <td><code>isShared</code></td>
            <td><pre><code class="language-application-typescript">isShared(): boolean</code></pre><p>Returns <code>true</code> if the note is placed, directly or through ancestors the client has loaded, under the shared notes root (<code>_share</code>).</p></td>
        </tr>
        <tr>
            <td><code>isContentAvailable</code></td>
            <td><pre><code class="language-application-typescript">isContentAvailable(): boolean</code></pre><p>Returns <code>true</code> if the note's content can be read: the note is not protected, or a protected session is active.</p></td>
        </tr>
        <tr>
            <td><code>isJson</code></td>
            <td><pre><code class="language-application-typescript">isJson(): boolean</code></pre><p>Returns <code>true</code> if the note's MIME type is <code>application/json</code>.</p></td>
        </tr>
        <tr>
            <td><code>isJavaScript</code></td>
            <td><pre><code class="language-application-typescript">isJavaScript(): boolean</code></pre><p>Returns whether the note is a code, file or launcher note with a JavaScript MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isJsx</code></td>
            <td><pre><code class="language-application-typescript">isJsx(): boolean</code></pre><p>Returns <code>true</code> if the note is a code note with the MIME type <code>text/jsx</code>.</p></td>
        </tr>
        <tr>
            <td><code>isHtml</code></td>
            <td><pre><code class="language-application-typescript">isHtml(): boolean</code></pre><p>Returns whether the note is a code, file or render note with the <code>text/html</code> MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isMarkdown</code></td>
            <td><pre><code class="language-application-typescript">isMarkdown(): boolean</code></pre><p>Returns <code>true</code> if the note is a code note with a Markdown MIME type (<code>text/markdown</code>, <code>text/x-markdown</code> or <code>text/x-gfm</code>).</p></td>
        </tr>
        <tr>
            <td><code>isOptions</code></td>
            <td><pre><code class="language-application-typescript">isOptions(): boolean</code></pre><p>Returns <code>true</code> if the note is one of Trilium's settings pages.</p></td>
        </tr>
        <tr>
            <td><code>isTriliumScript</code></td>
            <td><pre><code class="language-application-typescript">isTriliumScript(): boolean</code></pre><p>Returns <code>true</code> if the note's MIME type starts with <code>application/javascript</code>, which covers both frontend and backend scripts. The note type is not checked.</p></td>
        </tr>
        <tr>
            <td><code>isTriliumSqlite</code></td>
            <td><pre><code class="language-application-typescript">isTriliumSqlite(): boolean</code></pre><p>Returns <code>true</code> if the note is a SQL console note, which has the MIME type <code>text/x-sqlite;schema=trilium</code>.</p></td>
        </tr>
        <tr>
            <td><code>isLaunchBarConfig</code></td>
            <td><pre><code class="language-application-typescript">isLaunchBarConfig(): boolean</code></pre><p>Returns <code>true</code> if the note is a launcher or one of the notes that hold the launch bar's launchers.</p></td>
        </tr>
        <tr>
            <td><code>isHiddenCompletely</code></td>
            <td><pre><code class="language-application-typescript">isHiddenCompletely(): boolean</code></pre><p>Returns whether every path to the note runs through the hidden subtree, so that no clone of it appears in the visible tree. Paths through search notes are not counted.</p></td>
        </tr>
        <tr>
            <td><code>isInHiddenSubtree</code></td>
            <td><pre><code class="language-application-typescript">isInHiddenSubtree(): boolean</code></pre><p>Returns <code>true</code> if the note is the hidden subtree's root (<code>_hidden</code>) or has it as an ancestor through any of its loaded parents, even when the note is also cloned into the visible tree.</p></td>
        </tr>
        <tr>
            <td><code>isEligibleForConversionToAttachment</code></td>
            <td><pre><code class="language-application-typescript">isEligibleForConversionToAttachment(): boolean</code></pre><p>Returns <code>true</code> if the image note can be converted into an attachment of its parent: it is an image note without children, it has exactly one parent, that parent is a text note, the content of both is available, and no note other than the parent links to the image.</p></td>
        </tr>
        <tr>
            <td><code>getColorClass</code></td>
            <td><pre><code class="language-application-typescript">getColorClass(): string</code></pre><p>Returns the CSS class that applies the note's <code>color</code> label, such as <code>color-ff0000</code>, or an empty string if the label is missing or not a valid color. The first call for a color adds the class's style rule to the page.</p></td>
        </tr>
        <tr>
            <td><code>getCssClass</code></td>
            <td><pre><code class="language-application-typescript">getCssClass(): string</code></pre><p>Returns the values of all the note's <code>cssClass</code> labels, inherited ones included, separated by spaces.</p></td>
        </tr>
        <tr>
            <td><code>getWorkspaceIconClass</code></td>
            <td><pre><code class="language-application-typescript">getWorkspaceIconClass(): string</code></pre><p>Returns the value of the note's <code>workspaceIconClass</code> label, or an empty string if it has none.</p></td>
        </tr>
        <tr>
            <td><code>getWorkspaceTabBackgroundColor</code></td>
            <td><pre><code class="language-application-typescript">getWorkspaceTabBackgroundColor(): string</code></pre><p>Returns the value of the note's <code>workspaceTabBackgroundColor</code> label, or an empty string if it has none.</p></td>
        </tr>
        <tr>
            <td><code>getScriptEnv</code></td>
            <td><pre><code class="language-application-typescript">getScriptEnv(): "frontend" | "backend" | null</code></pre><p>Returns where the note runs as a script: <code>frontend</code> for HTML, JSX, render notes and JavaScript with <code>env=frontend</code> in its MIME type, <code>backend</code> for JavaScript with <code>env=backend</code>, and <code>null</code> for any other note.</p></td>
        </tr>
        <tr>
            <td><code>executeScript</code></td>
            <td><pre><code class="language-application-typescript">executeScript(): Promise&lt;unknown&gt;</code></pre><p>Runs the note as a frontend or backend script, depending on <code>getScriptEnv()</code>. For a frontend script, the promise resolves to the value the script returns; for a backend script, it resolves to <code>undefined</code> once the script has run. A frontend script that fails shows its error and resolves to <code>undefined</code>.</p></td>
        </tr>
        <tr>
            <td><code>blobId</code></td>
            <td><p><code>string</code><br>Blob ID of the current content; changes when content changes.</p></td>
        </tr>
        <tr>
            <td><code>parentToBranch</code></td>
            <td><p><code>Record&lt;string, string&gt;</code><br>Map of parent note ID → branch ID.</p></td>
        </tr>
        <tr>
            <td><code>childToBranch</code></td>
            <td><p><code>Record&lt;string, string&gt;</code><br>Map of child note ID → branch ID.</p></td>
        </tr>
        <tr>
            <td><code>searchResultsLoaded</code><br><em>optional</em></td>
            <td><p><code>boolean</code><br>For a search note, <code>true</code> once its results have been loaded as its children; otherwise not set.</p></td>
        </tr>
        <tr>
            <td><code>highlightedTokens</code><br><em>optional</em></td>
            <td><p><code>string[]</code><br>For a search note whose results are loaded, the search words to highlight in those results; otherwise not set.</p></td>
        </tr>
        <tr>
            <td><code>dto</code></td>
            <td><p><code>Record&lt;string, unknown&gt;</code><br>Plain data representation of the note (the live object minus its cache handle).</p></td>
        </tr>
        <tr>
            <td><code>addParent</code></td>
            <td><pre><code class="language-application-typescript">addParent(parentNoteId: string, branchId: string, sort?: boolean): void</code></pre><p>Adds a parent to this note in the client's cache only. Trilium calls it when it loads branches; scripts do not normally call it, and the change is not saved. To place a note under another, use <code>api.runOnBackend()</code> with the backend API.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>parentNoteId</code></td><td><code>string</code></td></tr><tr><td><code>branchId</code></td><td><code>string</code><br>the ID of the branch that links the two notes.</td></tr><tr><td><code>sort</code><br><em>optional</em></td><td><code>boolean</code><br>whether to reorder the parents afterwards. Defaults to <code>true</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>addChild</code></td>
            <td><pre><code class="language-application-typescript">addChild(childNoteId: string, branchId: string, sort?: boolean): void</code></pre><p>Adds a child to this note in the client's cache only. Trilium calls it when it loads branches; scripts do not normally call it, and the change is not saved.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>childNoteId</code></td><td><code>string</code></td></tr><tr><td><code>branchId</code></td><td><code>string</code><br>the ID of the branch that links the two notes.</td></tr><tr><td><code>sort</code><br><em>optional</em></td><td><code>boolean</code><br>whether to reorder the children by their position afterwards. Defaults to <code>true</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>sortParents</code></td>
            <td><pre><code class="language-application-typescript">sortParents(): void</code></pre><p>Reorders the parent list in the client's cache so that ordinary parents come before search notes, archived notes and notes outside the visible tree. Trilium calls it itself; scripts do not normally call it.</p></td>
        </tr>
        <tr>
            <td><code>sortChildren</code></td>
            <td><pre><code class="language-application-typescript">sortChildren(): void</code></pre><p>Reorders the child list in the client's cache by each branch's position. Trilium calls it itself; scripts do not normally call it, and it does not change the order saved in the database.</p></td>
        </tr>
        <tr>
            <td><code>update</code></td>
            <td><pre><code class="language-application-typescript">update(row: Record&lt;string, unknown&gt;): void</code></pre><p>Overwrites the note's ID, title, type, MIME type, protection flag and blob ID in the client's cache with the values in <code>row</code>. Trilium calls it when changes arrive from the server; scripts do not normally call it, and the change is not saved.</p></td>
        </tr>
        <tr>
            <td><code>invalidateAttributeCache</code></td>
            <td><pre><code class="language-application-typescript">invalidateAttributeCache(): void</code></pre><p>Does nothing; the note's attributes stay up to date without it.</p><aside class="admonition warning"><p>Deprecated. Remove the call.</p></aside></td>
        </tr>
        <tr>
            <td><code>toString</code></td>
            <td><pre><code class="language-application-typescript">toString(): string</code></pre><p>Returns a short description of the note for logging, such as <code>Note(noteId=abc123, title=My note)</code>.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-RightPanelWidget"></a>`RightPanelWidget`

Instance shape of [`RightPanelWidget`](#type-RightPanelWidget) (subset) — a widget shown in the right sidebar.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>$widget</code></td>
            <td><p><a href="#type-JQuery"><code>JQuery</code></a><br>The widget's root element, which <code>doRender()</code> assigns, such as <code>this.$widget = $(TPL)</code>.</p></td>
        </tr>
        <tr>
            <td><code>isEnabled</code></td>
            <td><pre><code class="language-application-typescript">isEnabled(): boolean | null | undefined</code></pre><p>Returns whether the widget is shown: always for a <a href="#type-BasicWidget"><code>BasicWidget</code></a>, and only while a note is active for a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a>. A disabled widget stays in the DOM, hidden, and a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a> does not call <code>refreshWithNote()</code> while it is disabled.</p></td>
        </tr>
        <tr>
            <td><code>doRender</code></td>
            <td><pre><code class="language-application-typescript">doRender(): void</code></pre><p>Builds the widget's DOM. Override it to create the root element and assign it to <code>this.$widget</code> as a jQuery object.</p></td>
        </tr>
        <tr>
            <td><code>render</code></td>
            <td><pre><code class="language-application-typescript">render(): JQuery</code></pre><p>Renders the widget and returns its root element.</p></td>
        </tr>
        <tr>
            <td><code>cleanup</code></td>
            <td><pre><code class="language-application-typescript">cleanup(): void</code></pre><p>Tears down the widget; override to release resources.</p></td>
        </tr>
        <tr>
            <td><code>toggleInt</code></td>
            <td><pre><code class="language-application-typescript">toggleInt(show: boolean | null | undefined): void</code></pre><p>Shows or hides the widget from inside the widget itself, such as from <code>refreshWithNote()</code> when the note does not apply.</p></td>
        </tr>
        <tr>
            <td><code>id</code></td>
            <td><pre><code class="language-application-typescript">id(id: string): this</code></pre><p>Fluent builder: set the element id. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>class</code></td>
            <td><pre><code class="language-application-typescript">class(className: string): this</code></pre><p>Fluent builder: add a CSS class. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>css</code></td>
            <td><pre><code class="language-application-typescript">css(name: string, value: string): this</code></pre><p>Sets an inline CSS property on the widget's root element, such as <code>css("padding-inline-start", "12px")</code>, and returns the widget for chaining. It takes effect when the widget renders.</p></td>
        </tr>
        <tr>
            <td><code>child</code></td>
            <td><pre><code class="language-application-typescript">child(...components: unknown[]): this</code></pre><p>Fluent builder: append child components. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>note</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a> | <code>null</code><br>The note currently shown in this widget's context.</p></td>
        </tr>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string | undefined</code><br>The ID of <code>note</code>, such as for <code>loadResults.isNoteContentReloaded(this.noteId)</code>.</p></td>
        </tr>
        <tr>
            <td><code>notePath</code></td>
            <td><p><code>string | null | undefined</code><br>The path of <code>note</code> in the tree, such as <code>root/abc123/def456</code>.</p></td>
        </tr>
        <tr>
            <td><code>ntxId</code></td>
            <td><p><code>string | null | undefined</code><br>The ID of the note context (split) this widget is attached to.</p></td>
        </tr>
        <tr>
            <td><code>noteContext</code><br><em>optional</em></td>
            <td><p><a href="#type-NoteContext"><code>NoteContext</code></a><br>The note context (split) this widget is attached to.</p></td>
        </tr>
        <tr>
            <td><code>isNote</code></td>
            <td><pre><code class="language-application-typescript">isNote(noteId: string): boolean</code></pre><p>Returns whether <code>noteId</code> is the note shown in this widget's context.</p></td>
        </tr>
        <tr>
            <td><code>refreshWithNote</code></td>
            <td><pre><code class="language-application-typescript">refreshWithNote(note: FNote | null | undefined): void | Promise&lt;void&gt;</code></pre><p>Updates the widget for the note in its context. Override it to refresh the widget's content; it runs when that note changes and on <code>refresh()</code>, as long as <code>isEnabled()</code> returns <code>true</code>.</p></td>
        </tr>
        <tr>
            <td><code>refresh</code></td>
            <td><pre><code class="language-application-typescript">refresh(): void | Promise&lt;void&gt;</code></pre><p>Forces a refresh against the current note.</p></td>
        </tr>
        <tr>
            <td><code>widgetTitle</code></td>
            <td><p><code>string</code><br>The title shown in the panel's header, <code>Untitled widget</code> unless overridden. The panel reads it once, when it renders.</p></td>
        </tr>
        <tr>
            <td><code>doRenderBody</code></td>
            <td><pre><code class="language-application-typescript">doRenderBody(): void | Promise&lt;void&gt;</code></pre><p>Builds the panel's body. Override it to fill <code>this.$body</code>, the jQuery element the panel creates for the content, instead of <code>doRender()</code>. It can return a promise when the body needs asynchronous work; an error that promise rejects with is logged.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-NoteContextAwareWidget"></a>`NoteContextAwareWidget`

Instance shape of [`NoteContextAwareWidget`](#type-NoteContextAwareWidget) (subset) — reacts to the active note.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>$widget</code></td>
            <td><p><a href="#type-JQuery"><code>JQuery</code></a><br>The widget's root element, which <code>doRender()</code> assigns, such as <code>this.$widget = $(TPL)</code>.</p></td>
        </tr>
        <tr>
            <td><code>isEnabled</code></td>
            <td><pre><code class="language-application-typescript">isEnabled(): boolean | null | undefined</code></pre><p>Returns whether the widget is shown: always for a <a href="#type-BasicWidget"><code>BasicWidget</code></a>, and only while a note is active for a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a>. A disabled widget stays in the DOM, hidden, and a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a> does not call <code>refreshWithNote()</code> while it is disabled.</p></td>
        </tr>
        <tr>
            <td><code>doRender</code></td>
            <td><pre><code class="language-application-typescript">doRender(): void</code></pre><p>Builds the widget's DOM. Override it to create the root element and assign it to <code>this.$widget</code> as a jQuery object.</p></td>
        </tr>
        <tr>
            <td><code>render</code></td>
            <td><pre><code class="language-application-typescript">render(): JQuery</code></pre><p>Renders the widget and returns its root element.</p></td>
        </tr>
        <tr>
            <td><code>cleanup</code></td>
            <td><pre><code class="language-application-typescript">cleanup(): void</code></pre><p>Tears down the widget; override to release resources.</p></td>
        </tr>
        <tr>
            <td><code>toggleInt</code></td>
            <td><pre><code class="language-application-typescript">toggleInt(show: boolean | null | undefined): void</code></pre><p>Shows or hides the widget from inside the widget itself, such as from <code>refreshWithNote()</code> when the note does not apply.</p></td>
        </tr>
        <tr>
            <td><code>id</code></td>
            <td><pre><code class="language-application-typescript">id(id: string): this</code></pre><p>Fluent builder: set the element id. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>class</code></td>
            <td><pre><code class="language-application-typescript">class(className: string): this</code></pre><p>Fluent builder: add a CSS class. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>css</code></td>
            <td><pre><code class="language-application-typescript">css(name: string, value: string): this</code></pre><p>Sets an inline CSS property on the widget's root element, such as <code>css("padding-inline-start", "12px")</code>, and returns the widget for chaining. It takes effect when the widget renders.</p></td>
        </tr>
        <tr>
            <td><code>child</code></td>
            <td><pre><code class="language-application-typescript">child(...components: unknown[]): this</code></pre><p>Fluent builder: append child components. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>note</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a> | <code>null</code><br>The note currently shown in this widget's context.</p></td>
        </tr>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string | undefined</code><br>The ID of <code>note</code>, such as for <code>loadResults.isNoteContentReloaded(this.noteId)</code>.</p></td>
        </tr>
        <tr>
            <td><code>notePath</code></td>
            <td><p><code>string | null | undefined</code><br>The path of <code>note</code> in the tree, such as <code>root/abc123/def456</code>.</p></td>
        </tr>
        <tr>
            <td><code>ntxId</code></td>
            <td><p><code>string | null | undefined</code><br>The ID of the note context (split) this widget is attached to.</p></td>
        </tr>
        <tr>
            <td><code>noteContext</code><br><em>optional</em></td>
            <td><p><a href="#type-NoteContext"><code>NoteContext</code></a><br>The note context (split) this widget is attached to.</p></td>
        </tr>
        <tr>
            <td><code>isNote</code></td>
            <td><pre><code class="language-application-typescript">isNote(noteId: string): boolean</code></pre><p>Returns whether <code>noteId</code> is the note shown in this widget's context.</p></td>
        </tr>
        <tr>
            <td><code>refreshWithNote</code></td>
            <td><pre><code class="language-application-typescript">refreshWithNote(note: FNote | null | undefined): void | Promise&lt;void&gt;</code></pre><p>Updates the widget for the note in its context. Override it to refresh the widget's content; it runs when that note changes and on <code>refresh()</code>, as long as <code>isEnabled()</code> returns <code>true</code>.</p></td>
        </tr>
        <tr>
            <td><code>refresh</code></td>
            <td><pre><code class="language-application-typescript">refresh(): void | Promise&lt;void&gt;</code></pre><p>Forces a refresh against the current note.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-BasicWidget"></a>`BasicWidget`

Instance shape of [`BasicWidget`](#type-BasicWidget) (subset) — the base for custom frontend widgets.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>$widget</code></td>
            <td><p><a href="#type-JQuery"><code>JQuery</code></a><br>The widget's root element, which <code>doRender()</code> assigns, such as <code>this.$widget = $(TPL)</code>.</p></td>
        </tr>
        <tr>
            <td><code>isEnabled</code></td>
            <td><pre><code class="language-application-typescript">isEnabled(): boolean | null | undefined</code></pre><p>Returns whether the widget is shown: always for a <a href="#type-BasicWidget"><code>BasicWidget</code></a>, and only while a note is active for a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a>. A disabled widget stays in the DOM, hidden, and a <a href="#type-NoteContextAwareWidget"><code>NoteContextAwareWidget</code></a> does not call <code>refreshWithNote()</code> while it is disabled.</p></td>
        </tr>
        <tr>
            <td><code>doRender</code></td>
            <td><pre><code class="language-application-typescript">doRender(): void</code></pre><p>Builds the widget's DOM. Override it to create the root element and assign it to <code>this.$widget</code> as a jQuery object.</p></td>
        </tr>
        <tr>
            <td><code>render</code></td>
            <td><pre><code class="language-application-typescript">render(): JQuery</code></pre><p>Renders the widget and returns its root element.</p></td>
        </tr>
        <tr>
            <td><code>cleanup</code></td>
            <td><pre><code class="language-application-typescript">cleanup(): void</code></pre><p>Tears down the widget; override to release resources.</p></td>
        </tr>
        <tr>
            <td><code>toggleInt</code></td>
            <td><pre><code class="language-application-typescript">toggleInt(show: boolean | null | undefined): void</code></pre><p>Shows or hides the widget from inside the widget itself, such as from <code>refreshWithNote()</code> when the note does not apply.</p></td>
        </tr>
        <tr>
            <td><code>id</code></td>
            <td><pre><code class="language-application-typescript">id(id: string): this</code></pre><p>Fluent builder: set the element id. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>class</code></td>
            <td><pre><code class="language-application-typescript">class(className: string): this</code></pre><p>Fluent builder: add a CSS class. Chainable.</p></td>
        </tr>
        <tr>
            <td><code>css</code></td>
            <td><pre><code class="language-application-typescript">css(name: string, value: string): this</code></pre><p>Sets an inline CSS property on the widget's root element, such as <code>css("padding-inline-start", "12px")</code>, and returns the widget for chaining. It takes effect when the widget renders.</p></td>
        </tr>
        <tr>
            <td><code>child</code></td>
            <td><pre><code class="language-application-typescript">child(...components: unknown[]): this</code></pre><p>Fluent builder: append child components. Chainable.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-FBranch"></a>`FBranch`

A branch (parent↔child link) as seen by frontend scripts (subset of `FBranch`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>branchId</code></td>
            <td><p><code>string</code><br>The unique ID of the branch.</p></td>
        </tr>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string</code><br>The ID of the child note that this branch places in the tree.</p></td>
        </tr>
        <tr>
            <td><code>parentNoteId</code></td>
            <td><p><code>string</code><br>The ID of the parent note.</p></td>
        </tr>
        <tr>
            <td><code>notePosition</code></td>
            <td><p><code>number</code><br>The place of the note among its siblings; the note tree lists siblings by ascending <code>notePosition</code>. Trilium spaces positions 10 apart.</p></td>
        </tr>
        <tr>
            <td><code>prefix</code><br><em>optional</em></td>
            <td><p><code>string</code><br>The prefix shown before the note's title in the note tree, for this placement of the note only. It is empty or missing when the branch has none.</p></td>
        </tr>
        <tr>
            <td><code>isExpanded</code><br><em>optional</em></td>
            <td><p><code>boolean</code><br>Whether the note tree shows this branch expanded, with the note's children visible.</p></td>
        </tr>
        <tr>
            <td><code>getNote</code></td>
            <td><pre><code class="language-application-typescript">getNote(): Promise&lt;FNote | null&gt;</code></pre><p>Returns the child note, loading it from the server if the frontend cache does not hold it yet. Resolves to <code>null</code> if the note does not exist.</p></td>
        </tr>
        <tr>
            <td><code>getNoteFromCache</code></td>
            <td><pre><code class="language-application-typescript">getNoteFromCache(): FNote | undefined</code></pre><p>Returns the child note from the frontend cache, without contacting the server. Returns <code>undefined</code> if the note is not loaded yet.</p></td>
        </tr>
        <tr>
            <td><code>getParentNote</code></td>
            <td><pre><code class="language-application-typescript">getParentNote(): Promise&lt;FNote | null&gt;</code></pre><p>Returns the parent note, loading it from the server if the frontend cache does not hold it yet. Resolves to <code>null</code> if the note does not exist.</p></td>
        </tr>
        <tr>
            <td><code>isTopLevel</code></td>
            <td><pre><code class="language-application-typescript">isTopLevel(): boolean</code></pre><p>Returns whether the branch places its note directly under the root note.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-NoteContext"></a>`NoteContext`

A split/tab context as seen by frontend scripts (subset of `NoteContext`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>ntxId</code></td>
            <td><p><code>string | null</code><br>The ID of the note context, which identifies one tab or split.</p></td>
        </tr>
        <tr>
            <td><code>note</code></td>
            <td><p><a href="#type-FNote"><code>FNote</code></a> | <code>null</code><br>The note this context shows, or <code>null</code> if the context is empty.</p></td>
        </tr>
        <tr>
            <td><code>notePath</code></td>
            <td><p><code>string | null</code><br>The path of the note this context shows, as note IDs from <code>root</code> joined by <code>/</code>, such as <code>root/abc123/def456</code>. It is <code>null</code> when the context is empty.</p></td>
        </tr>
        <tr>
            <td><code>getCodeEditor</code></td>
            <td><pre><code class="language-application-typescript">getCodeEditor(): Promise&lt;CodeEditor | null&gt;</code></pre><p>Returns the CodeMirror editor of the code note this context shows. Resolves to <code>null</code> if the context shows no code editor within 200 ms.</p></td>
        </tr>
        <tr>
            <td><code>getTextEditor</code></td>
            <td><pre><code class="language-application-typescript">getTextEditor(): Promise&lt;TextEditor | null&gt;</code></pre><p>Returns the CKEditor instance of the editable text note this context shows. Resolves to <code>null</code> if the context shows no editable text note within 200 ms.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-DayjsInstance"></a>`DayjsInstance`

A date as day.js wraps it (subset).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>format</code></td>
            <td><pre><code class="language-application-typescript">format(template?: string): string</code></pre><p>Formats the date, such as <code>"YYYY-MM-DD"</code> for <code>2026-10-22</code>. Without a template, it returns the ISO 8601 form with the UTC offset, such as <code>2026-10-22T14:03:05+02:00</code>.</p></td>
        </tr>
        <tr>
            <td><code>add</code></td>
            <td><pre><code class="language-application-typescript">add(value: number, unit: string): DayjsInstance</code></pre><p>Returns a new date, <code>value</code> units later. The date it is called on stays unchanged.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>value</code></td><td><code>number</code></td></tr><tr><td><code>unit</code></td><td><code>string</code><br>The unit, such as <code>"day"</code>, <code>"week"</code>, <code>"month"</code> or <code>"year"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>subtract</code></td>
            <td><pre><code class="language-application-typescript">subtract(value: number, unit: string): DayjsInstance</code></pre><p>Returns a new date, <code>value</code> units earlier. The date it is called on stays unchanged.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>value</code></td><td><code>number</code></td></tr><tr><td><code>unit</code></td><td><code>string</code><br>The unit, such as <code>"day"</code>, <code>"week"</code>, <code>"month"</code> or <code>"year"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>toDate</code></td>
            <td><pre><code class="language-application-typescript">toDate(): Date</code></pre><p>Returns the date as a JavaScript <code>Date</code>.</p></td>
        </tr>
    </tbody>
</table>

## Types

### <a id="type-JQuery"></a>`JQuery`

A jQuery object: one or more page elements with jQuery's methods, as `$(…)` returns. The [jQuery API documentation](https://api.jquery.com/) describes them, and the script editor offers them as completions.

### <a id="type-Dayjs"></a>`Dayjs`

Minimal day.js surface (the real API exposes the full day.js factory).

```typescript
type Dayjs = (date?: string | number | Date) => DayjsInstance
```

### <a id="type-WidgetClass"></a>`WidgetClass`

Constructor type allowing `class X extends api.Widget { … }`.

```typescript
type WidgetClass<T> = new (...args: unknown[]) => T
```

### <a id="type-Func"></a>`Func`

```typescript
type Func = ((...args: unknown[]) => unknown) | string
```

### <a id="type-CreateNoteOpts"></a>`CreateNoteOpts`

Options accepted by [`FrontendApi.createNote`](#type-FrontendApi).

| Property | Description |
| --- | --- |
| `title`  <br>_optional_ | `string \| null`  <br>Title of the new note. |
| `content`  <br>_optional_ | `string \| null`  <br>Content of the new note (HTML for text notes, source for code notes, etc.). |
| `type`  <br>_optional_ | `string`  <br>Note type, e.g. "text" (default), "code", "book". |
| `mime`  <br>_optional_ | `string`  <br>MIME type, e.g. "application/javascript;env=frontend" for a frontend code note. |
| `templateNoteId`  <br>_optional_ | `string`  <br>Note ID of a template to apply to the new note. |
| `isProtected`  <br>_optional_ | `boolean`  <br>Create the note as protected (only takes effect when a protected session is available). |
| `activate`  <br>_optional_ | `boolean`  <br>Activate (open) the new note after creation. Defaults to `true`. |
| `focus`  <br>_optional_ | `"title" \| "content"`  <br>Which part of the activated note to focus. Defaults to "title". |
| `target`  <br>_optional_ | `string`  <br>Where to place the note relative to the parent/target: "into" (default) or "after". |
| `targetBranchId`  <br>_optional_ | `string`  <br>Branch ID used together with `target: "after"`. |
| `attributes`  <br>_optional_ | [`CreateAttribute`](#type-CreateAttribute)`[]`  <br>Attributes to set atomically on creation. |

### <a id="type-TextEditor"></a>`TextEditor`

The editor of a text note, a CKEditor 5 editor. The [CKEditor 5 API documentation](https://ckeditor.com/docs/ckeditor5/latest/api/module_core_editor_editor-Editor.html) describes it; `editor.model` and `editor.getData()` are the usual starting points.

### <a id="type-CodeEditor"></a>`CodeEditor`

The editor of a code note, a CodeMirror 6 `EditorView`. The [CodeMirror reference](https://codemirror.net/docs/ref/#view.EditorView) describes it; `editor.state.doc.toString()` reads the code.

### <a id="type-PickerItem"></a>`PickerItem`

One thing a picker offers, as `pickSingleItem` takes and answers with.

| Property | Description |
| --- | --- |
| `key` | `string`  <br>The ID of the item. It must be unique within its group, and tells the script which item the user picked. |
| `caption` | `string`  <br>The text shown for the item. The search field filters items by it. |
| `icon`  <br>_optional_ | `string`  <br>An icon class, `bx` prefix included. |
| `tooltip`  <br>_optional_ | `string`  <br>HTML shown in a tooltip while the item is hovered. |

### <a id="type-PickerItemGroup"></a>`PickerItemGroup`

A run of picker items under a heading of their own.

| Property | Description |
| --- | --- |
| `key` | `string`  <br>The ID of the group. It must be unique among the groups. |
| `groupHeader` | `string`  <br>The heading shown above the group's items. An empty string shows the items without a heading. |
| `items` | [`PickerItem`](#type-PickerItem)`[]`  <br>The items in the group, in the order the picker shows them. |

### <a id="type-LinkOptions"></a>`LinkOptions`

Options of `api.createLink()`.

| Property | Description |
| --- | --- |
| `title`  <br>_optional_ | `string`  <br>The text of the link. Defaults to the note's title. |
| `showTooltip`  <br>_optional_ | `boolean`  <br>Whether a preview of the note shows while the mouse pointer rests on the link. Defaults to `true`. |
| `showNotePath`  <br>_optional_ | `boolean`  <br>Whether the path of the note's parents shows below the link. Defaults to `false`. |
| `showNoteIcon`  <br>_optional_ | `boolean`  <br>Whether the note's icon shows before the link. Defaults to `false`. |
| `referenceLink`  <br>_optional_ | `boolean`  <br>Whether the link is styled as a reference link, as in text notes. Defaults to `false`. |
| `autoConvertToImage`  <br>_optional_ | `boolean`  <br>Whether an image, canvas or Mermaid note shows as its picture instead of a link. Defaults to `false`. |
| `titleSuffix`  <br>_optional_ | `string`  <br>Text shown right after the link's title. |

### <a id="type-Preact"></a>`Preact`

The Preact API that render notes import from `trilium:preact`: Preact's own functions and hooks, and Trilium's components and `defineWidget()`. In a JSX note, the script editor offers its full type.

### <a id="type-NotePathRecord"></a>`NotePathRecord`

One resolved tree path to a note (subset of the client's `NotePathRecord`).

| Property | Description |
| --- | --- |
| `isArchived` | `boolean`  <br>Whether a note on the path, the note itself included, is archived, which means it has the `#archived` label, owned or inherited. |
| `isInHoistedSubTree` | `boolean`  <br>Whether the path passes through the hoisted note passed to `getSortedNotePathRecords()`. It is always `true` when the hoisted note is `root`. |
| `isSearch`  <br>_optional_ | `boolean`  <br>Whether the note itself is a search note. Only frontend scripts get this property; backend records leave it out. |
| `notePath` | `string[]`  <br>The note IDs along the path, from `root` to the note itself. |
| `isHidden` | `boolean`  <br>Whether the path passes through the hidden subtree, `_hidden`, which holds Trilium's system notes. |

### <a id="type-Attribute"></a>`Attribute`

A label or relation attached to a note.

| Property | Description |
| --- | --- |
| `attributeId` | `string`  <br>The ID of the attribute. |
| `type` | `"label" \| "relation"`  <br>The type of the attribute: `label` or `relation`. |
| `name` | `string`  <br>The name of the attribute, without the `#` or `~` prefix. |
| `value` | `string`  <br>The value of the attribute. For a relation, it is the ID of the target note. For a label without a value, it is an empty string. |
| `isInheritable` | `boolean`  <br>Whether the note's descendants inherit the attribute. |
| `isOwned` | `boolean`  <br>Not set by Trilium: neither frontend nor backend attributes carry this property, so it reads `undefined`. |

### <a id="type-Blob"></a>`Blob`

A note's binary/text content blob (subset of the client's `FBlob`).

| Property | Description |
| --- | --- |
| `blobId` | `string`  <br>The ID of the blob, derived from its content. Notes, attachments and revisions with identical content share one blob. |
| `content` | `string`  <br>The content as text. It is `null` when the content is binary, as in images and files. |
| `contentLength` | `number`  <br>The length of the content as stored: characters for text, bytes for binary content. For a protected note, it measures the encrypted content. |
| `dateModified` | `string`  <br>The local date and time this content was first stored, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. A blob never changes, so new content gets a new blob. |
| `utcDateModified` | `string`  <br>The date and time, in UTC, that this content was first stored, such as `2026-10-22 12:03:05.123Z`. |

### <a id="type-NoteMetadata"></a>`NoteMetadata`

Creation/modification timestamps returned by [`FNote.getMetadata`](#type-FNote).

| Property | Description |
| --- | --- |
| `dateCreated` | `string`  <br>The local date and time the note was created, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. |
| `utcDateCreated` | `string`  <br>The date and time, in UTC, that the note was created, such as `2026-10-22 12:03:05.123Z`. |
| `dateModified` | `string`  <br>The local date and time the note was last modified, with the UTC offset, such as `2026-10-22 14:03:05.123+0200`. A change to the note's content counts as a modification. |
| `utcDateModified` | `string`  <br>The date and time, in UTC, that the note was last modified, such as `2026-10-22 12:03:05.123Z`. A change to the note's content counts as a modification. |

### <a id="type-Attachment"></a>`Attachment`

An attachment as seen by frontend scripts (subset of the client's `FAttachment`).

| Property | Description |
| --- | --- |
| `attachmentId` | `string`  <br>The ID of the attachment. |
| `ownerId` | `string`  <br>The ID of the note the attachment belongs to. For an attachment of a revision, it is the ID of the revision. |
| `role` | `string`  <br>The purpose of the attachment, such as `image` for an image shown in a text note or `file` for an attached file. Trilium also uses roles of its own, such as `viewConfig` for a collection's view settings. |
| `mime` | `string`  <br>The MIME type of the attachment's content, such as `image/png`. |
| `title` | `string`  <br>The title of the attachment, usually its file name. |
| `utcDateModified` | `string`  <br>The date and time, in UTC, that the attachment was last saved, such as `2026-10-22 12:03:05.123Z`. Replacing the content counts as saving. |
| `contentLength` | `number`  <br>The length of the attachment's content. Only some ways of loading an attachment fill it in, such as `getAttachments()`. |

### <a id="type-CreateAttribute"></a>`CreateAttribute`

An attribute to create together with a note (see [`CreateNoteOpts.attributes`](#type-CreateNoteOpts)).

| Property | Description |
| --- | --- |
| `type` | `"label" \| "relation"`  <br>The type of the attribute: `label` or `relation`. |
| `name` | `string`  <br>The name of the attribute, without the `#` or `~` prefix. |
| `value`  <br>_optional_ | `string`  <br>The value of the attribute. For a relation, it is the ID of the target note. Defaults to an empty string. |
| `isInheritable`  <br>_optional_ | `boolean`  <br>Whether the note's descendants inherit the attribute. Defaults to `false`. |
| `position`  <br>_optional_ | `number`  <br>The place of the attribute among the note's attributes, which are listed by ascending `position`. Defaults to 10 more than the highest position among the note's attributes. |