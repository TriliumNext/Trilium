{
  description = "Trilium Notes (experimental flake)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    pnpm2nix = {
      url = "github:FliegendeWurst/pnpm2nix-nzbr";
      inputs = {
        flake-utils.follows = "flake-utils";
        nixpkgs.follows = "nixpkgs";
      };
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pnpm2nix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        electron = pkgs."electron_${lib.versions.major packageJsonDesktop.devDependencies.electron}";
        nodejs = pkgs.nodejs_24;
        # pnpm creates an overly long PATH env variable for child processes.
        # This patch deduplicates entries in PATH, which results in an equivalent but shorter entry.
        # https://github.com/pnpm/pnpm/issues/6106
        # https://github.com/pnpm/pnpm/issues/8552
        pnpm = (pkgs.pnpm_10.overrideAttrs (prev: {
          postInstall = prev.postInstall + ''
            patch $out/libexec/pnpm/dist/pnpm.cjs ${./patches/pnpm-PATH-reduction.patch}
          '';
        }));
        inherit (pkgs)
          copyDesktopItems
          darwin
          lib
          makeBinaryWrapper
          makeDesktopItem
          makeShellWrapper
          moreutils
          removeReferencesTo
          stdenv
          wrapGAppsHook3
          xcodebuild
          which
          ;

        fullCleanSourceFilter =
          name: type:
          (lib.cleanSourceFilter name type)
          && (
            let
              baseName = baseNameOf (toString name);
            in
            # No need to copy the flake.
            # No need to copy local copy of node_modules.
            baseName != "flake.nix" && baseName != "flake.lock" && baseName != "node_modules"
          );
        fullCleanSource =
          src:
          lib.cleanSourceWith {
            filter = fullCleanSourceFilter;
            src = src;
          };
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);
        packageJsonDesktop = builtins.fromJSON (builtins.readFile ./apps/desktop/package.json);

        makeApp =
          {
            app,
            buildTask,
            mainProgram,
            installCommands,
            preBuildCommands ? "",
          }:
          pnpm2nix.packages.${system}.mkPnpmPackage rec {
            pname = "trilium-${app}";
            version = packageJson.version + (lib.optionalString (self ? shortRev) "-${self.shortRev}");

            src = fullCleanSource ./.;
            packageJSON = ./package.json;
            pnpmLockYaml = ./pnpm-lock.yaml;

            workspace = fullCleanSource ./.;
            pnpmWorkspaceYaml = ./pnpm-workspace.yaml;

            inherit nodejs pnpm;

            extraNodeModuleSources = [
              rec {
                name = "patches";
                value = ./patches;
              }
            ];

            # remove pnpm version override
            preConfigure = ''
              cat package.json | grep -v 'packageManager' | sponge package.json
            '';

            postConfigure =
              ''
                chmod +x node_modules/electron/install.js
                patchShebangs --build node_modules
              '';

            extraNativeBuildInputs =
              [
                moreutils # sponge
                nodejs.python
                removeReferencesTo
              ]
              ++ lib.optionals (app == "desktop" || app == "edit-docs") [
                copyDesktopItems
                # required for NIXOS_OZONE_WL expansion
                # https://github.com/NixOS/nixpkgs/issues/172583
                makeShellWrapper
                wrapGAppsHook3

                # For determining the Electron version to rebuild for:
                which
                electron
              ]
              ++ lib.optionals (app == "server" || app == "build-docs") [
                makeBinaryWrapper
              ]
              ++ lib.optionals stdenv.hostPlatform.isDarwin [
                xcodebuild
                darwin.cctools
              ];
            dontWrapGApps = true;

            env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

            preBuild = ''
              ${preBuildCommands}
            '';

            scriptFull = "pnpm run ${buildTask}";

            installPhase = ''
              runHook preInstall

              ${installCommands}

              runHook postInstall
            '';

            # This file is a symlink into /build which is not allowed.
            postFixup = ''
              find $out/opt -name prebuild-install -path "*/better-sqlite3/node_modules/.bin/*" -delete || true
            '';

            components = [
              "packages/ckeditor5"
              "packages/ckeditor5-admonition"
              "packages/ckeditor5-footnotes"
              "packages/ckeditor5-keyboard-marker"
              "packages/ckeditor5-math"
              "packages/ckeditor5-mermaid"
              "packages/codemirror"
              "packages/commons"
              "packages/express-partial-content"
              "packages/highlightjs"
              "packages/turndown-plugin-gfm"

              "apps/build-docs"
              "apps/client"
              "apps/db-compare"
              "apps/desktop"
              "apps/dump-db"
              "apps/edit-docs"
              "apps/server"
              "apps/server-e2e"
            ];

            desktopItems = lib.optionals (app == "desktop") [
              (makeDesktopItem {
                name = "Trilium Notes";
                exec = meta.mainProgram;
                icon = "trilium";
                comment = meta.description;
                desktopName = "Trilium Notes";
                categories = [ "Office" ];
                startupWMClass = "Trilium Notes";
              })
            ];

            meta = {
              description = "Trilium: ${app}";
              inherit mainProgram;
            };
          };

        desktop = makeApp {
          app = "desktop";
          # pnpm throws an error at the end of `pnpm postinstall`, but it doesn't seem to matter:
          # ENOENT: no such file or directory, lstat
          # '/build/source/apps/desktop/node_modules/better-sqlite3/build/node_gyp_bins'
          preBuildCommands = ''
            export npm_config_nodedir=${electron.headers}
            pnpm postinstall
          '';
          buildTask = "desktop:build";
          mainProgram = "trilium";
          installCommands = ''
            #remove-references-to -t ${electron.headers} apps/desktop/dist/node_modules/better-sqlite3/build/config.gypi
            #remove-references-to -t ${nodejs.python} apps/desktop/dist/node_modules/better-sqlite3/build/config.gypi

            mkdir -p $out/{bin,share/icons/hicolor/512x512/apps,opt/trilium}
            cp --archive apps/desktop/dist/* $out/opt/trilium
            cp apps/client/src/assets/icon.png $out/share/icons/hicolor/512x512/apps/trilium.png
            makeShellWrapper ${lib.getExe electron} $out/bin/trilium \
              "''${gappsWrapperArgs[@]}" \
              --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
              --set-default ELECTRON_IS_DEV 0 \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium \
              --add-flags $out/opt/trilium/main.cjs
          '';
        };

        server = makeApp {
          app = "server";
          # pnpm throws an error at the end of `pnpm rebuild`, but it doesn't seem to matter:
          # ERR_PNPM_MISSING_HOISTED_LOCATIONS
          # vite@7.1.5(@types/node@24.3.0)(jiti@2.5.1)(less@4.1.3)(lightningcss@1.30.1)
          # (sass-embedded@1.91.0)(sass@1.91.0)(terser@5.43.1)(tsx@4.20.5)(yaml@2.8.1)
          # is not found in hoistedLocations inside node_modules/.modules.yaml
          preBuildCommands = ''
            pushd apps/server
            pnpm rebuild || true
            popd
          '';
          buildTask = "server:build";
          mainProgram = "trilium-server";
          installCommands = ''
            #remove-references-to -t ${nodejs.python} apps/server/dist/node_modules/better-sqlite3/build/config.gypi
            #remove-references-to -t ${pnpm} apps/server/dist/node_modules/better-sqlite3/build/config.gypi

            pushd apps/server/dist
            rm -rf node_modules/better-sqlite3/build/Release/obj \
                   node_modules/better-sqlite3/build/Release/obj.target \
                   node_modules/better-sqlite3/build/Release/sqlite3.a \
                   node_modules/better-sqlite3/build/{Makefile,better_sqlite3.target.mk,test_extension.target.mk,binding.Makefile} \
                   node_modules/better-sqlite3/deps/sqlite3
            popd

            mkdir -p $out/{bin,opt/trilium-server}
            cp --archive apps/server/dist/* $out/opt/trilium-server
            makeWrapper ${lib.getExe nodejs} $out/bin/trilium-server \
              --add-flags $out/opt/trilium-server/main.cjs
          '';
        };

        edit-docs = makeApp {
          app = "edit-docs";
          preBuildCommands = ''
            export npm_config_nodedir=${electron.headers}
            pnpm postinstall
          '';
          buildTask = "edit-docs:build";
          mainProgram = "trilium-edit-docs";
          installCommands = ''
            #remove-references-to -t ${electron.headers} apps/edit-docs/dist/node_modules/better-sqlite3/build/config.gypi
            #remove-references-to -t ${nodejs.python} apps/edit-docs/dist/node_modules/better-sqlite3/build/config.gypi

            mkdir -p $out/{bin,opt/trilium-edit-docs}
            cp --archive apps/edit-docs/dist/* $out/opt/trilium-edit-docs
            makeShellWrapper ${lib.getExe electron} $out/bin/trilium-edit-docs \
              --set-default ELECTRON_IS_DEV 0 \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium-edit-docs \
              --add-flags $out/opt/trilium-edit-docs/edit-docs.cjs
          '';
        };

        build-docs = makeApp {
          app = "build-docs";
          preBuildCommands = ''
            pushd apps/server
            pnpm rebuild || true
            popd
          '';
          buildTask = "client:build && pnpm run server:build && pnpm run --filter build-docs build";
          mainProgram = "trilium-build-docs";
          installCommands = ''
            mkdir -p $out/{bin,opt/trilium-build-docs}

            # Copy build-docs dist
            cp --archive apps/build-docs/dist/* $out/opt/trilium-build-docs

            # Copy server dist (needed for runtime)
            mkdir -p $out/opt/trilium-build-docs/server
            cp --archive apps/server/dist/* $out/opt/trilium-build-docs/server/

            # Copy client dist (needed for runtime)
            mkdir -p $out/opt/trilium-build-docs/client
            cp --archive apps/client/dist/* $out/opt/trilium-build-docs/client/

            # Copy share-theme (needed for exports)
            mkdir -p $out/opt/trilium-build-docs/packages/share-theme
            cp --archive packages/share-theme/dist/* $out/opt/trilium-build-docs/packages/share-theme/

            # Create wrapper script
            makeWrapper ${lib.getExe nodejs} $out/bin/trilium-build-docs \
              --add-flags $out/opt/trilium-build-docs/cli.cjs \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium-build-docs/server
          '';
        };

      in
      {
        packages.desktop = desktop;
        packages.server = server;
        packages.edit-docs = edit-docs;
        packages.build-docs = build-docs;

        packages.default = desktop;

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pnpm
          ];
        };
      }
    );
}
