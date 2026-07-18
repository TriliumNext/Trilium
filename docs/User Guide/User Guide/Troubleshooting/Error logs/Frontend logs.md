# Frontend logs
To provide frontend logs, we need to open the Developer Console. Often the easiest way is to press <kbd>Ctrl</kbd>\-<kbd>Shift</kbd>\-<kbd>I</kbd> which should work in most browsers (and desktop app). Make sure that the error producing action happened right before you copy&paste the errors, the console is cleared on app restart.

If that doesn't work, then:

*   in Trilium desktop app, go to top-left menu button -> Advanced -> Open Dev Tools
*   In Firefox/Chrome right-click anywhere in the page and click Inspect:

![](Frontend%20logs_error-logs-firefox-context-men.png)

Once you have Dev Tools open, click on "Console" tab:

![](Frontend%20logs_image.png)

Copy-paste (or screenshot) the logs. It's better to provide not just errors, but the whole log, which might provide context while analyzing the bug.