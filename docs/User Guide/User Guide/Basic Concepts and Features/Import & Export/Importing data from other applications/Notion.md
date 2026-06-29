# Notion
Trilium can import ZIP exports from Notion while preserving structure and formatting.

## Import process

In Notion, there are two ways to export data:

*   To export a single page (and optionally its sub-pages):
    *   Select the page to export.
    *   Press the \[…\] button at the top-right of the window and select _Export_.
    *   Ensure the following options are set:
        *   Export format: HTML
        *   Page content: Everything
        *   Include subpages: On
        *   Create folders for subpages: On
    *   Press the Export button.
    *   Wait for the download to finish.
*   To export an entire workspace, press your user name badge at top-left and select _Settings_.
    *   In the left section, look for the _Workspace_ category and select _General_.
    *   In the _General_ settings page, look for the _Export_ section and press the _Export_ button corresponding to _Workspace content_.
    *   Ensure the following options are set:
        *   Export format: HTML
        *   Page content: Everything
        *   Include subpages: On
        *   Create folders for subpages: On
    *   Press the Export button.
    *   Wait for the download to finish. Depending on the size of your workspace it might take a while. You will get a downloadable copy via email if takes too long.

In Trilium Notes:

1.  In the <a class="reference-link" href="../../UI%20Elements/Note%20Tree.md">Note Tree</a>, right click and select _Import into note_.
2.  In the _Import from_ section, select _Notion_.
3.  Upload the ZIP obtained in the previous step.

## Supported features

The following features are preserved by Trilium during the import process:

*   Basic formatting (bold, italic, underline, strikethrough, headings, colors, highlights).
*   <a class="reference-link" href="../../../Note%20Types/Text/Lists.md">Lists</a>
*   To-do lists
*   <a class="reference-link" href="../../../Note%20Types/Text/Images.md">Images</a> and <a class="reference-link" href="../../Notes/Attachments.md">Attachments</a>.
*   Toggle sections
    *   Nested toggle sections are also supported.
    *   Toggle headings are stripped of their toggle button and become normal headings instead.
*   <a class="reference-link" href="../../../Note%20Types/Text/Math%20Equations.md">Math Equations</a> (inline or block)
*   <a class="reference-link" href="../../../Note%20Types/Text/Link%20Previews.md">Link Previews</a>
*   <a class="reference-link" href="../../../Note%20Types/Text/Developer-specific%20formatting/Code%20blocks.md">Code blocks</a>, with a best-effort attempt to restore the language.
*   <a class="reference-link" href="../../../Note%20Types/Mermaid%20Diagrams.md">Mermaid Diagrams</a>
*   Links between other imported pages are converted to <a class="reference-link" href="../../../Note%20Types/Text/Links/Internal%20(reference)%20links.md">Internal (reference) links</a> if they are part of the same import.
*   Databases are imported as <a class="reference-link" href="../../../Collections.md">Collections</a> (see below).
*   [Admonitions](../../../Note%20Types/Text/Block%20quotes%20%26%20admonitions.md) are preserved, including its emoji (added as part of the content).
*   Columns are imported as transparent [tables](../../../Note%20Types/Text/Tables.md), preserving the column definition.
*   Table of content blocks are _removed_, as the table of contents is already present in the sidebar (see <a class="reference-link" href="../../../Note%20Types/Text/Table%20of%20contents.md">Table of contents</a>), as well as in shared notes.

## Databases

Notion databases are imported into <a class="reference-link" href="../../../Collections.md">Collections</a>, where each item of the database is saved as a page in the collection. Through the use of [inherited](../../../Advanced%20Usage/Attributes/Attribute%20Inheritance.md) <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a>, most of the page properties in Notion are preserved by the import.

The resulting collection will be <a class="reference-link" href="../../../Collections/Table.md">Table</a> regardless of the original view the database was exported in. That's because the active view is not saved in the export and the table collection is the most compatible with Notion.

<table><thead><tr><th scope="col">Notion type</th><th scope="col">Trilium</th></tr></thead><tbody><tr><td>Text / Select / Status / Place</td><td>Single-valued <code spellcheck="false">text</code> label</td></tr><tr><td>Number</td><td>Single-valued <code spellcheck="false">number</code> label for plain numbers. Formatted values (currency, percent, thousands separators) are normalized to a bare number, e.g. <code spellcheck="false">$1,200.50</code> → <code spellcheck="false">1200.50</code>.</td></tr><tr><td>ID</td><td>Single-valued <code spellcheck="false">number</code> or <code spellcheck="false">text</code> label (depending on whether a prefix is configured)</td></tr><tr><td>Multi-select</td><td>One text label per option (multi)</td></tr><tr><td>URL / Email / Phone</td><td><code spellcheck="false">url</code> label (<code spellcheck="false">mailto:</code>, <code spellcheck="false">tel:</code> prefix)</td></tr><tr><td>Date</td><td><ul><li data-list-item-id="eee6673ab2869e699cab68ecf33d7f114"><code spellcheck="false">datetime</code> if at least one has time.</li><li data-list-item-id="e2b9de45b9e0044bdd49f52ccbc9d143b"><code spellcheck="false">date</code> if only dates.</li><li data-list-item-id="ea59885b04bf57523709c778687bc94a5">Two attributes if any of the dates have an end date.</li></ul></td></tr><tr><td>Checkbox</td><td><code spellcheck="false">boolean</code> label (<code spellcheck="false">true</code>/<code spellcheck="false">false</code>).</td></tr><tr><td>Person</td><td>One text label per user (multi)</td></tr><tr><td>Created by / Edited by</td><td>Single-valued <code spellcheck="false">text</code> label</td></tr><tr><td>Created time / Last edited time</td><td>Assigned to the note's creation and modification date.</td></tr><tr><td>Relation</td><td>Mapped to <a href="../../../Advanced%20Usage/Attributes/Relations.md">relations</a>, each link resolved to its target note via the existing cross-page map; targets outside the import are dropped.</td></tr><tr><td>Files &amp; Media</td><td>The files are preserved as attachments, and a link to them is prepended to the content of the note for visibility.</td></tr><tr><td>Formulas / Rollup</td><td><p>A <code spellcheck="false">text</code>, <code spellcheck="false">number</code> or <code spellcheck="false">boolean</code> label depending on the value. Dates are rendered as <code spellcheck="false">text</code> because the export doesn't offer any type information.</p><p>The Notion export does not preserve the formula/rollup configuration itself, instead it just exports the value.</p></td></tr><tr><td>Button / Verification / any other type</td><td>Unsupported, they will be dropped from the import.</td></tr></tbody></table>

> [!NOTE]
> **Technical information**
> 
> Every page property that can be preserved according to the table above is saved as a label or relation to the corresponding note (except for creation and modification dates which are saved at note level).
> 
> To maintain a similar UX to Notion, every property is also turned into <a class="reference-link" href="../../../Advanced%20Usage/Attributes/Promoted%20Attributes.md">Promoted Attributes</a> at collection level. This also makes the columns visible in the table collection. The promoted attributes are made inheritable so that they appear when navigating in the child notes as well.
> 
> The names of the labels are intentionally converted to `camelCase` to match Trilium's conventions, but the full name of the column is preserved through the _Alias_ mechanism of promoted attributes.

## Limitations

### Missing data from the import

The following information is not preserved by the import because it is not available in the export so it cannot be restored:

*   The order of the pages and sub-pages.
*   Creation/modification dates are restored only when the page includes Created time / Last edited time properties (collection or not); otherwise the import time is used.

### Cover images and page icon

The page icon or emoji is not preserved, with created notes having the default icon. The cover image is not imported at all.

## Reporting issues

When importing your Notion workspace, you might find issues in how a note is imported; in that case consider [reporting](../../../Troubleshooting/Reporting%20issues.md) it.

When reporting such an issue make sure to provide the following information:

*   A .zip export of the original Notion note (and children if applicable). This allows us to reproduce the issue.
*   A screenshot with how it originally looked like before the import and how it looks after the import.