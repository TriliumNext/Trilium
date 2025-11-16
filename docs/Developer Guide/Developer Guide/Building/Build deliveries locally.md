# Build deliveries locally
## Building the desktop

Go to `apps/desktop`, and:

*   To generate the packages, run `pnpm electron-forge:make`.
*   To only build the Flatpak, run `pnpm electron-forge:make-flatpak`.
*   To only build without packaging it, run `pnpm electron-forge:package`.

## Building the server

Go to `apps/server` and run `pnpm package` to run the build script. The built artifacts will appear in `apps/server/dist`, whereas the packaged build will be available in `apps/server/out`.

## On NixOS

Under NixOS the following `nix-shell` is needed:

```
nix-shell -p jq
```

For Linux builds:

```
nix-shell -p jq fakeroot dpkg
```

To test the Linux builds, use `steam-run`:

```javascript
$ NIXPKGS_ALLOW_UNFREE=1 nix-shell -p steam-run
[nix-shell] cd dist/trilium-linux-x64
[nix-shell] steam-run ./trilium
```