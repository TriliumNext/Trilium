# Troubleshooting
## Trilium only shows a blank window

Trilium uses Electron which is based on Chromium (the open-source alternative to Google Chrome); in order to improve performance it makes use of _GPU acceleration_. In some cases, a GPU incompatibility (especially on older models of integrated graphics) can cause nothing to render at all, resulting in a blank window. 

To bypass this, try running Trilium with the following command line argument:

```
trilium --disable-gpu
```

If that doesn't work, try the following commands as well:

*   `trilium --disable-gpu-compositing`
*   `ELECTRON_OZONE_PLATFORM_HINT=x11 trilium` (this one forces the rendering to X11 on Wayland)

If Trilium renders fine after this, Trilium offers a built-in option to disable GPU acceleration: go to <a class="reference-link" href="../../Basic%20Concepts%20and%20Features/UI%20Elements/Options.md">Options</a> → _Appearance_, look for the _Performance_ section and then uncheck _Hardware acceleration (GPU)_.