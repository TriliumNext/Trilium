# Hidden Notes
<figure class="image image-style-align-right"><img style="aspect-ratio:263/445;" src="Hidden Notes_image.png" width="263" height="445"></figure>

For easy extensibility, a lot of features in Trilium make use of actual notes to store information as opposed to having them stored in a separate location in the database. This allows some functions such as <a class="reference-link" href="Attributes.md">Attributes</a>, <a class="reference-link" href="Attributes/Relations.md">Relations</a> or even <a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a> and <a class="reference-link" href="../Note%20Types/Text/Links.md">Links</a> to be able to operate on them.

As the name suggests, these notes are hidden to the user by default to prevent cluttering the note tree and to prevent them from being accidentally deleted.

The hidden notes are stored in the user's <a class="reference-link" href="Database.md">Database</a> just like normal notes, but they have a unique <a class="reference-link" href="Note%20ID.md">Note ID</a> which allows them to be distinguished from the normal ones.

## Accessing the hidden note tree

From the <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>, select _Advanced_ → _Show Hidden Subtree_.

## Contents of the hidden note tree

Here is a brief summary of all the notes within the hidden tree:

<table class="ck-table-resized">
    <colgroup>
        <col style="width:19.93%;">
        <col style="width:80.07%;">
    </colgroup>
    <thead>
        <tr>
            <th>Note</th>
            <th>Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_globalNoteMap">Note Map</a></td>
            <td><p>This note is actually opened when the&nbsp;<a class="reference-link" href="../Note%20Types/Note%20Map.md">Note Map</a>&nbsp;feature that is accessed from the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.</p><p>It is possible to create any child notes in it without any additional meaning. For example, it can be used to store a list of note maps which can be linked to from other notes or <a href="../Basic%20Concepts%20and%20Features/Navigation/Bookmarks.md">bookmarked</a>.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_sqlConsole">SQL Console History</a></td>
            <td><p>When SQL queries or commands are executed in the&nbsp;<a class="reference-link" href="Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a>, they are stored here, grouped by month. Only the query is stored and not the results.</p><p>This section can be accessed without going to the hidden tree by simply going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting Advanced → Open SQL Console History.</p><p>Notes can be added as children of this tree, but it's generally not recommended to do so to not interfere with the normal history process.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_search">Search History</a></td>
            <td><p>Whenever a search is executed from the full&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/Navigation/Search.md">Search</a>, the query will be stored here, grouped by month. Only the search parameters are stored and not the results themselves.</p><p>This section can be accessed without going to the hidden tree by simply going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting Advanced → Open Search History.</p><p>Notes can be added as children of this tree, but it's generally not recommended to do so to not interfere with the normal history process.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_bulkAction">Bulk Action</a></td>
            <td><p>This section is used for&nbsp;<a class="reference-link" href="Bulk%20Actions.md">Bulk Actions</a>. The last configuration for bulk actions will be stored as part of this note, each action in its own <code>action</code> label.</p><p>Notes can be added as children of this tree, but there won't be any benefit in doing so.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_backendLog">Backend Log</a></td>
            <td><p>This note corresponds to the backend log feature (see&nbsp;<a class="reference-link" href="../Troubleshooting/Error%20logs.md">Error logs</a>).</p><p>This item can be accessed without going to the hidden try by going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting Advanced → Show backend log.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_userHidden">User Hidden</a></td>
            <td>This section can be used by <a href="../Scripting.md">scripts</a> to create their own notes that should not be directly visible to the user. The note can be identified by scripts by its unique ID: <code>_userHidden</code></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbTplRoot">Launch Bar Templates</a></td>
            <td><p>This section contains the templates for the creation of launchers in the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>. It is not possible to create child notes here.</p><p>Theoretically some of the notes here can be customized, but there's not much benefit to be had in doing so.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_share">Shared Notes</a></td>
            <td><p>This tree lists all of the notes that are <a href="Sharing.md">shared</a> publicly. It can be useful to track down which notes are shared regardless of their position in the note tree.</p><p>This section can be accessed without going to the hidden tree simply by going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting <em>Show Shared Notes Subtree</em>.</p><p>Sub-notes cannot be created here.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbRoot">Launch Bar</a></td>
            <td><p>The tree contains both available and displayed items of the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.</p><p>This section can be accessed without going to the hidden tree by:</p><ul><li>Going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting <em>Configure Launchbar</em>.</li><li>Right-clicking an empty space on the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>&nbsp;and selecting <em>Configure Launchbar</em>.</li></ul><p>Sub-notes cannot be created here.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_options">Options</a></td>
            <td><p>This section stores the list of&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a>.</p><p>This section can be accessed without going to the hidden tree by:</p><ul><li>Going to the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Global%20menu.md">Global menu</a>&nbsp;and selecting <em>Options</em>.</li><li>Pressing the dedicated Options icon in the&nbsp;<a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Launch%20Bar.md">Launch Bar</a>.</li></ul></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_lbMobileRoot">Mobile Launch Bar</a></td>
            <td><p>This is very similar to the <em>Launch Bar</em>, but is dedicated for the mobile UI only.</p><p>Accessing it outside the <em>Launch Bar</em> is the same as the Launch Bar, but needs to be done so from the mobile interface.</p></td>
        </tr>
        <tr>
            <td><a class="reference-link" href="#root/_hidden/_help">User Guide</a></td>
            <td>This is where the note structure for the User Guide is actually stored. Only the metadata is stored, as the help itself is present as actual files in the application directory.</td>
        </tr>
    </tbody>
</table>