# Themes
## Server-side

*   There are three themes embedded in the application:
    *   `light`, located in `src\public\stylesheets\theme-light.css`
    *   `dark`, located in `src\public\stylesheets\theme-dark.css`
    *   `next`, located in `src\public\stylesheets\theme-next.css`.
*   The default theme is set only once, when the database is created and is managed by `options_init#initNotSyncedOptions`.
    *   In the original implementation: On Electron, the choice between `light` and `dark` is done based on the OS preference. Otherwise, the theme is always `dark`.
    *   Now, we always choose `next` as the default theme.
*   The theme is served via `src\routes\index.ts`, in the `getThemeCssUrl` method.

## Client-side

*   The predefined themes are hard-coded in the client in `src\public\app\widgets\type_widgets\options\appearance\theme.js`.
*   The user-defined themes are obtained via a call to the server: `options/user-themes`.
*   The theme retrieval is done via a request.