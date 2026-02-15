# Active content
_Active content_ is a generic name for powerful features in Trilium, these range from customizing the UI to advanced scripting that can alter your notes or even your PC.

## Safe import

Active content problem of safety, especially when this active content comes from a third-party such as if it is downloaded from a website and then imported into Trilium.

When [importing](Import%20%26%20Export.md) .zip archives into Trilium, _safe mode_ is active by default which will try to prevent untrusted code from executing. For example, a [custom widget](../Scripting/Frontend%20Basics/Custom%20Widgets.md) needs the `#widget` [label](../Advanced%20Usage/Attributes/Labels.md) in order to function; safe import works by renaming that label to `#disabled:widget`.

## Safe mode

Sometimes active content can cause issues with the UI or the server, preventing it from functioning properly. <a class="reference-link" href="../Advanced%20Usage/Safe%20mode.md">Safe mode</a> allows starting Trilium in such a way that active content is not loaded by default at start-up, allowing the user to fix the problematic scripts or widgets.

## Types of active content

These are the types of active content in Trilium, along with a few examples of what untrusted content of that type could cause:

| Name | Disabled on a safe [import](Import%20%26%20Export.md) | Description | Potential risks of untrusted code |
| --- | --- | --- | --- |
| [Front-end scripts](../Scripting/Frontend%20Basics.md) | Yes | Allow running arbitrary code on the client (UI) of Trilium, which can alter the user interface. | A malicious script can execute server-side code, access un-encrypted notes or change their contents. |
| <a class="reference-link" href="../Scripting/Frontend%20Basics/Custom%20Widgets.md">Custom Widgets</a> | Yes | Can add new UI features to Trilium, for example by adding a new section in the <a class="reference-link" href="UI%20Elements/Right%20Sidebar.md">Right Sidebar</a>. | The UI can be altered in such a way that it can be used to extract sensitive information or it can simply cause the application to crash. |
| <a class="reference-link" href="../Scripting/Backend%20scripts.md">Backend scripts</a> | Yes | Can run custom code on the server of Trilium (Node.js environment), with full access to the notes and the database. | Has access to all the unencrypted notes, but with full access to the database it can completely destroy the data. It also has access to execute other applications or alter the files and folders on the server). |
| <a class="reference-link" href="../Note%20Types/Web%20View.md">Web View</a> | Yes | Displays a website inside a note. | Can point to a phishing website which can collect the data (for example on a log in page). |
| <a class="reference-link" href="../Note%20Types/Render%20Note.md">Render Note</a> | Yes | Renders custom content inside a note, such as a dashboard or a new editor that is not officially supported by Trilium. | Can affect the UI similar to front-end scripts or custom widgets since the scripts are not completely encapsulated, or they can act similar to a web view where they can collect data entered by the user. |
| <a class="reference-link" href="../Theme%20development/Custom%20app-wide%20CSS.md">Custom app-wide CSS</a> | No  | Can alter the layout and style of the UI using CSS, applied regardless of theme. | Generally less problematic than the rest of active content, but a badly written CSS can affect the layout of the application, requiring the use of <a class="reference-link" href="../Advanced%20Usage/Safe%20mode.md">Safe mode</a> to be able to use the application. |
| [Custom themes](../Theme%20development) | No  | Can change the style of the entire UI. | Similar to custom app-wide CSS. |
| <a class="reference-link" href="Themes/Icon%20Packs.md">Icon Packs</a> | No  | Introduces new icons that can be used for notes. | Generally are more contained and less prone to cause issues, but they can cause performance issues (for example if the icon pack has millions of icons in it). |

## Active content badge

Starting with v0.102.0, on the <a class="reference-link" href="UI%20Elements/New%20Layout.md">New Layout</a> a badge will be displayed near the note title, indicating that an active content is detected. Clicking the badge will reveal a menu with various options related to that content type, for example to open the documentation or to configure the execution of scripts.

For some active content types, such as backend scripts with custom triggering conditions a toggle button will appear. This makes it possible to easily disable scripts or widgets, but also to re-enable them if an import was made with safe mode active.