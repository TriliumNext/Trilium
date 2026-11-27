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

## Trilium crashes on startup with a sandbox error (Linux)

Trilium runs its windows in Chromium's sandbox. Chromium builds that sandbox from unprivileged user namespaces, and falls back to a helper program, `chrome-sandbox`, when the system does not allow them. Ubuntu 23.10 and later restrict unprivileged user namespaces through AppArmor, so on these systems the fallback is what runs. The helper only works when it is owned by `root` and has the setuid bit (mode `4755`).

The `.deb` package installs `chrome-sandbox` that way, and the Flathub version uses the Flatpak sandbox instead, so both start normally. The `.zip` archive cannot: unpacking it makes the helper owned by your user, and Trilium stops right after launch with:

```
FATAL:setuid_sandbox_host.cc The SUID sandbox helper binary was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now. You need to make sure that …/chrome-sandbox is owned by root and has mode 4755.
```

To fix this, use one of the following, in order of preference:

*   Install the `.deb` package or the Flathub version (see <a class="reference-link" href="../Desktop%20Installation.md">Desktop Installation</a>) instead of the `.zip` archive.
*   Keep the `.zip` archive and set up the helper yourself:
    
    1.  Rename the unpacked folder so that its full path contains no spaces. The archive unpacks to `Trilium Notes-linux-x64`, and the setuid helper fails to start Trilium from a path with a space in it (`LaunchProcess: failed to execvp`, then `Zygote process exited prematurely`).
        
        ```sh
        mv "Trilium Notes-linux-x64" trilium-linux-x64
        ```
    2.  Make `chrome-sandbox` owned by `root` and setuid:
        
        ```sh
        cd trilium-linux-x64
        sudo chown root:root chrome-sandbox
        sudo chmod 4755 chrome-sandbox
        ```
    3.  Start Trilium with `./trilium`.
    
    Repeat these steps after unpacking a newer version.
*   Start Trilium with `./trilium --no-sandbox`.

> [!WARNING]
> `--no-sandbox` turns off Chromium's sandbox for the whole application, including the content of web pages, clipped pages and imported HTML that Trilium displays. Use it only to get Trilium running, not as a permanent setup.

### The error mentions `credentials.cc`

On some Ubuntu systems, Trilium (including the `.deb` package) stops instead with:

```
FATAL:credentials.cc Check failed: . : Permission denied (13)
```

This happens when AppArmor restricts user namespaces but does not have its `unprivileged_userns` profile loaded, for example in an Ubuntu live session. Chromium then never reaches the `chrome-sandbox` fallback. To fix this, give Trilium an AppArmor profile that allows user namespaces:

```sh
sudo tee /etc/apparmor.d/trilium > /dev/null << 'EOF'
abi <abi/4.0>,
include <tunables/global>

profile trilium /usr/lib/trilium/trilium flags=(unconfined) {
  userns,
  include if exists <local/trilium>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/trilium
```

The path `/usr/lib/trilium/trilium` is where the `.deb` package installs Trilium. For the `.zip` archive, replace it with the full path of the `trilium` executable in the unpacked folder.

To see which of the two cases applies, run `journalctl -k | grep userns_create`: `failed to find unprivileged_userns profile` means the profile above is needed, while `transitioning profile` means the `chrome-sandbox` steps are.