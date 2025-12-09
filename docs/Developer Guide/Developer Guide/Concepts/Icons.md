# Icons
Icons are stored in `images` and in `images/app-icons`.

## Favicon

The favicon is served dynamically via `serve-favicon`, using the icon in `images/app-icons/win/icon.ico`.

## Declarative generation of icons

All the icons are now built off of the SVGs in the `images` directory using the `bin/create-icons.sh` script.

## Main images

These are stored in `images`:

| Name | Resolution | Description |
| --- | --- | --- |
| `icon-black.svg` | 53x40 | Used by the global menu button when not hovered. |
| `icon-color.svg` | 53x40 | Used by the global menu when hovered. |
| `icon-grey.svg` | 53x40 | Used by the dark theme, in place of `icon-black.svg`. |

## App icons

<table><thead><tr><th>Name</th><th>Resolution</th><th>Description</th></tr></thead><tbody><tr><td><code>ios/apple-touch-icon.png</code></td><td>180x180</td><td>Used as <code>apple-touch-icon</code>, but only in <code>login.ejs</code> and <code>set_password.ejs</code> for some reason.</td></tr><tr><td><code>mac/icon.icns</code></td><td>512x512</td><td>Provided as <code>--icon</code> to <code>electron-packager</code> for <code>mac-arm64</code> and <code>mac-x64</code> <a href="../Building/Build%20deliveries%20locally.md">builds</a>.</td></tr><tr><td><code>png/128x128.png</code></td><td>128x128</td><td>Used in <code>linux-x64</code> <a href="../Building/Build%20deliveries%20locally.md">build</a>, to provide an <code>icon.png</code>.</td></tr><tr><td><code>png/256x256-dev.png</code></td><td>256x256</td><td>Used by the Electron window icon, if in dev mode.</td></tr><tr><td><code>png/256x256.png</code></td><td>Used by the Electron window icon, if not in dev mode.</td></tr><tr><td><code>win/icon.ico</code></td><td><ul><li>ICO 16x16</li><li>ICO 32x32</li><li>ICO 48x48</li><li>ICO 64x64</li><li>ICO 128x128</li><li>PNG 256x256</li></ul></td><td><ul><li>Used by the <code>win-x64</code> <a href="../Building/Build%20deliveries%20locally.md">build</a>.</li><li>Used by Squirrel Windows installer for: setup icon, app icon, control panel icon</li><li>Used as the favicon.</li></ul></td></tr><tr><td><code>win/setup-banner.gif</code></td><td>640x480</td><td>Used by the Squirrel Windows installer during the installation process. Has only one frame.</td></tr></tbody></table>

## Additional locations where the branding is used

*   In the client, more specifically in `src/public/app/widgets/buttons/global_menu.js`, where the SVG content of the icon is directly embedded to allow styling via CSS.
*   In the <a class="reference-link" href="Demo%20document.md">Demo document</a>, as an attachment.
*   In the <a class="reference-link" href="#root/OeKBfN6JbMIq/MF99QFRe1gVy/xkj1bqW7zJwQ/t6mT72MfEzb2">CKEditor</a> build, look for `packages/ckeditor5-build-balloon-block/src/icons/trilium.svg`. Make sure not to have any `fill` overrides in the SVG as the wrong color will be used.