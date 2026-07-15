# Security
Starting with v0.104.0, some features in Trilium are intentionally disabled in order to reduce the attack surface:

*   <a class="reference-link" href="Backend%20scripts.md">Backend scripts</a>, which can run processes on the server, access the file system or bypass security measures.
*   <a class="reference-link" href="../Advanced%20Usage/Database/Manually%20altering%20the%20database/SQL%20Console.md">SQL Console</a>, which can be used to exfiltrate important data such as the document secret or cause irreparable damage to the database.

To activate either one of them, there are three variants:

*   For the desktop app, go to <a class="reference-link" href="../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Security_ and toggle the desired option.
    *   This will prompt a system dialog confirming the change. Note that scripts could potentially call this confirmation dialog as well, make sure to accept it only if enabling any of these features is required.
    *   The settings page will be available for the server-side as well, but the options need to be manually toggled using the other mechanisms described here.
    *   This works by setting a separate configuration file in the <a class="reference-link" href="../Installation%20%26%20Setup/Data%20directory.md">Data directory</a>.
*   In [config.ini](../Advanced%20Usage/Configuration%20\(config.ini%20or%20environment%20variables\).md), set the corresponding option under the `Security` group.
*   Or use environment variables (e.g. `TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true`).