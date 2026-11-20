# Backend API
## <a id="type-BackendApi"></a>`BackendApi`

The `api` global available inside **backend** script notes (`application/javascript;env=backend`). Runs server-side: no DOM, no jQuery.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>startNote</code><br><em>optional</em></td>
            <td><p><a href="#type-BNote"><code>BNote</code></a> | <code>null</code><br>Note where the script execution started — the entry point of the current script bundle (in C terms, the file containing <code>main()</code>). When a script is spread across multiple code notes (descendant code notes loaded as modules via <code>require()</code>), every note in the bundle shares the same <code>startNote</code>, while <code>currentNote</code> differs per note. Messages from <code>api.log()</code> are grouped under this note. When a frontend script calls <code>api.runOnBackend()</code>, the frontend's <code>startNote</code> is preserved here; since that note may not be resolvable on the backend, this can be null.</p></td>
        </tr>
        <tr>
            <td><code>currentNote</code></td>
            <td><p><a href="#type-BNote"><code>BNote</code></a><br>Note containing the source code that is currently executing (in C terms, <code>__FILE__</code>). Equal to <code>startNote</code> unless execution has moved into a descendant module note loaded via <code>require()</code>. Don't confuse this with the concept of the active note in the UI.</p></td>
        </tr>
        <tr>
            <td><code>originEntity</code><br><em>optional</em></td>
            <td><p><a href="#type-Attribute"><code>Attribute</code></a> | <a href="#type-BBranch"><code>BBranch</code></a> | <a href="#type-BNote"><code>BNote</code></a> | <code>null</code><br>Entity whose event triggered this execution; <code>undefined</code> when the run was not event-driven (e.g. started manually via "Execute script" or <code>note.executeScript()</code>). What it holds depends on the trigger: - <code>~runOnNoteCreation</code>, <code>~runOnNoteChange</code>, <code>~runOnNoteTitleChange</code>, <code>~runOnNoteContentChange</code> — the affected note; - <code>~runOnChildNoteCreation</code> — the newly created child note; - <code>~runOnAttributeCreation</code>, <code>~runOnAttributeChange</code> — the attribute; - <code>~runOnBranchCreation</code>, <code>~runOnBranchChange</code>, <code>~runOnBranchDeletion</code> — the branch; - scheduled scripts (<code>#run=backendStartup</code> / <code>#run=hourly</code> / <code>#run=daily</code>) — the script note itself; - search scripts (<code>~searchScript</code>) — the search note.</p></td>
        </tr>
        <tr>
            <td><code>req</code></td>
            <td><p><a href="#type-Request"><code>Request</code></a><br>The HTTP request, present only when the script runs as a custom request handler: a note with the <code>#customRequestHandler</code> label, invoked through a <code>/custom/...</code> URL. It is <code>undefined</code> in every other backend script. The object is Express's own request, so it has more members than <a href="#type-Request"><code>Request</code></a> lists.</p></td>
        </tr>
        <tr>
            <td><code>res</code></td>
            <td><p><a href="#type-Response"><code>Response</code></a><br>The HTTP response to write the reply to, such as <code>api.res.status(200).json({ ok: true })</code>. Like <code>req</code>, it is present only in custom request handlers, and is Express's own response.</p></td>
        </tr>
        <tr>
            <td><code>pathParams</code></td>
            <td><p><code>string[]</code><br>The capture groups from the <code>#customRequestHandler</code> regex that matched this request's URL, in order. Available only inside custom request handlers.</p></td>
        </tr>
        <tr>
            <td><code>dayjs</code></td>
            <td><p><a href="#type-Dayjs"><code>Dayjs</code></a><br>day.js library for date manipulation. See <code>https://day.js.org</code> for documentation</p></td>
        </tr>
        <tr>
            <td><code>xml2js</code></td>
            <td><p><a href="#type-Xml2js"><code>Xml2js</code></a><br>The xml2js library, which converts between XML and JavaScript objects.</p></td>
        </tr>
        <tr>
            <td><code>htmlParser</code></td>
            <td><p><a href="#type-HtmlParser"><code>HtmlParser</code></a><br>The node-html-parser library, which parses HTML into elements that can be queried.</p></td>
        </tr>
        <tr>
            <td><code>getInstanceName</code></td>
            <td><pre><code class="language-application-typescript">getInstanceName(): string | null</code></pre><p>Instance name identifies particular Trilium instance. It can be useful for scripts if some action needs to happen on only one specific instance.</p></td>
        </tr>
        <tr>
            <td><code>getNote</code></td>
            <td><pre><code class="language-application-typescript">getNote(noteId: string): BNote | null</code></pre><p>Returns a note by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getBranch</code></td>
            <td><pre><code class="language-application-typescript">getBranch(branchId: string): BBranch | null</code></pre><p>Returns a branch by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getAttribute</code></td>
            <td><pre><code class="language-application-typescript">getAttribute(attributeId: string): Attribute | null</code></pre><p>Returns an attribute by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getAttachment</code></td>
            <td><pre><code class="language-application-typescript">getAttachment(attachmentId: string): BAttachment | null</code></pre><p>Returns an attachment by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getRevision</code></td>
            <td><pre><code class="language-application-typescript">getRevision(revisionId: string): BRevision | null</code></pre><p>Returns a revision by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getEtapiToken</code></td>
            <td><pre><code class="language-application-typescript">getEtapiToken(etapiTokenId: string): BEtapiToken | null</code></pre><p>Returns an ETAPI token by its ID, or null.</p></td>
        </tr>
        <tr>
            <td><code>getEtapiTokens</code></td>
            <td><pre><code class="language-application-typescript">getEtapiTokens(): BEtapiToken[]</code></pre><p>Returns all ETAPI tokens.</p></td>
        </tr>
        <tr>
            <td><code>getOption</code></td>
            <td><pre><code class="language-application-typescript">getOption(optionName: string): BOption | null</code></pre><p>Returns an option by name, or null.</p></td>
        </tr>
        <tr>
            <td><code>getOptions</code></td>
            <td><pre><code class="language-application-typescript">getOptions(): BOption[]</code></pre><p>Returns all options.</p></td>
        </tr>
        <tr>
            <td><code>searchForNotes</code></td>
            <td><pre><code class="language-application-typescript">searchForNotes(query: string, searchParams?: SearchParams): BNote[]</code></pre><p>This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". See <code>https://triliumnext.github.io/Docs/Wiki/search.html</code> for full documentation for all options</p></td>
        </tr>
        <tr>
            <td><code>searchForNote</code></td>
            <td><pre><code class="language-application-typescript">searchForNote(query: string, searchParams?: SearchParams): BNote | null</code></pre><p>This is a powerful search method - you can search by attributes and their values, e.g.: "#dateModified =* MONTH AND #log". See <code>https://triliumnext.github.io/Docs/Wiki/search.html</code> for full documentation for all options</p></td>
        </tr>
        <tr>
            <td><code>getNotesWithLabel</code></td>
            <td><pre><code class="language-application-typescript">getNotesWithLabel(name: string, value?: string): BNote[]</code></pre><p>Retrieves notes with given label name &amp; value</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code><br>attribute name</td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>attribute value</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getNoteWithLabel</code></td>
            <td><pre><code class="language-application-typescript">getNoteWithLabel(name: string, value?: string): BNote | null</code></pre><p>Retrieves first note with given label name &amp; value</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code><br>attribute name</td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>attribute value</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>ensureNoteIsPresentInParent</code></td>
            <td><pre><code class="language-application-typescript">ensureNoteIsPresentInParent(noteId: string, parentNoteId: string, prefix?: string): { branch: BBranch | null }</code></pre><p>If there's no branch between note and parent note, create one. Otherwise, do nothing. Returns the new or existing branch.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code></td></tr><tr><td><code>parentNoteId</code></td><td><code>string</code></td></tr><tr><td><code>prefix</code><br><em>optional</em></td><td><code>string</code><br>if branch is created between note and parent note, set this prefix</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>ensureNoteIsAbsentFromParent</code></td>
            <td><pre><code class="language-application-typescript">ensureNoteIsAbsentFromParent(noteId: string, parentNoteId: string): void</code></pre><p>If there's a branch between note and parent note, remove it. Otherwise, do nothing.</p></td>
        </tr>
        <tr>
            <td><code>toggleNoteInParent</code></td>
            <td><pre><code class="language-application-typescript">toggleNoteInParent(present: boolean, noteId: string, parentNoteId: string, prefix?: string): void</code></pre><p>Based on the value, either create or remove branch between note and parent note.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>present</code></td><td><code>boolean</code><br>true if we want the branch to exist, false if we want it gone</td></tr><tr><td><code>noteId</code></td><td><code>string</code></td></tr><tr><td><code>parentNoteId</code></td><td><code>string</code></td></tr><tr><td><code>prefix</code><br><em>optional</em></td><td><code>string</code><br>if branch is created between note and parent note, set this prefix</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>createTextNote</code></td>
            <td><pre><code class="language-application-typescript">createTextNote(parentNoteId: string, title: string, content: string): NoteAndBranch</code></pre><p>Create text note. See also createNewNote() for more options.</p></td>
        </tr>
        <tr>
            <td><code>createDataNote</code></td>
            <td><pre><code class="language-application-typescript">createDataNote(parentNoteId: string, title: string, content: object): NoteAndBranch</code></pre><p>Create data note - data in this context means object serializable to JSON. Created note will be of type 'code' and JSON MIME type. See also createNewNote() for more options.</p></td>
        </tr>
        <tr>
            <td><code>createNewNote</code></td>
            <td><pre><code class="language-application-typescript">createNewNote(params: { parentNoteId: string; title: string; content: string | Uint8Array&lt;ArrayBufferLike&gt;; type: string; mime?: string; [key: string]: unknown }): NoteAndBranch</code></pre><p><strong>Returns</strong> <a href="#type-NoteAndBranch"><code>NoteAndBranch</code></a>: object contains newly created entities note and branch</p></td>
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
            <td><pre><code class="language-application-typescript">log(...args: unknown[]): void</code></pre><p>Log given message to trilium logs and log pane in UI. Accepts multiple arguments which are joined with spaces, similar to <code>console.log</code>.</p></td>
        </tr>
        <tr>
            <td><code>getRootCalendarNote</code></td>
            <td><pre><code class="language-application-typescript">getRootCalendarNote(): BNote | null</code></pre><p>Returns root note of the calendar.</p></td>
        </tr>
        <tr>
            <td><code>getDayNote</code></td>
            <td><pre><code class="language-application-typescript">getDayNote(date: string, rootNote?: BNote): BNote | null</code></pre><p>Returns day note for given date. If such note doesn't exist, it is created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM-DD format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getTodayNote</code></td>
            <td><pre><code class="language-application-typescript">getTodayNote(rootNote?: BNote): BNote | null</code></pre><p>Returns today's day note. If such note doesn't exist, it is created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getWeekFirstDayNote</code></td>
            <td><pre><code class="language-application-typescript">getWeekFirstDayNote(date: string, rootNote?: BNote): BNote | null</code></pre><p>Returns note for the first date of the week of the given date.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM-DD format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getWeekNote</code></td>
            <td><pre><code class="language-application-typescript">getWeekNote(date: string, rootNote?: BNote): BNote | null</code></pre><p>Returns week note for given date. If such a note doesn't exist, it is created.</p><p>If the calendar does not support week notes, this method will return `null`.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM-DD format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure><p><strong>Returns</strong> <a href="#type-BNote"><code>BNote</code></a> | <code>null</code>: an existing or newly created week note, or <code>null</code> if the calendar does not support week notes.</p></td>
        </tr>
        <tr>
            <td><code>getMonthNote</code></td>
            <td><pre><code class="language-application-typescript">getMonthNote(date: string, rootNote?: BNote): BNote | null</code></pre><p>Returns month note for given date. If such a note doesn't exist, it is created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getQuarterNote</code></td>
            <td><pre><code class="language-application-typescript">getQuarterNote(date: string, rootNote?: BNote): BNote | null</code></pre><p>Returns quarter note for given date. If such a note doesn't exist, it is created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>date</code></td><td><code>string</code><br>in YYYY-MM format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getYearNote</code></td>
            <td><pre><code class="language-application-typescript">getYearNote(year: string, rootNote?: BNote): BNote | null</code></pre><p>Returns year note for given year. If such a note doesn't exist, it is created.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>year</code></td><td><code>string</code><br>in YYYY format</td></tr><tr><td><code>rootNote</code><br><em>optional</em></td><td><a href="#type-BNote"><code>BNote</code></a><br>specify calendar root note, normally leave empty to use the default calendar</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>sortNotes</code></td>
            <td><pre><code class="language-application-typescript">sortNotes(parentNoteId: string, sortConfig: { sortBy?: string; reverse?: boolean; foldersFirst?: boolean }): void</code></pre><p>Sort child notes of a given note. <code>sortBy</code> takes the <code>#sorted</code> grammar — comma-separated levels of <code>title</code>, <code>dateCreated</code>, <code>dateModified</code> or a label name, each optionally followed by <code>asc</code> or <code>desc</code> (<code>priority desc, dueDate</code>); <code>reverse</code> is the direction of the levels without their own, of the folders grouping and of ties.</p></td>
        </tr>
        <tr>
            <td><code>setNoteToParent</code></td>
            <td><pre><code class="language-application-typescript">setNoteToParent(noteId: string, prefix: string, parentNoteId: string | null): void</code></pre><p>This method finds note by its noteId and prefix and either sets it to the given parentNoteId or removes the branch (if parentNoteId is not given).</p><p>This method looks similar to toggleNoteInParent() but differs because we're looking up branch by prefix.</p><aside class="admonition warning"><p>Deprecated. this method is pretty confusing and serves specialized purpose only</p></aside></td>
        </tr>
        <tr>
            <td><code>transactional</code></td>
            <td><pre><code class="language-application-typescript">transactional&lt;T&gt;(func: () =&gt; T): T</code></pre><p>This functions wraps code which is supposed to be running in transaction. If transaction already exists, then we'll use that transaction.</p><p><strong>Returns</strong> <code>T</code>: result of func callback</p></td>
        </tr>
        <tr>
            <td><code>randomString</code></td>
            <td><pre><code class="language-application-typescript">randomString(length: number): string</code></pre><p>Return randomly generated string of given length. This random string generation is NOT cryptographically secure.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>length</code></td><td><code>number</code><br>of the string</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: random string</p></td>
        </tr>
        <tr>
            <td><code>escapeHtml</code></td>
            <td><pre><code class="language-application-typescript">escapeHtml(str: string): string</code></pre><p><strong>Returns</strong> <code>string</code>: escaped string</p></td>
        </tr>
        <tr>
            <td><code>unescapeHtml</code></td>
            <td><pre><code class="language-application-typescript">unescapeHtml(str: string): string</code></pre><p><strong>Returns</strong> <code>string</code>: unescaped string</p></td>
        </tr>
        <tr>
            <td><code>htmlToMarkdown</code></td>
            <td><pre><code class="language-application-typescript">htmlToMarkdown(html: string): string</code></pre><p>Converts the given HTML string to Markdown.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>html</code></td><td><code>string</code><br>HTML content to convert</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: Markdown representation of the input HTML</p></td>
        </tr>
        <tr>
            <td><code>markdownToHtml</code></td>
            <td><pre><code class="language-application-typescript">markdownToHtml(markdown: string): string</code></pre><p>Converts the given Markdown string to HTML.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>markdown</code></td><td><code>string</code><br>Markdown content to convert</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>string</code>: HTML representation of the input Markdown</p></td>
        </tr>
        <tr>
            <td><code>sql</code></td>
            <td><p><a href="#type-Sql"><code>Sql</code></a><br>Direct access to Trilium's SQLite database.</p></td>
        </tr>
        <tr>
            <td><code>getAppInfo</code></td>
            <td><pre><code class="language-application-typescript">getAppInfo(): AppInfo</code></pre><p>Application info (version, build date, etc.).</p></td>
        </tr>
        <tr>
            <td><code>createOrUpdateLauncher</code></td>
            <td><pre><code class="language-application-typescript">createOrUpdateLauncher(opts: { id: string; type: "note" | "script" | "customWidget"; title: string; isVisible: boolean; icon: string; keyboardShortcut: string; targetNoteId?: string; scriptNoteId?: string; widgetNoteId?: string }): { note: BNote }</code></pre><p>Creates a new launcher to the launchbar. If the launcher (id) already exists, it will be updated.</p></td>
        </tr>
        <tr>
            <td><code>exportSubtreeToZipFile</code></td>
            <td><pre><code class="language-application-typescript">exportSubtreeToZipFile(noteId: string, format: "markdown" | "html", zipFilePath: string): Promise&lt;void&gt;</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>noteId</code></td><td><code>string</code></td></tr><tr><td><code>format</code></td><td><code>"markdown" | "html"</code><br>either 'html' or 'markdown'</td></tr><tr><td><code>zipFilePath</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>runOnFrontend</code></td>
            <td><pre><code class="language-application-typescript">runOnFrontend(script: string | (() =&gt; void), params?: unknown[]): void</code></pre><p>Executes given anonymous function on the frontend(s). Internally, this serializes the anonymous function into string and sends it to frontend(s) via WebSocket. Note that there can be multiple connected frontend instances (e.g. in different tabs). In such case, all instances execute the given function.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>script</code></td><td><code>string | (() =&gt; void)</code><br>script to be executed on the frontend</td></tr><tr><td><code>params</code><br><em>optional</em></td><td><code>unknown[]</code><br>list of parameters to the anonymous function to be sent to frontend</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>void</code>: no return value is provided.</p></td>
        </tr>
        <tr>
            <td><code>runOutsideOfSync</code></td>
            <td><pre><code class="language-application-typescript">runOutsideOfSync(callback: () =&gt; void): Promise&lt;void&gt;</code></pre><p>Sync process can make data intermittently inconsistent. Scripts which require strong data consistency can use this function to wait for a possible sync process to finish and prevent new sync process from starting while it is running.</p><p>Because this is an async process, the inner callback doesn't have automatic transaction handling, so in case you need to make some DB changes, you need to surround your call with api.transactional(...)</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>callback</code></td><td><code>() =&gt; void</code><br>function to be executed while sync process is not running</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;void&gt;</code>: resolves once the callback is finished (callback is awaited)</p></td>
        </tr>
        <tr>
            <td><code>backupNow</code></td>
            <td><pre><code class="language-application-typescript">backupNow(backupName: string): Promise&lt;string&gt;</code></pre><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>backupName</code></td><td><code>string</code><br>If the backupName is e.g. "now", then the backup will be written to "backup-now.db" file</td></tr></tbody></table></figure><p><strong>Returns</strong> <code>Promise&lt;string&gt;</code>: resolves once the backup is finished</p></td>
        </tr>
        <tr>
            <td><code>duplicateSubtree</code></td>
            <td><pre><code class="language-application-typescript">duplicateSubtree(origNoteId: string, newParentNoteId: string): NoteAndBranch</code></pre><p>Enables the complete duplication of the specified original note and all its children into the specified parent note. The new note will be named the same as the original, with (Dup) added to the end of it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>origNoteId</code></td><td><code>string</code><br>the noteId for the original note to be duplicated</td></tr><tr><td><code>newParentNoteId</code></td><td><code>string</code><br>the noteId for the parent note where the duplication is to be placed.</td></tr></tbody></table></figure><p><strong>Returns</strong> <a href="#type-NoteAndBranch"><code>NoteAndBranch</code></a>: the note and the branch of the newly created note.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-BNote"></a>`BNote`

A note as seen by backend scripts (subset of trilium-core's `BNote`).

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
            <td><p><code>string</code><br>The ID of the note. The root note's ID is <code>root</code>. System notes have IDs that start with <code>_</code>, such as <code>_hidden</code>.</p></td>
        </tr>
        <tr>
            <td><code>title</code></td>
            <td><p><code>string</code><br>The title of the note. For a protected note read outside a protected session, this holds the encrypted title. Use <code>getTitleOrProtected()</code> to show a title safely.</p></td>
        </tr>
        <tr>
            <td><code>type</code></td>
            <td><p><code>string</code><br>The note type, such as <code>text</code>, <code>code</code>, <code>file</code>, <code>image</code>, <code>search</code> or <code>book</code>. Together with <code>mime</code>, it decides how Trilium renders the content.</p></td>
        </tr>
        <tr>
            <td><code>mime</code></td>
            <td><p><code>string</code><br>The MIME type of the note's content, such as <code>text/html</code> for a text note or <code>application/javascript;env=backend</code> for a backend script.</p></td>
        </tr>
        <tr>
            <td><code>isProtected</code></td>
            <td><p><code>boolean</code><br>Whether the note is protected. The title and content of a protected note are encrypted, and can be read or changed only while a protected session is active.</p></td>
        </tr>
        <tr>
            <td><code>isArchived</code></td>
            <td><p><code>boolean</code><br>Whether the note is archived: it has an <code>archived</code> label of its own or inherits one. A non-inheritable <code>archived</code> label on an ancestor does not count; see <code>areAllNotePathsArchived()</code>.</p></td>
        </tr>
        <tr>
            <td><code>isDeleted</code></td>
            <td><p><code>boolean</code><br>Whether the note has been deleted, or its deletion is in progress. It becomes <code>true</code> on an object a script still holds after the note is deleted.</p></td>
        </tr>
        <tr>
            <td><code>shareId</code></td>
            <td><p><code>string</code><br>Share root ID this note is published under, if any.</p></td>
        </tr>
        <tr>
            <td><code>blobId</code></td>
            <td><p><code>string</code><br>The ID of the blob that stores the note's content. It changes whenever the content changes, and notes with identical content share a blob.</p></td>
        </tr>
        <tr>
            <td><code>dateCreated</code></td>
            <td><p><code>string</code><br>The date and time the note was created, in local time with its UTC offset, for example <code>2026-10-22 14:03:05.123+0200</code>.</p></td>
        </tr>
        <tr>
            <td><code>dateModified</code></td>
            <td><p><code>string</code><br>The date and time the note was last modified, in local time with its UTC offset, for example <code>2026-10-22 14:03:05.123+0200</code>. It changes when the content changes or the note itself is saved, such as after a title change.</p></td>
        </tr>
        <tr>
            <td><code>utcDateCreated</code></td>
            <td><p><code>string</code><br>The date and time the note was created, in UTC, for example <code>2026-10-22 12:03:05.123Z</code>.</p></td>
        </tr>
        <tr>
            <td><code>utcDateModified</code></td>
            <td><p><code>string</code><br>The date and time the note was last modified, in UTC, for example <code>2026-10-22 12:03:05.123Z</code>. It changes when the content changes or the note itself is saved.</p></td>
        </tr>
        <tr>
            <td><code>getContent</code></td>
            <td><pre><code class="language-application-typescript">getContent(): string | Uint8Array&lt;ArrayBufferLike&gt;</code></pre><p>Returns the content of the note: a string for text-based notes (see <code>hasStringContent()</code>), a <code>Uint8Array</code> for binary ones such as images and files. The content is read from the database on each call. For a protected note outside a protected session, it returns an empty string.</p></td>
        </tr>
        <tr>
            <td><code>setContent</code></td>
            <td><pre><code class="language-application-typescript">setContent(content: string | Uint8Array&lt;ArrayBufferLike&gt;, opts?: { forceFrontendReload?: boolean }): void</code></pre><p>Replaces the content of the note and saves it immediately; there is no need to call <code>save()</code> afterwards. If the content is unchanged, nothing is saved and <code>dateModified</code> stays the same.</p><p>The call throws an error when <code>content</code> is <code>null</code> or <code>undefined</code>, when the note is protected and no protected session is active, and when the note is read-only, such as a page of the in-app help.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>content</code></td><td><code>string | Uint8Array&lt;ArrayBufferLike&gt;</code><br>The new content: a string for text-based notes, or a <code>Uint8Array</code> for binary ones such as images and files.</td></tr><tr><td><code>opts</code><br><em>optional</em></td><td><code>{ forceFrontendReload?: boolean }</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getJsonContent</code></td>
            <td><pre><code class="language-application-typescript">getJsonContent&lt;T = unknown&gt;(): T | null</code></pre><p>Returns the note's content parsed as JSON. Returns <code>null</code> when the content is empty, blank or binary, and throws an error when it is not valid JSON.</p></td>
        </tr>
        <tr>
            <td><code>getJsonContentSafely</code></td>
            <td><pre><code class="language-application-typescript">getJsonContentSafely(): unknown</code></pre><p>Returns the note's content parsed as JSON, like <code>getJsonContent()</code>, but returns <code>null</code> instead of throwing an error when the content is not valid JSON.</p></td>
        </tr>
        <tr>
            <td><code>setJsonContent</code></td>
            <td><pre><code class="language-application-typescript">setJsonContent(content: unknown): void</code></pre><p>Serializes <code>content</code> to JSON, indented with tabs, and saves it as the note's content through <code>setContent()</code>, with the same errors.</p></td>
        </tr>
        <tr>
            <td><code>hasStringContent</code></td>
            <td><pre><code class="language-application-typescript">hasStringContent(): boolean</code></pre><p>Returns whether <code>getContent()</code> returns a string rather than a <code>Uint8Array</code>. This holds for text, code, canvas, Mermaid and other text-based note types, and for MIME types such as <code>text/*</code>, <code>application/json</code>, <code>application/javascript</code> and <code>image/svg+xml</code>.</p></td>
        </tr>
        <tr>
            <td><code>getFileName</code></td>
            <td><pre><code class="language-application-typescript">getFileName(): string</code></pre><p>Returns a file name for the note, as used when it is downloaded or exported: the title with characters invalid in file names removed (<code>untitled</code> when the title is empty), plus an extension. The extension is <code>.html</code> for text notes, <code>.json</code> for relation maps, canvases and saved searches, and otherwise comes from the MIME type, unless the title already ends in a matching one.</p></td>
        </tr>
        <tr>
            <td><code>getFlatText</code></td>
            <td><pre><code class="language-application-typescript">getFlatText(): string</code></pre><p>Returns a single line of text that Trilium searches when matching notes: the note ID, type, MIME type, branch prefixes, title and attributes (as <code>#name=value</code> and <code>~name=value</code>, inherited ones included), lowercased and with diacritics removed. The content is not included.</p></td>
        </tr>
        <tr>
            <td><code>getPojo</code></td>
            <td><pre><code class="language-application-typescript">getPojo(): Record&lt;string, unknown&gt;</code></pre><p>Plain serialisable representation of the note (the real return type is <code>NotePojo</code>).</p></td>
        </tr>
        <tr>
            <td><code>getTitleOrProtected</code></td>
            <td><pre><code class="language-application-typescript">getTitleOrProtected(): string</code></pre><p>Returns the note's title, or the literal string <code>[protected]</code> when the note is protected and no protected session is active.</p></td>
        </tr>
        <tr>
            <td><code>getIcon</code></td>
            <td><pre><code class="language-application-typescript">getIcon(): string</code></pre><p>Returns the CSS classes of the note's icon, for example <code>tn-icon bx bx-note</code>. The icon comes from the note's <code>iconClass</code> label (its own or inherited) when it has one, and otherwise from its type.</p></td>
        </tr>
        <tr>
            <td><code>parents</code></td>
            <td><p><a href="#type-BNote"><code>BNote</code></a><code>[]</code><br>The parent notes of this note: one per place the note appears in the tree, so a cloned note has several. Parents that are not archived come first. This is the same array <code>getParentNotes()</code> returns; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>children</code></td>
            <td><p><a href="#type-BNote"><code>BNote</code></a><code>[]</code><br>The child notes of this note, in their order in the tree. This is the same array <code>getChildNotes()</code> returns; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>parentBranches</code></td>
            <td><p><a href="#type-BBranch"><code>BBranch</code></a><code>[]</code><br>The branches that place this note under each of its parents, in the same order as <code>parents</code>. This is the same array <code>getParentBranches()</code> returns; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>parentCount</code></td>
            <td><p><code>number</code><br>The number of parent notes, which is greater than 1 for a cloned note.</p></td>
        </tr>
        <tr>
            <td><code>childrenCount</code></td>
            <td><p><code>number</code><br>The number of child notes, including hidden and system notes.</p></td>
        </tr>
        <tr>
            <td><code>getParentNotes</code></td>
            <td><pre><code class="language-application-typescript">getParentNotes(): BNote[]</code></pre><p>Returns the parent notes of this note, one per place the note appears in the tree. Parents that are not archived come first. The result is the <code>parents</code> array itself; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>getChildNotes</code></td>
            <td><pre><code class="language-application-typescript">getChildNotes(): BNote[]</code></pre><p>Returns the child notes of this note, in their order in the tree. The result is the <code>children</code> array itself; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>getVisibleChildNotes</code></td>
            <td><pre><code class="language-application-typescript">getVisibleChildNotes(): BNote[]</code></pre><p>Returns the child notes that are shown in a shared note's navigation tree, in tree order. It leaves out system notes, whose IDs start with <code>_</code>, and notes with a <code>shareHiddenFromTree</code> label, their own or inherited. Archived notes are included.</p></td>
        </tr>
        <tr>
            <td><code>getParentBranches</code></td>
            <td><pre><code class="language-application-typescript">getParentBranches(): BBranch[]</code></pre><p>Returns the branches that place this note under each of its parents. The result is the <code>parentBranches</code> array itself; don't modify it.</p></td>
        </tr>
        <tr>
            <td><code>getChildBranches</code></td>
            <td><pre><code class="language-application-typescript">getChildBranches(): BBranch[]</code></pre><p>Returns the branches that connect this note to each of its children, in their order in the tree. A branch holds the child's position and prefix.</p></td>
        </tr>
        <tr>
            <td><code>getVisibleChildBranches</code></td>
            <td><pre><code class="language-application-typescript">getVisibleChildBranches(): BBranch[]</code></pre><p>Returns the child branches whose notes are shown in a shared note's navigation tree, in tree order. It leaves out system notes, whose IDs start with <code>_</code>, and notes with a <code>shareHiddenFromTree</code> label, their own or inherited. Archived notes are included.</p></td>
        </tr>
        <tr>
            <td><code>getStrongParentBranches</code></td>
            <td><pre><code class="language-application-typescript">getStrongParentBranches(): BBranch[]</code></pre><p>Returns the parent branches the user created, leaving out the automatic placements under the shared notes (<code>_share</code>) and the bookmarks (<code>_lbBookmarks</code>). A note whose last such branch is deleted is deleted too.</p></td>
        </tr>
        <tr>
            <td><code>getFilteredChildBranches</code></td>
            <td><pre><code class="language-application-typescript">getFilteredChildBranches(): BBranch[]</code></pre><p>Returns the same branches as <code>getChildBranches()</code>. Despite its name, it filters nothing: archived and hidden children are included.</p></td>
        </tr>
        <tr>
            <td><code>getBranches</code></td>
            <td><pre><code class="language-application-typescript">getBranches(): BBranch[]</code></pre><p>Returns the branches that place this note under each of its parents.</p><aside class="admonition warning"><p>Deprecated. Use <code>getParentBranches()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>hasChildren</code></td>
            <td><pre><code class="language-application-typescript">hasChildren(): boolean</code></pre><p>Returns whether the note has at least one child note, including hidden and system notes.</p></td>
        </tr>
        <tr>
            <td><code>hasVisibleChildren</code></td>
            <td><pre><code class="language-application-typescript">hasVisibleChildren(): boolean</code></pre><p>Returns whether <code>getVisibleChildNotes()</code> returns at least one note.</p></td>
        </tr>
        <tr>
            <td><code>getAncestors</code></td>
            <td><pre><code class="language-application-typescript">getAncestors(): BNote[]</code></pre><p>Returns every ancestor of the note across all of its paths in the tree, each note once, up to and including the root note. The note itself is not included. The order follows the parents: each parent comes first, followed by its own ancestors.</p></td>
        </tr>
        <tr>
            <td><code>getAncestorNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getAncestorNoteIds(): string[]</code></pre><p>Returns the IDs of the notes <code>getAncestors()</code> returns, in the same order.</p></td>
        </tr>
        <tr>
            <td><code>getDescendantNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getDescendantNoteIds(): string[]</code></pre><p>Returns the IDs of this note and all its descendants.</p><aside class="admonition warning"><p>Deprecated. Use <code>getSubtreeNoteIds()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>getDistanceToAncestor</code></td>
            <td><pre><code class="language-application-typescript">getDistanceToAncestor(ancestorNoteId: string): number</code></pre><p>Returns the number of levels between this note and the given ancestor along the shortest path: <code>1</code> for a parent, <code>2</code> for a grandparent, and <code>0</code> for the note itself. If the note is not a descendant of the given note, it returns <code>999999</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>ancestorNoteId</code></td><td><code>string</code><br>The ID of the ancestor note to measure the distance to.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasAncestor</code></td>
            <td><pre><code class="language-application-typescript">hasAncestor(ancestorNoteId: string): boolean</code></pre><p>Returns whether the given note is an ancestor of this note on any of its paths. It returns <code>false</code> for the note's own ID.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>ancestorNoteId</code></td><td><code>string</code><br>The ID of the note to look for among the ancestors.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>isDescendantOfNote</code></td>
            <td><pre><code class="language-application-typescript">isDescendantOfNote(ancestorNoteId: string): boolean</code></pre><p>Returns whether the given note lies on at least one of this note's paths from the root. Unlike <code>hasAncestor()</code>, it returns <code>true</code> for the note's own ID.</p></td>
        </tr>
        <tr>
            <td><code>isRoot</code></td>
            <td><pre><code class="language-application-typescript">isRoot(): boolean</code></pre><p>Returns whether this note is the root of the note tree, whose ID is <code>root</code>.</p></td>
        </tr>
        <tr>
            <td><code>getSubtree</code></td>
            <td><pre><code class="language-application-typescript">getSubtree(opts?: SubtreeOpts): { notes: BNote[]; relationships: SubtreeRelationship[] }</code></pre><p>Returns the note and all its descendants, each note once, together with every parent-child relationship among them, including those of cloned notes.</p><p><strong>Returns</strong> <code>{ notes:</code> <a href="#type-BNote"><code>BNote</code></a><code>[]; relationships:</code> <a href="#type-SubtreeRelationship"><code>SubtreeRelationship</code></a><code>[] }</code>: An object with <code>notes</code>, the notes of the subtree including this note, and <code>relationships</code>, the <code>{ parentNoteId, childNoteId }</code> pairs connecting them.</p></td>
        </tr>
        <tr>
            <td><code>getSubtreeNoteIds</code></td>
            <td><pre><code class="language-application-typescript">getSubtreeNoteIds(opts?: SubtreeOpts): string[]</code></pre><p>Returns the IDs of this note and all its descendants, each once. Takes the same options as <code>getSubtree()</code>.</p></td>
        </tr>
        <tr>
            <td><code>getSubtreeNotesIncludingTemplated</code></td>
            <td><pre><code class="language-application-typescript">getSubtreeNotesIncludingTemplated(): BNote[]</code></pre><p>Returns the notes that this note's inheritable attributes reach: the note itself, its descendants, and every note that uses one of them as a <code>template</code> or <code>inherit</code> relation target, along with that note's descendants. Each note appears once; the hidden subtree (<code>_hidden</code>) is skipped.</p></td>
        </tr>
        <tr>
            <td><code>getInheritingNotes</code></td>
            <td><pre><code class="language-application-typescript">getInheritingNotes(): BNote[]</code></pre><p>Returns the notes that this note's non-inheritable attributes apply to: the note itself and every note that uses it as a <code>template</code> or <code>inherit</code> relation target. Their descendants are not included.</p></td>
        </tr>
        <tr>
            <td><code>getAllNotePaths</code></td>
            <td><pre><code class="language-application-typescript">getAllNotePaths(): string[][]</code></pre><p>Returns every path from the root note to this note, one per placement in the tree. Each path is an array of note IDs that starts with <code>root</code> and ends with this note's ID.</p></td>
        </tr>
        <tr>
            <td><code>getBestNotePath</code></td>
            <td><pre><code class="language-application-typescript">getBestNotePath(hoistedNoteId?: string): string[]</code></pre><p>Returns the best path from the root note to this note as an array of note IDs, ranked as in <code>getSortedNotePathRecords()</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>The ID of the note whose subtree is preferred. Defaults to <code>root</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getBestNotePathString</code></td>
            <td><pre><code class="language-application-typescript">getBestNotePathString(hoistedNoteId?: string): string</code></pre><p>Returns the best path from the root note to this note as a string of note IDs joined by <code>/</code>, for example <code>root/a1h315/js725h</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>The ID of the note whose subtree is preferred. Defaults to <code>root</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getSortedNotePathRecords</code></td>
            <td><pre><code class="language-application-typescript">getSortedNotePathRecords(hoistedNoteId?: string): NotePathRecord[]</code></pre><p>Returns a record for every path from the root note to this note, best path first. Paths within the hoisted note's subtree come first, then paths without archived notes, then paths outside the hidden subtree, then shorter paths.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>hoistedNoteId</code><br><em>optional</em></td><td><code>string</code><br>The ID of the note whose subtree is preferred. Defaults to <code>root</code>.</td></tr></tbody></table></figure><p><strong>Returns</strong> <a href="#type-NotePathRecord"><code>NotePathRecord</code></a><code>[]</code>: Records whose <code>notePath</code> holds the note IDs from the root to this note, with flags telling whether the path lies within the hoisted subtree (<code>isInHoistedSubTree</code>), passes through an archived note, the note itself included (<code>isArchived</code>), or lies within the hidden subtree (<code>isHidden</code>).</p></td>
        </tr>
        <tr>
            <td><code>areAllNotePathsArchived</code></td>
            <td><pre><code class="language-application-typescript">areAllNotePathsArchived(): boolean</code></pre><p>Returns whether every path to this note passes through an archived note. Unlike <code>isArchived</code>, this also counts a non-inheritable <code>archived</code> label on an ancestor. It throws an error if the note has no path from the root.</p></td>
        </tr>
        <tr>
            <td><code>ownedAttributes</code></td>
            <td><p><a href="#type-Attribute"><code>Attribute</code></a><code>[]</code><br>The labels and relations defined directly on this note, without inherited ones.</p></td>
        </tr>
        <tr>
            <td><code>targetRelations</code></td>
            <td><p><a href="#type-Attribute"><code>Attribute</code></a><code>[]</code><br>The relations in other notes (or this one) that point to this note. This includes the link relations Trilium creates automatically for links in note content, such as <code>internalLink</code> and <code>imageLink</code>.</p></td>
        </tr>
        <tr>
            <td><code>attributeCount</code></td>
            <td><p><code>number</code><br>The number of labels and relations on this note, inherited ones and automatic link relations included.</p></td>
        </tr>
        <tr>
            <td><code>ownedAttributeCount</code></td>
            <td><p><code>number</code><br>The number of labels and relations defined directly on this note, automatic link relations included.</p></td>
        </tr>
        <tr>
            <td><code>labelCount</code></td>
            <td><p><code>number</code><br>The number of labels on this note, inherited ones included.</p></td>
        </tr>
        <tr>
            <td><code>ownedLabelCount</code></td>
            <td><p><code>number</code><br>The number of labels defined directly on this note.</p></td>
        </tr>
        <tr>
            <td><code>relationCount</code></td>
            <td><p><code>number</code><br>The number of relations on this note, inherited ones included. Excludes the link relations Trilium creates automatically for links in note content (<code>internalLink</code>, <code>imageLink</code>, <code>relationMapLink</code>, <code>includeNoteLink</code>).</p></td>
        </tr>
        <tr>
            <td><code>relationCountIncludingLinks</code></td>
            <td><p><code>number</code><br>The number of relations on this note, inherited ones included, together with the link relations Trilium creates automatically for links in note content.</p></td>
        </tr>
        <tr>
            <td><code>ownedRelationCount</code></td>
            <td><p><code>number</code><br>The number of relations defined directly on this note, excluding the link relations Trilium creates automatically for links in note content.</p></td>
        </tr>
        <tr>
            <td><code>ownedRelationCountIncludingLinks</code></td>
            <td><p><code>number</code><br>The number of relations defined directly on this note, together with the link relations Trilium creates automatically for links in note content.</p></td>
        </tr>
        <tr>
            <td><code>targetRelationCount</code></td>
            <td><p><code>number</code><br>The number of relations in other notes that point to this note, excluding the link relations Trilium creates automatically for links in note content.</p></td>
        </tr>
        <tr>
            <td><code>targetRelationCountIncludingLinks</code></td>
            <td><p><code>number</code><br>The number of relations in other notes that point to this note, together with the link relations Trilium creates automatically for links in note content.</p></td>
        </tr>
        <tr>
            <td><code>getAttributes</code></td>
            <td><pre><code class="language-application-typescript">getAttributes(type?: string, name?: string): Attribute[]</code></pre><p>Returns the labels and relations of this note, inherited ones included, optionally filtered by type and name. Without a filter, the result is the note's own cached array; don't modify it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code><br><em>optional</em></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>; any other value throws an error.</td></tr><tr><td><code>name</code><br><em>optional</em></td><td><code>string</code><br>The attribute name, without the leading <code>#</code> or <code>~</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttributes</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttributes(type?: string, name?: string): Attribute[]</code></pre><p>Returns the labels and relations defined directly on this note, optionally filtered by type and name. Without a filter, the result is the <code>ownedAttributes</code> array itself; don't modify it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code><br><em>optional</em></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>; any other value throws an error.</td></tr><tr><td><code>name</code><br><em>optional</em></td><td><code>string</code><br>The attribute name, without the leading <code>#</code> or <code>~</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttribute</code></td>
            <td><pre><code class="language-application-typescript">getAttribute(type: string, name: string): Attribute | null</code></pre><p>Returns the first attribute of the given type and name, inherited ones included, or <code>null</code> if there is none.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttribute</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttribute(type: string, name: string, value?: string | null): Attribute | null</code></pre><p>Returns the first attribute of the given type and name defined directly on this note, or <code>null</code> if there is none. It skips inheritance, so it can be much faster than <code>getAttribute()</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string | null</code><br>The value to match; when omitted, any value matches.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttributeValue</code></td>
            <td><pre><code class="language-application-typescript">getAttributeValue(type: string, name: string): string | null</code></pre><p>Returns the value of the first attribute of the given type and name, inherited ones included, or <code>null</code> if there is none. For a relation, the value is the target note's ID.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getOwnedAttributeValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedAttributeValue(type: string, name: string): string | null</code></pre><p>Returns the value of the first attribute of the given type and name defined directly on this note, or <code>null</code> if there is none. For a relation, the value is the target note's ID.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttributeById</code></td>
            <td><pre><code class="language-application-typescript">getAttributeById(attributeId: string): Attribute | undefined</code></pre><p>Returns the attribute of this note with the given ID, inherited ones included, or <code>undefined</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>getAttributeCaseInsensitive</code></td>
            <td><pre><code class="language-application-typescript">getAttributeCaseInsensitive(type: string, name: string, value?: string | null): Attribute | undefined</code></pre><p>Returns the first attribute of the given type whose name, and optionally value, matches regardless of letter case, or <code>undefined</code> if none does. Inherited attributes are included.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string | null</code><br>The value to match; an empty or omitted value matches any value.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasAttribute</code></td>
            <td><pre><code class="language-application-typescript">hasAttribute(type: string, name: string): boolean</code></pre><p>Returns <code>true</code> if the note has a label or relation of the given type and name, inherited ones included.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasOwnedAttribute</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedAttribute(type: string, name: string, value?: string): boolean</code></pre><p>Returns whether the note has a label or relation of the given type and name defined directly on it. Inherited attributes don't count.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The value to match; when omitted, any value matches.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getLabelDefinitions</code></td>
            <td><pre><code class="language-application-typescript">getLabelDefinitions(): Attribute[]</code></pre><p>Returns the attribute definitions on this note, inherited ones included. Currently returns the same <code>#relation:*</code> definitions as <code>getRelationDefinitions()</code>, not the <code>#label:*</code> ones; to read label definitions, filter <code>getLabels()</code> by names that start with <code>label:</code>.</p></td>
        </tr>
        <tr>
            <td><code>getRelationDefinitions</code></td>
            <td><pre><code class="language-application-typescript">getRelationDefinitions(): Attribute[]</code></pre><p>Returns the relation definitions on this note, inherited ones included: the <code>#relation:*</code> labels that declare promoted relations, such as <code>#relation:author="promoted,single"</code>.</p></td>
        </tr>
        <tr>
            <td><code>getTargetRelations</code></td>
            <td><pre><code class="language-application-typescript">getTargetRelations(): Attribute[]</code></pre><p>Returns the relations in other notes (or this one) that point to this note, the automatic link relations included. Same as <code>targetRelations</code>.</p></td>
        </tr>
        <tr>
            <td><code>getLabel</code></td>
            <td><pre><code class="language-application-typescript">getLabel(name: string): Attribute | null</code></pre><p>Returns the first label with the given name, inherited ones included, or <code>null</code> if there is none. Pass the name without the leading <code>#</code>.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabel</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabel(name: string): Attribute | null</code></pre><p>Returns the first label with the given name defined directly on this note, or <code>null</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>getLabels</code></td>
            <td><pre><code class="language-application-typescript">getLabels(name?: string): Attribute[]</code></pre><p>Returns the labels of this note, inherited ones included. When <code>name</code> is given, only labels with that name are returned.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabels</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabels(name: string): Attribute[]</code></pre><p>Returns the labels with the given name defined directly on this note.</p></td>
        </tr>
        <tr>
            <td><code>getLabelValue</code></td>
            <td><pre><code class="language-application-typescript">getLabelValue(name: string): string | null</code></pre><p>Returns the value of the first label with the given name, inherited ones included, or <code>null</code> if there is none. A label without a value returns an empty string.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabelValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabelValue(name: string): string | null</code></pre><p>Returns the value of the first label with the given name defined directly on this note, or <code>null</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>getLabelValues</code></td>
            <td><pre><code class="language-application-typescript">getLabelValues(name: string): string[]</code></pre><p>Returns the values of all labels with the given name, inherited ones included, for labels that can occur more than once.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedLabelValues</code></td>
            <td><pre><code class="language-application-typescript">getOwnedLabelValues(name: string): string[]</code></pre><p>Returns the values of all labels with the given name defined directly on this note.</p></td>
        </tr>
        <tr>
            <td><code>hasLabel</code></td>
            <td><pre><code class="language-application-typescript">hasLabel(name: string): boolean</code></pre><p>Returns whether the note has a label with the given name, inherited ones included.</p></td>
        </tr>
        <tr>
            <td><code>hasOwnedLabel</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedLabel(name: string, value?: string): boolean</code></pre><p>Returns whether the note has a label with the given name defined directly on it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The value to match; when omitted, any value matches.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>isLabelTruthy</code></td>
            <td><pre><code class="language-application-typescript">isLabelTruthy(name: string): boolean</code></pre><p>Returns whether the note has a label with the given name, inherited ones included, whose value is not <code>"false"</code>. A label without a value counts as <code>true</code>.</p></td>
        </tr>
        <tr>
            <td><code>hasInheritableArchivedLabel</code></td>
            <td><pre><code class="language-application-typescript">hasInheritableArchivedLabel(): boolean</code></pre><p>Returns <code>true</code> if the note has an inheritable <code>#archived</code> label, owned or inherited, so that the note's descendants are archived too.</p></td>
        </tr>
        <tr>
            <td><code>getRelation</code></td>
            <td><pre><code class="language-application-typescript">getRelation(name: string): Attribute | null</code></pre><p>Returns the first relation with the given name, inherited ones included, or <code>null</code> if there is none. Pass the name without the leading <code>~</code>.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelation</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelation(name: string): Attribute | null</code></pre><p>Returns the first relation with the given name defined directly on this note, or <code>null</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>getRelations</code></td>
            <td><pre><code class="language-application-typescript">getRelations(name?: string): Attribute[]</code></pre><p>Returns the relations of this note, inherited ones included. When <code>name</code> is given, only relations with that name are returned.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelations</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelations(name?: string | null): Attribute[]</code></pre><p>Returns the relations defined directly on this note. When <code>name</code> is given, only relations with that name are returned.</p></td>
        </tr>
        <tr>
            <td><code>getRelationValue</code></td>
            <td><pre><code class="language-application-typescript">getRelationValue(name: string): string | null</code></pre><p>Returns the ID of the note that the first relation with the given name points to, inherited relations included, or <code>null</code> if there is none. To get the note itself, use <code>getRelationTarget()</code>.</p></td>
        </tr>
        <tr>
            <td><code>getOwnedRelationValue</code></td>
            <td><pre><code class="language-application-typescript">getOwnedRelationValue(name: string): string | null</code></pre><p>Returns the ID of the note that the first relation with the given name defined directly on this note points to, or <code>null</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>getRelationTarget</code></td>
            <td><pre><code class="language-application-typescript">getRelationTarget(name: string): BNote | null</code></pre><p>Returns the note that the first relation with the given name points to, or <code>null</code> if the note has no such relation. Inherited relations are included.</p></td>
        </tr>
        <tr>
            <td><code>hasRelation</code></td>
            <td><pre><code class="language-application-typescript">hasRelation(name: string, value?: string): boolean</code></pre><p>Returns whether the note has a relation with the given name, inherited ones included.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The ID of the target note to match; when omitted, any target matches.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>hasOwnedRelation</code></td>
            <td><pre><code class="language-application-typescript">hasOwnedRelation(name: string, value?: string): boolean</code></pre><p>Returns whether the note has a relation with the given name defined directly on it.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The ID of the target note to match; when omitted, any target matches.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>addLabel</code></td>
            <td><pre><code class="language-application-typescript">addLabel(name: string, value?: string, isInheritable?: boolean): Attribute</code></pre><p>Adds a label to this note, saves it and returns it. It adds a new label even when the note already has one with that name; to change an existing label instead, use <code>setLabel()</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code><br>The label name, without the leading <code>#</code>.</td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The label value. Defaults to an empty string.</td></tr><tr><td><code>isInheritable</code><br><em>optional</em></td><td><code>boolean</code><br>Whether the note's descendants inherit the label. Defaults to <code>false</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>addRelation</code></td>
            <td><pre><code class="language-application-typescript">addRelation(name: string, targetNoteId: string, isInheritable?: boolean): Attribute</code></pre><p>Adds a relation from this note to another note, saves it and returns it. It adds a new relation even when the note already has one with that name; to change an existing relation instead, use <code>setRelation()</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code><br>The relation name, without the leading <code>~</code>.</td></tr><tr><td><code>targetNoteId</code></td><td><code>string</code></td></tr><tr><td><code>isInheritable</code><br><em>optional</em></td><td><code>boolean</code><br>Whether the note's descendants inherit the relation. Defaults to <code>false</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>addAttribute</code></td>
            <td><pre><code class="language-application-typescript">addAttribute(type: string, name: string, value?: string, isInheritable?: boolean): Attribute</code></pre><p>Adds a label or relation to this note, saves it and returns it. <code>addLabel()</code> and <code>addRelation()</code> do the same for one type.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code><br>The attribute name, without the leading <code>#</code> or <code>~</code>.</td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The label's text, or the relation's target note ID. Defaults to an empty string.</td></tr><tr><td><code>isInheritable</code><br><em>optional</em></td><td><code>boolean</code><br>Whether the note's descendants inherit the attribute. Defaults to <code>false</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setLabel</code></td>
            <td><pre><code class="language-application-typescript">setLabel(name: string, value?: string): void</code></pre><p>Sets the value of the first label with the given name defined directly on this note, or adds a non-inheritable label if the note has none of its own. Inherited labels are left alone. The change is saved immediately.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The new value. Defaults to an empty string.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setRelation</code></td>
            <td><pre><code class="language-application-typescript">setRelation(name: string, value?: string): void</code></pre><p>Points the first relation with the given name defined directly on this note to another note, or adds a non-inheritable relation if the note has none of its own. Inherited relations are left alone. The change is saved immediately.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The ID of the target note.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setAttribute</code></td>
            <td><pre><code class="language-application-typescript">setAttribute(type: string, name: string, value?: string): void</code></pre><p>Sets the value of the first attribute of the given type and name defined directly on this note, or adds a non-inheritable one if the note has none of its own. <code>setLabel()</code> and <code>setRelation()</code> do the same for one type. The change is saved immediately.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The label's text, or the relation's target note ID. Defaults to an empty string.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>setAttributeValueById</code></td>
            <td><pre><code class="language-application-typescript">setAttributeValueById(attributeId: string, value?: string): void</code></pre><p>Sets the value of the attribute with the given ID, which must be defined directly on this note, and saves it. Throws an error if the note has no such attribute of its own.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>attributeId</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The new value. Defaults to an empty string.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>toggleLabel</code></td>
            <td><pre><code class="language-application-typescript">toggleLabel(enabled: boolean, name: string, value?: string): void</code></pre><p>Sets the label like <code>setLabel()</code> when <code>enabled</code> is <code>true</code>, and removes it like <code>removeLabel()</code> when it is <code>false</code>.</p></td>
        </tr>
        <tr>
            <td><code>toggleRelation</code></td>
            <td><pre><code class="language-application-typescript">toggleRelation(enabled: boolean, name: string, value?: string): void</code></pre><p>Sets the relation like <code>setRelation()</code> when <code>enabled</code> is <code>true</code>, and removes it like <code>removeRelation()</code> when it is <code>false</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>enabled</code></td><td><code>boolean</code></td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The ID of the target note.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>toggleAttribute</code></td>
            <td><pre><code class="language-application-typescript">toggleAttribute(type: string, enabled: boolean, name: string, value?: string): void</code></pre><p>Sets the attribute like <code>setAttribute()</code> when <code>enabled</code> is <code>true</code>, and removes it like <code>removeAttribute()</code> when it is <code>false</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>enabled</code></td><td><code>boolean</code></td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code></td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>removeLabel</code></td>
            <td><pre><code class="language-application-typescript">removeLabel(name: string, value?: string): void</code></pre><p>Removes every label with the given name defined directly on this note. Inherited labels are not affected.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The value to match; when omitted, labels with any value are removed.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>removeRelation</code></td>
            <td><pre><code class="language-application-typescript">removeRelation(name: string, value?: string): void</code></pre><p>Removes every relation with the given name defined directly on this note. Inherited relations are not affected.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The ID of the target note to match; when omitted, relations to any note are removed.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>removeAttribute</code></td>
            <td><pre><code class="language-application-typescript">removeAttribute(type: string, name: string, value?: string): void</code></pre><p>Removes every attribute of the given type and name defined directly on this note. Inherited attributes are not affected.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>type</code></td><td><code>string</code><br><code>"label"</code> or <code>"relation"</code>.</td></tr><tr><td><code>name</code></td><td><code>string</code></td></tr><tr><td><code>value</code><br><em>optional</em></td><td><code>string</code><br>The value to match; when omitted, attributes with any value are removed.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>isInherited</code></td>
            <td><pre><code class="language-application-typescript">isInherited(): boolean</code></pre><p>Returns <code>true</code> if another note uses this note as its template or inheritance source, through a <code>~template</code> or <code>~inherit</code> relation. Despite the name, it does not tell whether this note inherits attributes itself.</p></td>
        </tr>
        <tr>
            <td><code>revisionCount</code></td>
            <td><p><code>number | null</code><br>The number of revisions of this note. It is <code>null</code> until a search that filters or sorts by <code>revisionCount</code> or one of the size properties has run; <code>getRevisions().length</code> always works.</p></td>
        </tr>
        <tr>
            <td><code>getRevisions</code></td>
            <td><pre><code class="language-application-typescript">getRevisions(): BRevision[]</code></pre><p>Returns the saved revisions of this note, oldest first.</p></td>
        </tr>
        <tr>
            <td><code>saveRevision</code></td>
            <td><pre><code class="language-application-typescript">saveRevision(opts?: { description?: string; source?: string }): BRevision</code></pre><p>Saves a revision that snapshots the note's current title, content and attachments, and returns it. Afterwards, Trilium erases the oldest revisions beyond the number the revision settings keep.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code><br><em>optional</em></td><td><code>{ description?: string; source?: string }</code><br><code>description</code> names the revision; <code>source</code> records what created it: <code>"auto"</code> (the default), <code>"manual"</code>, <code>"etapi"</code>, <code>"llm"</code> or <code>"restore"</code>.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>getAttachments</code></td>
            <td><pre><code class="language-application-typescript">getAttachments(): BAttachment[]</code></pre><p>Returns the attachments of this note, ordered by position. Deleted attachments are excluded.</p></td>
        </tr>
        <tr>
            <td><code>getAttachmentById</code></td>
            <td><pre><code class="language-application-typescript">getAttachmentById(attachmentId: string): BAttachment</code></pre><p>Returns the attachment of this note with the given ID. Returns <code>undefined</code> if this note has no such attachment, although the type does not say so.</p></td>
        </tr>
        <tr>
            <td><code>getAttachmentByTitle</code></td>
            <td><pre><code class="language-application-typescript">getAttachmentByTitle(title: string): BAttachment | undefined</code></pre><p>Returns the first attachment of this note whose title matches exactly, or <code>undefined</code> if none does.</p></td>
        </tr>
        <tr>
            <td><code>getAttachmentsByRole</code></td>
            <td><pre><code class="language-application-typescript">getAttachmentsByRole(role: string): BAttachment[]</code></pre><p>Returns the attachments of this note with the given role, such as <code>"image"</code> or <code>"file"</code>, ordered by position.</p></td>
        </tr>
        <tr>
            <td><code>saveAttachment</code></td>
            <td><pre><code class="language-application-typescript">saveAttachment(attachment: SaveAttachmentInput, matchBy?: "title" | "attachmentId"): BAttachment</code></pre><p>Saves an attachment of this note and returns it. If an existing attachment matches, only its content is replaced; otherwise a new attachment is created from <code>attachment</code>, protected if the note is. Missing content is saved as an empty string.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>attachment</code></td><td><a href="#type-SaveAttachmentInput"><code>SaveAttachmentInput</code></a></td></tr><tr><td><code>matchBy</code><br><em>optional</em></td><td><code>"title" | "attachmentId"</code><br>How to find an existing attachment to update: <code>"attachmentId"</code> (the default) by <code>attachment.attachmentId</code>, which throws an error if no attachment has that ID, or <code>"title"</code> by <code>attachment.title</code> among this note's attachments.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>convertToParentAttachment</code></td>
            <td><pre><code class="language-application-typescript">convertToParentAttachment(opts?: { autoConversion?: boolean }): BAttachment | null</code></pre><p>Converts this image note into an image attachment of its parent text note, points the parent's content at the attachment, deletes this note and returns the attachment. Returns <code>null</code> and changes nothing when <code>isEligibleForConversionToAttachment()</code> returns <code>false</code>.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code><br><em>optional</em></td><td><code>{ autoConversion?: boolean }</code><br>Pass <code>{ autoConversion: true }</code> to also require that the parent links the image.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>isEligibleForConversionToAttachment</code></td>
            <td><pre><code class="language-application-typescript">isEligibleForConversionToAttachment(opts?: { autoConversion?: boolean }): boolean</code></pre><p>Returns <code>true</code> if this note can be converted into an attachment of its parent: it is an image note with no children and a single parent, the parent is a text note, both are readable in the current session, and at most one <code>~imageLink</code> relation points to the image, from the parent.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>opts</code><br><em>optional</em></td><td><code>{ autoConversion?: boolean }</code><br>Pass <code>{ autoConversion: true }</code> to also require that the parent links the image.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>contentSize</code></td>
            <td><p><code>number | null</code><br>The size of the note's content in bytes. Like the other size properties, it is <code>null</code> until a search that filters or sorts by one of them, or by <code>revisionCount</code>, has run.</p></td>
        </tr>
        <tr>
            <td><code>contentAndAttachmentsSize</code></td>
            <td><p><code>number | null</code><br>The size in bytes of the note's content together with its attachments, counting content that several of them share once. It is <code>null</code> until a search that uses it has run.</p></td>
        </tr>
        <tr>
            <td><code>contentAndAttachmentsAndRevisionsSize</code></td>
            <td><p><code>number | null</code><br>The size in bytes of the note's content together with its attachments and its revisions and their attachments, counting shared content once. It is <code>null</code> until a search that uses it has run.</p></td>
        </tr>
        <tr>
            <td><code>cloneTo</code></td>
            <td><pre><code class="language-application-typescript">cloneTo(parentNoteId: string): CloneResponse</code></pre><p>Places this note under another parent note as well, keeping its existing placements, and expands the new parent in the note tree. The result does not throw on failure; check <code>success</code>, and read <code>message</code> for why it failed (for example, the note is already in that parent, the target is a search note, or the clone would create a cycle).</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>parentNoteId</code></td><td><code>string</code><br>The ID of the note to clone into.</td></tr></tbody></table></figure><p><strong>Returns</strong> <a href="#type-CloneResponse"><code>CloneResponse</code></a>: On success, <code>branchId</code> of the new branch and <code>notePath</code> of the clone.</p></td>
        </tr>
        <tr>
            <td><code>deleteNote</code></td>
            <td><pre><code class="language-application-typescript">deleteNote(deleteId?: string | null): void</code></pre><p>Deletes the note from every place in the tree, together with its descendants that have no other placement, and runs its <code>runOnNoteDeletion</code> relations first. Deleted notes stay recoverable until they are erased. Does nothing if the note is already deleted.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>deleteId</code><br><em>optional</em></td><td><code>string | null</code><br>An ID that groups the deleted notes, branches and attributes so that they can be restored together. Defaults to a new random ID.</td></tr></tbody></table></figure></td>
        </tr>
        <tr>
            <td><code>sortParents</code></td>
            <td><pre><code class="language-application-typescript">sortParents(): void</code></pre><p>Reorders this note's <code>parents</code> and <code>parentBranches</code> in memory so that archived and hidden parents come last, which makes Trilium prefer the other paths when it picks a note path. Saves nothing.</p></td>
        </tr>
        <tr>
            <td><code>sortChildren</code></td>
            <td><pre><code class="language-application-typescript">sortChildren(): void</code></pre><p>Reorders this note's <code>children</code> array in memory by each child's <code>notePosition</code>. Saves nothing and does not change the order shown in the note tree.</p></td>
        </tr>
        <tr>
            <td><code>searchNotesInSubtree</code></td>
            <td><pre><code class="language-application-typescript">searchNotesInSubtree(searchString: string): BNote[]</code></pre><p>Returns the notes that match a search query. Despite the name, the search covers the whole tree, not only this note's subtree, and leaves out archived and hidden notes; to limit it to this note's subtree, call <code>api.searchForNotes(query, { ancestorNoteId: note.noteId })</code>.</p></td>
        </tr>
        <tr>
            <td><code>searchNoteInSubtree</code></td>
            <td><pre><code class="language-application-typescript">searchNoteInSubtree(searchString: string): BNote | null</code></pre><p>Returns the first note that matches a search query, or <code>undefined</code> if none does. Like <code>searchNotesInSubtree()</code>, the search covers the whole tree, not only this note's subtree.</p></td>
        </tr>
        <tr>
            <td><code>getSearchResultNotes</code></td>
            <td><pre><code class="language-application-typescript">getSearchResultNotes(): BNote[]</code></pre><p>Runs the saved search of a search note and returns the notes it finds. Returns an empty array for other note types, and when the search fails (the error goes to the backend log).</p></td>
        </tr>
        <tr>
            <td><code>isFolder</code></td>
            <td><pre><code class="language-application-typescript">isFolder(): boolean</code></pre><p>Returns <code>true</code> if this note is a search note or has at least one child, archived children included.</p></td>
        </tr>
        <tr>
            <td><code>isContentAvailable</code></td>
            <td><pre><code class="language-application-typescript">isContentAvailable(): boolean</code></pre><p>Returns <code>true</code> if the note's title and content can be read: the note is not protected, or a protected session is open. Otherwise the content reads as an empty string and the title as <code>"[protected]"</code>.</p></td>
        </tr>
        <tr>
            <td><code>isStringNote</code></td>
            <td><pre><code class="language-application-typescript">isStringNote(): boolean</code></pre><p>Returns whether <code>getContent()</code> returns a string rather than a <code>Uint8Array</code>.</p><aside class="admonition warning"><p>Deprecated. Use <code>hasStringContent()</code> instead.</p></aside></td>
        </tr>
        <tr>
            <td><code>isHtml</code></td>
            <td><pre><code class="language-application-typescript">isHtml(): boolean</code></pre><p>Returns whether this is a code, file or render note with the MIME type <code>text/html</code>.</p></td>
        </tr>
        <tr>
            <td><code>isImage</code></td>
            <td><pre><code class="language-application-typescript">isImage(): boolean</code></pre><p>Returns whether this is an image note, or a file note with an <code>image/*</code> MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isJavaScript</code></td>
            <td><pre><code class="language-application-typescript">isJavaScript(): boolean</code></pre><p>Returns whether this is a code, file or launcher note with a JavaScript MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isJsx</code></td>
            <td><pre><code class="language-application-typescript">isJsx(): boolean</code></pre><p>Returns <code>true</code> if this is a code note with the MIME type <code>text/jsx</code>.</p></td>
        </tr>
        <tr>
            <td><code>isJson</code></td>
            <td><pre><code class="language-application-typescript">isJson(): boolean</code></pre><p>Returns whether the note's MIME type is <code>application/json</code>, whatever its type.</p></td>
        </tr>
        <tr>
            <td><code>isMarkdown</code></td>
            <td><pre><code class="language-application-typescript">isMarkdown(): boolean</code></pre><p>Returns whether this is a code note with a Markdown MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isOptions</code></td>
            <td><pre><code class="language-application-typescript">isOptions(): boolean</code></pre><p>Returns <code>true</code> if this note is one of the settings pages in the hidden subtree, whose IDs start with <code>_options</code>.</p></td>
        </tr>
        <tr>
            <td><code>isLaunchBarConfig</code></td>
            <td><pre><code class="language-application-typescript">isLaunchBarConfig(): boolean</code></pre><p>Returns <code>true</code> if this note is a launcher or one of the containers that configure the desktop or mobile launch bar.</p></td>
        </tr>
        <tr>
            <td><code>isHiddenCompletely</code></td>
            <td><pre><code class="language-application-typescript">isHiddenCompletely(): boolean</code></pre><p>Returns whether every path to this note passes through the hidden subtree (<code>_hidden</code>), so that the note has no placement in the visible tree. Returns <code>false</code> for the root note and for <code>_hidden</code> itself.</p></td>
        </tr>
        <tr>
            <td><code>isInHiddenSubtree</code></td>
            <td><pre><code class="language-application-typescript">isInHiddenSubtree(): boolean</code></pre><p>Returns <code>true</code> if this note is the hidden root note (<code>_hidden</code>) or lies under it in any of its placements. The hidden subtree holds Trilium's system notes, such as settings, launchers and templates.</p></td>
        </tr>
        <tr>
            <td><code>getScriptEnv</code></td>
            <td><pre><code class="language-application-typescript">getScriptEnv(): "frontend" | "backend" | null</code></pre><p>Returns where the note runs as a script: <code>"backend"</code> for JavaScript with <code>env=backend</code> in its MIME type, <code>"frontend"</code> for frontend JavaScript, JSX, HTML and render notes, and <code>null</code> for notes that are not scripts.</p></td>
        </tr>
        <tr>
            <td><code>executeScript</code></td>
            <td><pre><code class="language-application-typescript">executeScript(): unknown</code></pre><p>Runs this note as a backend script and returns the script's return value, which is a promise for an async script. The note must be a backend JavaScript code note; for any other note it runs nothing and returns <code>undefined</code>. Throws an error if the note is protected and no protected session is active, or if backend scripting is disabled.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-BBranch"></a>`BBranch`

A branch (note→parent placement) as seen by backend scripts (subset of `BBranch`).

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
            <td><p><code>string</code><br>The ID of the branch. Moving a note to another parent replaces its branch with a new one, so store the note ID rather than the branch ID when you need a stable reference.</p></td>
        </tr>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string</code><br>The ID of the child note this branch places in the tree.</p></td>
        </tr>
        <tr>
            <td><code>parentNoteId</code></td>
            <td><p><code>string</code><br>The ID of the parent note. For the root note's branch, it is <code>"none"</code>.</p></td>
        </tr>
        <tr>
            <td><code>prefix</code></td>
            <td><p><code>string | null</code><br>The text shown before the note's title in the note tree for this placement only, or <code>null</code> if there is none.</p></td>
        </tr>
        <tr>
            <td><code>notePosition</code></td>
            <td><p><code>number</code><br>The position of the note among its siblings under this parent; notes with lower values come first.</p></td>
        </tr>
        <tr>
            <td><code>isExpanded</code></td>
            <td><p><code>boolean</code><br>Whether the note is expanded in the note tree at this placement, showing its children.</p></td>
        </tr>
        <tr>
            <td><code>getNote</code></td>
            <td><pre><code class="language-application-typescript">getNote(): BNote</code></pre><p>Returns the child note this branch places in the tree.</p></td>
        </tr>
        <tr>
            <td><code>getParentNote</code></td>
            <td><pre><code class="language-application-typescript">getParentNote(): BNote | null</code></pre><p>Returns the parent note. The root note's branch has no parent note.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-Request"></a>`Request`

Minimal Express `Request` surface available to **custom request handlers** (a subset of Express's `Request` — re-declared here to keep this module self-contained). Only the commonly used members are typed; the real object is a full Express request.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>params</code></td>
            <td><p><code>Record&lt;string, string&gt;</code><br>Route/path parameters.</p></td>
        </tr>
        <tr>
            <td><code>query</code></td>
            <td><p><code>Record&lt;string, unknown&gt;</code><br>Parsed query-string parameters.</p></td>
        </tr>
        <tr>
            <td><code>body</code></td>
            <td><p><code>unknown</code><br>Parsed request body (requires a matching body parser).</p></td>
        </tr>
        <tr>
            <td><code>headers</code></td>
            <td><p><code>Record&lt;string, string | string[] | undefined&gt;</code><br>Request headers (lower-cased names).</p></td>
        </tr>
        <tr>
            <td><code>method</code></td>
            <td><p><code>string</code><br>HTTP method, e.g. "GET", "POST".</p></td>
        </tr>
        <tr>
            <td><code>url</code></td>
            <td><p><code>string</code><br>Request URL (path + query string).</p></td>
        </tr>
        <tr>
            <td><code>get</code></td>
            <td><pre><code class="language-application-typescript">get(headerName: string): string | undefined</code></pre><p>Returns the value of the given (case-insensitive) header.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-Response"></a>`Response`

Minimal Express `Response` surface available to **custom request handlers** (a subset of Express's `Response`). Write the HTTP response through this object, e.g. `api.res.status(200).json({ ok: true })`.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>status</code></td>
            <td><pre><code class="language-application-typescript">status(code: number): Response</code></pre><p>Sets the HTTP status code (chainable).</p></td>
        </tr>
        <tr>
            <td><code>send</code></td>
            <td><pre><code class="language-application-typescript">send(body?: unknown): Response</code></pre><p>Sends the response body (string, Buffer, object, …) and ends the response.</p></td>
        </tr>
        <tr>
            <td><code>json</code></td>
            <td><pre><code class="language-application-typescript">json(body: unknown): Response</code></pre><p>Sends a JSON response and ends the response.</p></td>
        </tr>
        <tr>
            <td><code>setHeader</code></td>
            <td><pre><code class="language-application-typescript">setHeader(name: string, value: string | string[]): Response</code></pre><p>Sets a response header (chainable).</p></td>
        </tr>
        <tr>
            <td><code>set</code></td>
            <td><pre><code class="language-application-typescript">set(field: string, value?: string): Response</code></pre><p>Sets a response header (Express alias of <code>setHeader</code>, chainable).</p></td>
        </tr>
        <tr>
            <td><code>redirect</code></td>
            <td><pre><code class="language-application-typescript">redirect(url: string): void</code></pre><p>Redirects to the given URL.</p></td>
        </tr>
        <tr>
            <td><code>end</code></td>
            <td><pre><code class="language-application-typescript">end(): void</code></pre><p>Ends the response without further data.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-BAttachment"></a>`BAttachment`

An attachment as seen by backend scripts (subset of trilium-core's `BAttachment`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>attachmentId</code><br><em>optional</em></td>
            <td><p><code>string</code><br>The ID of the attachment. It is <code>undefined</code> until a new attachment is first saved.</p></td>
        </tr>
        <tr>
            <td><code>ownerId</code></td>
            <td><p><code>string</code><br>The ID of the note the attachment belongs to. For an attachment of a revision, it is the ID of the revision.</p></td>
        </tr>
        <tr>
            <td><code>role</code></td>
            <td><p><code>string</code><br>The purpose of the attachment: <code>image</code> for an image shown in a text note, <code>file</code> for an attached file. Trilium also uses roles of its own, such as <code>viewConfig</code> for a collection's view settings.</p></td>
        </tr>
        <tr>
            <td><code>mime</code></td>
            <td><p><code>string</code><br>The MIME type of the attachment's content, such as <code>image/png</code>.</p></td>
        </tr>
        <tr>
            <td><code>title</code></td>
            <td><p><code>string</code><br>The title of the attachment, usually its file name. For a protected attachment outside a protected session, it holds the encrypted title; use <code>getTitleOrProtected()</code> to show it.</p></td>
        </tr>
        <tr>
            <td><code>position</code><br><em>optional</em></td>
            <td><p><code>number</code><br>The place of the attachment among its owner's attachments, listed by ascending position.</p></td>
        </tr>
        <tr>
            <td><code>isProtected</code><br><em>optional</em></td>
            <td><p><code>boolean</code><br>Whether the attachment is protected (encrypted).</p></td>
        </tr>
        <tr>
            <td><code>blobId</code><br><em>optional</em></td>
            <td><p><code>string</code><br>The ID of the blob that stores the content. It changes whenever the content changes.</p></td>
        </tr>
        <tr>
            <td><code>utcDateModified</code><br><em>optional</em></td>
            <td><p><code>string</code><br>The date and time, in UTC, that the attachment was last saved.</p></td>
        </tr>
        <tr>
            <td><code>contentLength</code><br><em>optional</em></td>
            <td><p><code>number</code><br>The length of the attachment's content, when it was loaded together with the attachment. Attachments returned by <code>note.getAttachmentsByRole()</code> leave it <code>undefined</code>.</p></td>
        </tr>
        <tr>
            <td><code>getNote</code></td>
            <td><pre><code class="language-application-typescript">getNote(): BNote | undefined</code></pre><p>Returns the note the attachment belongs to, or <code>undefined</code> for a revision's attachment.</p></td>
        </tr>
        <tr>
            <td><code>getContent</code></td>
            <td><pre><code class="language-application-typescript">getContent(): string | Uint8Array&lt;ArrayBufferLike&gt;</code></pre><p>Returns the content: a string for text-based content, a <code>Uint8Array</code> for binary content such as images. For a protected attachment outside a protected session, it returns an empty string.</p></td>
        </tr>
        <tr>
            <td><code>setContent</code></td>
            <td><pre><code class="language-application-typescript">setContent(content: string | Uint8Array&lt;ArrayBufferLike&gt;, opts?: { forceSave?: boolean; forceFrontendReload?: boolean }): void</code></pre><p>Replaces the content and saves it immediately. Throws an error for a protected attachment outside a protected session.</p></td>
        </tr>
        <tr>
            <td><code>hasStringContent</code></td>
            <td><pre><code class="language-application-typescript">hasStringContent(): boolean</code></pre><p>Returns whether the content is text rather than binary, judged by the MIME type.</p></td>
        </tr>
        <tr>
            <td><code>isContentAvailable</code></td>
            <td><pre><code class="language-application-typescript">isContentAvailable(): boolean</code></pre><p>Returns whether the title and content can be read: the attachment is not protected, or a protected session is active.</p></td>
        </tr>
        <tr>
            <td><code>getTitleOrProtected</code></td>
            <td><pre><code class="language-application-typescript">getTitleOrProtected(): string</code></pre><p>Returns the title, or <code>[protected]</code> when the title cannot be read.</p></td>
        </tr>
        <tr>
            <td><code>getFileName</code></td>
            <td><pre><code class="language-application-typescript">getFileName(): string</code></pre><p>Returns the file name the attachment downloads under: its title with a fitting extension.</p></td>
        </tr>
        <tr>
            <td><code>convertToNote</code></td>
            <td><pre><code class="language-application-typescript">convertToNote(): NoteAndBranch</code></pre><p>Turns the attachment into a child note of its owner and deletes the attachment. In a text note, images and links that point to the attachment are rewritten to point to the new note. Throws an error for a revision's attachment, and for a protected one outside a protected session.</p></td>
        </tr>
        <tr>
            <td><code>save</code></td>
            <td><pre><code class="language-application-typescript">save(): this</code></pre><p>Saves changes made to the attachment's properties, such as <code>title</code>.</p></td>
        </tr>
        <tr>
            <td><code>markAsDeleted</code></td>
            <td><pre><code class="language-application-typescript">markAsDeleted(deleteId?: string | null): void</code></pre><p>Deletes the attachment. Deleted attachments stay recoverable until they are erased.</p><figure class="table"><table><thead><tr><th>Parameter</th><th>Description</th></tr></thead><tbody><tr><td><code>deleteId</code><br><em>optional</em></td><td><code>string | null</code><br>An ID that groups items deleted together, so that they can be restored together.</td></tr></tbody></table></figure></td>
        </tr>
    </tbody>
</table>

## <a id="type-BRevision"></a>`BRevision`

A note revision as seen by backend scripts (subset of trilium-core's `BRevision`).

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>revisionId</code><br><em>optional</em></td>
            <td><p><code>string</code><br>The ID of the revision.</p></td>
        </tr>
        <tr>
            <td><code>noteId</code></td>
            <td><p><code>string</code><br>The ID of the note this revision belongs to.</p></td>
        </tr>
        <tr>
            <td><code>type</code></td>
            <td><p><code>string</code><br>The note's type at the time of the revision, such as <code>"text"</code> or <code>"code"</code>.</p></td>
        </tr>
        <tr>
            <td><code>mime</code></td>
            <td><p><code>string</code><br>The note's MIME type at the time of the revision.</p></td>
        </tr>
        <tr>
            <td><code>title</code></td>
            <td><p><code>string</code><br>The note's title at the time of the revision. For a protected revision outside a protected session, it is <code>"[protected]"</code>.</p></td>
        </tr>
        <tr>
            <td><code>dateLastEdited</code><br><em>optional</em></td>
            <td><p><code>string</code><br>When the note was last edited before the revision was saved, in local time with its UTC offset, formatted as <code>YYYY-MM-DD HH:mm:ss.SSS+ZZZZ</code> (for example, <code>2026-10-22 14:05:09.123+0200</code>).</p></td>
        </tr>
        <tr>
            <td><code>utcDateLastEdited</code><br><em>optional</em></td>
            <td><p><code>string</code><br>When the note was last edited before the revision was saved, in UTC, formatted as <code>YYYY-MM-DD HH:mm:ss.SSSZ</code> (for example, <code>2026-10-22 12:05:09.123Z</code>).</p></td>
        </tr>
        <tr>
            <td><code>contentLength</code><br><em>optional</em></td>
            <td><p><code>number</code><br>The size of the revision's content in bytes, when it was loaded together with the revision. Revisions returned by <code>note.getRevisions()</code> and <code>note.saveRevision()</code> leave it <code>undefined</code>.</p></td>
        </tr>
        <tr>
            <td><code>getContent</code></td>
            <td><pre><code class="language-application-typescript">getContent(): string | Uint8Array&lt;ArrayBufferLike&gt;</code></pre><p>Returns the content of the revision: a string for text-based note types, a <code>Uint8Array</code> for binary ones such as images and files. For a protected revision outside a protected session, it returns an empty string.</p></td>
        </tr>
        <tr>
            <td><code>getJsonContent</code></td>
            <td><pre><code class="language-application-typescript">getJsonContent(): unknown</code></pre><p>Returns the revision's content parsed as JSON. Returns <code>null</code> when the content is empty, blank or binary, and throws an error when it is not valid JSON.</p></td>
        </tr>
    </tbody>
</table>

## <a id="type-Sql"></a>`Sql`

Direct access to Trilium's SQLite database (subset of trilium-core's `SqlService`). Queries mark parameters with `?` and take their values in an array, in order. Changes made here bypass Trilium's own bookkeeping: they do not sync, and Trilium's in-memory copy of the notes does not see them until the next restart. Change notes through the note methods instead.

<table>
    <thead>
        <tr>
            <th>Member</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>getRow</code></td>
            <td><pre><code class="language-application-typescript">getRow&lt;T&gt;(query: string, params?: unknown[]): T</code></pre><p>Returns the first row of the result, as an object of column names to values, or <code>undefined</code> when the query returns no rows.</p></td>
        </tr>
        <tr>
            <td><code>getRowOrNull</code></td>
            <td><pre><code class="language-application-typescript">getRowOrNull&lt;T&gt;(query: string, params?: unknown[]): T | null</code></pre><p>Returns the first row of the result, or <code>null</code> when the query returns no rows.</p></td>
        </tr>
        <tr>
            <td><code>getValue</code></td>
            <td><pre><code class="language-application-typescript">getValue&lt;T&gt;(query: string, params?: unknown[]): T</code></pre><p>Returns the first column of the first row, such as the count of <code>SELECT COUNT(*) FROM notes</code>, or <code>undefined</code> when the query returns no rows.</p></td>
        </tr>
        <tr>
            <td><code>getRows</code></td>
            <td><pre><code class="language-application-typescript">getRows&lt;T&gt;(query: string, params?: unknown[]): T[]</code></pre><p>Returns every row of the result, each as an object of column names to values.</p></td>
        </tr>
        <tr>
            <td><code>getColumn</code></td>
            <td><pre><code class="language-application-typescript">getColumn&lt;T&gt;(query: string, params?: unknown[]): T[]</code></pre><p>Returns the first column of every row of the result.</p></td>
        </tr>
        <tr>
            <td><code>getMap</code></td>
            <td><pre><code class="language-application-typescript">getMap&lt;K extends string | number | symbol, V&gt;(query: string, params?: unknown[]): Record&lt;K, V&gt;</code></pre><p>Returns an object that maps the first column of each row to its second column.</p></td>
        </tr>
        <tr>
            <td><code>iterateRows</code></td>
            <td><pre><code class="language-application-typescript">iterateRows&lt;T&gt;(query: string, params?: unknown[]): IterableIterator&lt;T&gt;</code></pre><p>Returns the rows of the result one at a time, which keeps a large result out of memory.</p></td>
        </tr>
        <tr>
            <td><code>execute</code></td>
            <td><pre><code class="language-application-typescript">execute(query: string, params?: unknown[]): { changes: number; lastInsertRowid: number }</code></pre><p>Runs a statement that changes data, such as <code>UPDATE</code> or <code>INSERT</code>.</p><p><strong>Returns</strong> <code>{ changes: number; lastInsertRowid: number }</code>: <code>changes</code>, the number of rows changed, and <code>lastInsertRowid</code>, the ID of the row an <code>INSERT</code> added.</p></td>
        </tr>
        <tr>
            <td><code>executeScript</code></td>
            <td><pre><code class="language-application-typescript">executeScript(query: string): void</code></pre><p>Runs several statements separated by semicolons, without parameters.</p></td>
        </tr>
        <tr>
            <td><code>transactional</code></td>
            <td><pre><code class="language-application-typescript">transactional&lt;T&gt;(func: () =&gt; T): T</code></pre><p>Calls <code>func</code> in a transaction: when it throws, every change it made is undone. Inside a transaction already running, it runs as a nested savepoint.</p><p><strong>Returns</strong> <code>T</code>: What <code>func</code> returns.</p></td>
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

### <a id="type-Dayjs"></a>`Dayjs`

Minimal day.js surface (the real API exposes the full day.js factory).

```typescript
type Dayjs = (date?: string | number | Date) => DayjsInstance
```

### <a id="type-Xml2js"></a>`Xml2js`

The [xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) library, version 0.6, which converts between XML and JavaScript objects, such as with `xml2js.parseStringPromise(xml)`.

### <a id="type-HtmlParser"></a>`HtmlParser`

The [node-html-parser](https://github.com/taoqf/node-html-parser) library, version 9, which parses HTML into elements that can be queried, such as with `htmlParser.parse(html).querySelectorAll("a")`.

### <a id="type-BEtapiToken"></a>`BEtapiToken`

An ETAPI token, which grants an external program access to the ETAPI (subset of trilium-core's `BEtapiToken`). The token itself is not available, only its hash, which this type leaves out.

| Property | Description |
| --- | --- |
| `etapiTokenId`  <br>_optional_ | `string`  <br>The ID of the token. |
| `name` | `string`  <br>The name given to the token when it was created. |
| `utcDateCreated` | `string`  <br>The date and time, in UTC, that the token was created. |
| `utcDateModified`  <br>_optional_ | `string`  <br>The date and time, in UTC, that the token was last changed, such as renamed. |
| `isDeleted` | `boolean`  <br>Whether the token has been deleted, which revokes it. |

### <a id="type-BOption"></a>`BOption`

An option, one of Trilium's settings (subset of trilium-core's `BOption`).

| Property | Description |
| --- | --- |
| `name` | `string`  <br>The name of the option, such as `theme` or `locale`. |
| `value` | `string`  <br>The value of the option. Every value is a string, numbers and booleans included. |
| `isSynced`  <br>_optional_ | `boolean`  <br>Whether the option syncs to other devices; device-specific options do not. |
| `utcDateModified`  <br>_optional_ | `string`  <br>The date and time, in UTC, that the option last changed. |

### <a id="type-SearchParams"></a>`SearchParams`

Options of `api.searchForNotes()` and `api.searchForNote()`.

| Property | Description |
| --- | --- |
| `fastSearch`  <br>_optional_ | `boolean`  <br>Whether to search only titles and attributes, leaving out note content, which is faster. Defaults to `false`. |
| `includeArchivedNotes`  <br>_optional_ | `boolean`  <br>Whether to include archived notes. Defaults to `true`. |
| `includeHiddenNotes`  <br>_optional_ | `boolean`  <br>Whether to include the hidden subtree's notes, such as settings and launchers. Defaults to `false`. |
| `ignoreHoistedNote`  <br>_optional_ | `boolean`  <br>Whether to search the whole tree even while a note is hoisted. Defaults to `true`; with `false` and no `ancestorNoteId`, only the hoisted note's subtree is searched. |
| `ancestorNoteId`  <br>_optional_ | `string`  <br>The ID of a note to search under: only its descendants are found. |
| `ancestorDepth`  <br>_optional_ | `string`  <br>How deep under `ancestorNoteId` the found notes can lie: `eq`, `gt` or `lt` followed by a depth, such as `eq1` for its children only or `lt4` for less than four levels down. |
| `orderBy`  <br>_optional_ | `string`  <br>What to order the results by: a note property such as `title`, `dateCreated` or `dateModified`, or `relevancy`, the default. |
| `orderDirection`  <br>_optional_ | `string`  <br>`asc` or `desc`; the direction of `orderBy`. |
| `limit`  <br>_optional_ | `number \| null`  <br>The largest number of results to return. |
| `debug`  <br>_optional_ | `boolean`  <br>Whether to write how the query was parsed to the backend log. |
| `fuzzyAttributeSearch`  <br>_optional_ | `boolean`  <br>Whether attribute conditions match loosely: `#status=done` also matches values that contain `done`, and `#stat` matches attributes whose name starts with `stat`. Defaults to `false`. |

### <a id="type-NoteAndBranch"></a>`NoteAndBranch`

Result of the backend note-creation helpers.

| Property | Description |
| --- | --- |
| `note` | [`BNote`](#type-BNote)  <br>The new note. For `duplicateSubtree()`, it is the copy of the original note. |
| `branch` | [`BBranch`](#type-BBranch)  <br>The branch that places the new note under its parent. |

### <a id="type-AppInfo"></a>`AppInfo`

Information about the running Trilium, as `api.getAppInfo()` returns it.

| Property | Description |
| --- | --- |
| `appVersion` | `string`  <br>The version of Trilium, such as `0.106.0`. |
| `dbVersion` | `number`  <br>The version of the database schema. |
| `nodeVersion`  <br>_optional_ | `string`  <br>The version of Node.js; absent in the standalone and mobile apps, which have no Node.js. |
| `syncVersion` | `number`  <br>The version of the sync protocol, which both sides of a sync must share. |
| `buildDate` | `string`  <br>When this build of Trilium was made. |
| `buildRevision` | `string`  <br>The Git commit this build of Trilium was made from. |
| `dataDirectory`  <br>_optional_ | `string`  <br>The directory that holds the database and the other data; absent in the standalone and mobile apps. |
| `clipperProtocolVersion` | `string`  <br>The version of the protocol the web clipper speaks with Trilium. |
| `utcDateTime` | `string`  <br>The date and time, in UTC, that Trilium started, in ISO 8601 form. |

### <a id="type-SubtreeOpts"></a>`SubtreeOpts`

Options accepted by the subtree traversal helpers on [`BNote`](#type-BNote).

| Property | Description |
| --- | --- |
| `includeArchived`  <br>_optional_ | `boolean`  <br>Whether to include archived notes and their descendants. Defaults to `true`. |
| `includeHidden`  <br>_optional_ | `boolean`  <br>Whether to descend into the hidden subtree, `_hidden`, which holds Trilium's system notes. Defaults to `false`. |
| `resolveSearch`  <br>_optional_ | `boolean`  <br>Whether to run each search note and include its results as its children. Defaults to `false`, which includes the search note but none of its results. |

### <a id="type-SubtreeRelationship"></a>`SubtreeRelationship`

A single parent→child link in a subtree ([`BNote.getSubtree`](#type-BNote)).

| Property | Description |
| --- | --- |
| `parentNoteId` | `string`  <br>The ID of the parent note. With `resolveSearch`, it can be a search note and the child one of its results. |
| `childNoteId` | `string`  <br>The ID of the child note. With `includeArchived: false`, it can name an archived note that the list of notes leaves out. |

### <a id="type-NotePathRecord"></a>`NotePathRecord`

One resolved tree path to a note (subset of the client's `NotePathRecord`).

| Property | Description |
| --- | --- |
| `isArchived` | `boolean`  <br>Whether a note on the path, the note itself included, is archived, which means it has the `#archived` label, owned or inherited. |
| `isInHoistedSubTree` | `boolean`  <br>Whether the path passes through the hoisted note passed to `getSortedNotePathRecords()`. It is always `true` when the hoisted note is `root`. |
| `isSearch`  <br>_optional_ | `boolean`  <br>Whether the note itself is a search note. Only frontend scripts get this property; backend records leave it out. |
| `notePath` | `string[]`  <br>The note IDs along the path, from `root` to the note itself. |
| `isHidden` | `boolean`  <br>Whether the path passes through the hidden subtree, `_hidden`, which holds Trilium's system notes. |

### <a id="type-SaveAttachmentInput"></a>`SaveAttachmentInput`

Input accepted by [`BNote.saveAttachment`](#type-BNote).

| Property | Description |
| --- | --- |
| `attachmentId`  <br>_optional_ | `string`  <br>The ID of the attachment to update. Omit it to create a new attachment, which gets an ID of its own. |
| `role` | `string`  <br>The purpose of the attachment, such as `image` or `file`. Used only when a new attachment is created. |
| `mime` | `string`  <br>The MIME type of the content, such as `image/png`. Used only when a new attachment is created. |
| `title` | `string`  <br>The title of the attachment, usually its file name. Used when a new attachment is created, and to find the attachment to update when `matchBy` is `"title"`. |
| `content`  <br>_optional_ | `string \| Uint8Array<ArrayBufferLike>`  <br>The content of the attachment: a string, or bytes for binary content. Defaults to an empty string. |
| `position`  <br>_optional_ | `number`  <br>The place of the attachment among the note's attachments, which `getAttachments()` lists by ascending `position`. Used only when a new attachment is created. |

### <a id="type-CloneResponse"></a>`CloneResponse`

Result of a clone operation ([`BNote.cloneTo`](#type-BNote)); mirrors `CloneResponse`.

| Property | Description |
| --- | --- |
| `success` | `boolean`  <br>Whether the note was cloned. |
| `message`  <br>_optional_ | `string`  <br>Why the clone failed, such as the note already being in that parent. Present only when `success` is `false`. |
| `branchId`  <br>_optional_ | `string`  <br>The ID of the new branch that places the note under the new parent. Present only when `success` is `true`. |
| `notePath`  <br>_optional_ | `string`  <br>The path of the clone, as note IDs from `root` joined by `/`, ending in the note's ID. Present only when `success` is `true`. |