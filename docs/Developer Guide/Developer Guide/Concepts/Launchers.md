# Launchers
Launchers are items that are displayed in the launcher bar (left side of the screen). They are of two different types:

*   Visible launchers: are displayed by default to the user, can be moved to the available launchers section to hide them.
*   Available launchers: can be manually added by the user from settings into the list of visible launchers.

## Adding a new launcher

Regardless of the type, new launchers are added at server level, inside `hidden_subtree.ts` file.

*   To add a new available launcher, look for `_lbAvailableLaunchers` and add a new item to its `children`.
*   Similarly, to add a visible launcher, look for `_lbVisibleLaunchers`.
    *   If you add a visible launcher, it will be available for both new and old users, since the application will identify that there is a new launcher to be added regardless of the user preference.