# Troubleshooting
While Trilium is actively maintained and stable, encountering bugs is possible.

## General Quick Fix

The first step in troubleshooting is often a restart.

If you experience an UI issue, the frontend may have entered an inconsistent state. Reload the application by pressing <kbd>Ctrl</kbd> + <kbd>R</kbd>. This will reload the frontend.

If the issue persists or appears to be a backend problem, restart the entire application. For the desktop (Electron) build, simply close and reopen the window. If you're using a Docker build, restart the container.

## Reporting Bugs

Reporting bugs is highly valuable. Here are some tips:

*   Use GitHub issues for reporting: [https://github.com/TriliumNext/Trilium/issues](https://github.com/TriliumNext/Trilium/issues)
*   Refer to the [error logs](Troubleshooting/Error%20logs.md) page for information on providing necessary details.

<details open="">
    <summary>Broken Note Crashes Trilium</summary>
    <p>Certain problems, such as rendering a note with a faulty script, can cause Trilium to crash. If Trilium attempts to reload the problematic note upon restart, it will continue to crash.</p>
    <p>To resolve this, use the <code>TRILIUM_START_NOTE_ID</code> environment variable to reset the open tabs to a single specified note ID (e.g., <code>root</code>). In Linux, you can set it as follows:</p>
    <pre><code class="language-text-x-trilium-auto">TRILIUM_START_NOTE_ID=root ./trilium</code></pre>
</details>

<details open="">
    <summary>Broken Script Prevents Application Startup</summary>
    <p>If a custom script causes Trilium to crash, and it is set as a startup script or in an active <a href="Scripting/Frontend%20Basics/Custom%20Widgets.md">custom widget</a>, start Triliumin "safe mode" to prevent any custom scripts from executing:</p>
    <pre><code class="language-text-x-trilium-auto">TRILIUM_SAFE_MODE=true ./trilium</code></pre>
    <p>Depending on your Trilium distribution, you may have pre-made scripts available: <code>trilium-safe-mode.bat</code> and <code>trilium-safe-mode.sh</code>.</p>
    <p>Once Trilium starts, locate and fix or delete the problematic note.</p>
</details>

<details open="">
    <summary>Sync and Consistency Checks</summary>
    <p>Trilium periodically verifies the logical consistency of the database (e.g., ensuring every note has a parent). If inconsistencies are detected, you will be notified via the UI.</p>
    <p>In such cases, file a bug report and attach an <a href="Troubleshooting/Anonymized%20Database.md">anonymized database</a> if necessary.</p>
</details>

<details open="">
    <summary>Restoring Backup</summary>
    <p>Trilium makes regular automatic backups. If issues become severe, you can <a href="Installation%20%26%20Setup/Backup.md">restore from a backup</a>.</p>
</details>

<details open="">
    <summary>Forgotten Password</summary>
    <p>See&nbsp;<a class="reference-link" href="Installation%20%26%20Setup/Server%20Installation/Authentication/Resetting%20your%20password.md">Resetting your password</a>.</p>
</details>