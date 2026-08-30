{
  description = "Trilium Notes (experimental flake)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    pnpm2nix = {
      url = "github:FliegendeWurst/pnpm2nix-nzbr/main";
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

        electronVersion = packageJsonDesktop.devDependencies.electron;
        # `or null` because a major bump lands in apps/desktop/package.json long before
        # nixpkgs has the matching electron_<major> attribute; without it the flake dies
        # with an attribute error instead of falling through to the pinned binary below.
        electronFromNixpkgs = pkgs."electron_${lib.versions.major electronVersion}" or null;

        # nixpkgs lags behind the Electron version pinned in apps/desktop/package.json
        # (electron_43 is still 43.1.0), and its source build cannot be bumped without
        # upstream's Chromium dependency hashes. Build the exact pinned version from
        # Electron's official binary release instead, reusing the nixpkgs builder.
        #
        # Don't refresh these by hand — `pnpm chore:update-flake-electron` rewrites both
        # bindings from the release's SHASUMS256.txt, and the update-nix-flake workflow
        # opens a PR whenever apps/desktop/package.json moves ahead of the pin.
        pinnedElectronVersion = "43.4.1";
        pinnedElectronHashes = {
          x86_64-linux = "79d4efd69f0ccf1fc11891ea5075329c7b3faddad79a08d9fb395bbd63169acf";
          armv7l-linux = "2875860d6b7cb2e8a0142fb87f9f7be50a382a87a24bf15a0861f20ba53dc400";
          aarch64-linux = "9e2b5cfbd387e138f06c7bb19b399bb3ee487dbb4110215df097d94e80431892";
          x86_64-darwin = "4fd0f1826660a94216a0633600a3c3e2cd87ee9e4bc6f0e1edf717ad8e30c10b";
          aarch64-darwin = "fe3cac8cbfd9ba1739fac6c69166cf30848741f93cbe251d800ae6ef7cebb64b";
          headers = "0q7l48q2l4srmkw67l1bhk3qbybnqamcr5z8yrsnbxk8aazqjshv";
        };
        mkElectronBin = pkgs.callPackage (
          pkgs.path + "/pkgs/development/tools/electron/binary/generic.nix"
        ) { };

        electron =
          if electronFromNixpkgs != null && electronFromNixpkgs.version == electronVersion then
            electronFromNixpkgs
          else
            lib.throwIf (pinnedElectronVersion != electronVersion) ''
              flake.nix pins Electron ${pinnedElectronVersion}, but apps/desktop/package.json wants ${electronVersion}.
              Refresh pinnedElectronVersion/pinnedElectronHashes in flake.nix, or drop the override if nixpkgs ships ${electronVersion}.
            '' (mkElectronBin pinnedElectronVersion pinnedElectronHashes);

        nodejs = pkgs.nodejs_24;
        # pnpm creates an overly long PATH env variable for child processes.
        # This patch deduplicates entries in PATH, which results in an equivalent but shorter entry.
        # https://github.com/pnpm/pnpm/issues/6106
        # https://github.com/pnpm/pnpm/issues/8552
        pnpm = (pkgs.pnpm_11.overrideAttrs (prev: {
          postInstall = prev.postInstall + ''
            patch $out/libexec/pnpm/dist/pnpm.mjs ${./patches/pnpm-PATH-reduction.patch}
          '';
          # pnpm sometimes fails with ERR_PNPM_ENOENT
          # https://github.com/pnpm/pnpm/issues/12880
          # "fix" from https://github.com/dniku/selfhostblocks/commit/ee6fc4f04fe34714fb8676704048d8d76aba85b7
          postFixup = (prev.postFixup or "") + (if pkgs.stdenv.hostPlatform.isLinux then ''
            mv "$out/bin/pnpm" "$out/bin/.pnpm-unwrapped"
            cat > "$out/bin/pnpm" <<EOF
            #!${stdenv.shell}
            if [ "\''${1-}" = install ]; then
              cpuMask="\$(${lib.getExe' pkgs.util-linux "taskset"} -cp "\$\$")"
              # Keep only the cpuset reported after the colon.
              cpuMask="\''${cpuMask##*: }"
              # Pick the first comma-separated segment from the cpuset.
              firstCpu="\''${cpuMask%%,*}"
              # If that segment is a range, pick its first CPU.
              firstCpu="\''${firstCpu%%-*}"
              exec ${lib.getExe' pkgs.util-linux "taskset"} -c "\$firstCpu" "$out/bin/.pnpm-unwrapped" "\$@"
            else
              exec "$out/bin/.pnpm-unwrapped" "\$@"
            fi
            EOF
            chmod +x "$out/bin/pnpm"
          '' else "");
        }));
        inherit (pkgs)
          copyDesktopItems
          darwin
          lib
          makeBinaryWrapper
          makeDesktopItem
          makeShellWrapper
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

        # Minimal source used for pnpm2nix's dependency-fetching derivation.
        # Only the files pnpm actually needs to resolve and fetch dependencies
        # are included, so unrelated source changes don't bust the deps cache.
        workspaceSourceFilter =
          name: type:
          let
            baseName = baseNameOf (toString name);
            rootStr = toString ./.;
            relPath = lib.removePrefix "${rootStr}/" (toString name);
            inPatches = relPath == "patches" || lib.hasPrefix "patches/" relPath;
          in
          (lib.cleanSourceFilter name type)
          && baseName != "node_modules"
          && (
            type == "directory"
            || baseName == "package.json"
            || baseName == "pnpm-workspace.yaml"
            || baseName == "pnpm-lock.yaml"
            || inPatches
          );
        workspaceSource = lib.cleanSourceWith {
          filter = workspaceSourceFilter;
          src = ./.;
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

            workspace = workspaceSource;
            pnpmWorkspaceYaml = ./pnpm-workspace.yaml;

            inherit nodejs pnpm;

            extraNodeModuleSources = [
              rec {
                name = "patches";
                value = ./patches;
              }
            ];

            # avoid ERR_PNPM_RESOLUTION_SHAPE_MISMATCH errors
            env.PNPM_CONFIG_TRUST_LOCKFILE = "true";

            # remove pnpm version override
            preConfigure = ''
              node -e "const p = require('./package.json'); delete p.packageManager; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n')"
            '';

            postConfigure =
              ''
                chmod +x node_modules/electron/install.js
                patchShebangs --build node_modules
              '';

            extraNativeBuildInputs =
              [
nodejs.python
                removeReferencesTo
              ]
              ++ lib.optionals (app == "desktop" || app == "edit-docs") [
                copyDesktopItems
                # required for NIXOS_OZONE_WL expansion
                # https://github.com/NixOS/nixpkgs/issues/172583
                makeShellWrapper
                wrapGAppsHook3

                # For the launcher wrapper generated in installCommands:
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

            preBuild = ''
              ${preBuildCommands}
            '';

            scriptFull = "pnpm run ${buildTask}";

            installPhase = ''
              runHook preInstall

              ${installCommands}

              runHook postInstall
            '';

            # Symlinks pointing to /build directory are not allowed in the Nix store.
            # This removes all dangling symlinks that point to the temporary build directory.
            postFixup = ''
              find $out/opt -type l -lname '/build/*' -delete || true
            '';

            components = [
              "packages/ckeditor5"
              "packages/codemirror"
              "packages/commons"
              "packages/highlightjs"
              "packages/turndown-plugin-gfm"

              "apps/build-docs"
              "apps/client"
              "apps/db-compare"
              "apps/desktop"
              "apps/dump-db"
              "apps/edit-docs"
              "apps/server"
              "packages/trilium-e2e"
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
          # better-sqlite3 v13 is N-API based and ships prebuilt binaries that
          # load unchanged under Electron, so there is no native rebuild step
          # (and no need for ELECTRON_NODEDIR) any more.
          preBuildCommands = ''
            pnpm postinstall
          '';
          buildTask = "desktop:build";
          mainProgram = "trilium";
          installCommands = ''
            mkdir -p $out/{bin,share/icons/hicolor/512x512/apps,opt/trilium}
            cp --archive apps/desktop/dist/* $out/opt/trilium
            cp apps/client/src/assets/icon.png $out/share/icons/hicolor/512x512/apps/trilium.png
            makeShellWrapper ${lib.getExe electron} $out/bin/trilium \
              "''${gappsWrapperArgs[@]}" \
              --add-flags "\''${NIXOS_OZONE_WL:+\''${WAYLAND_DISPLAY:+--ozone-platform-hint=auto --enable-features=WaylandWindowDecorations --enable-wayland-ime=true}}" \
              --set-default ELECTRON_IS_DEV 0 \
              --set TRILIUM_RESOURCE_DIR $out/opt/trilium \
              --add-flags $out/opt/trilium/main.mjs
          '';
        };

        server = makeApp {
          app = "server";
          # Important note: if pnpm throws an error similar to the follow at the end of `pnpm rebuild`,
          # you should ensure the version of tsx (and other dependencies mentioned in the error) is identical project-wide.
          # ERR_PNPM_MISSING_HOISTED_LOCATIONS
          # vite@7.1.5(@types/node@24.3.0)(jiti@2.5.1)(less@4.1.3)(lightningcss@1.30.1)
          # (sass-embedded@1.91.0)(sass@1.91.0)(terser@5.43.1)(tsx@4.20.5)(yaml@2.8.1)
          # is not found in hoistedLocations inside node_modules/.modules.yaml
          preBuildCommands = ''
            pushd apps/server
            pnpm rebuild
            popd
          '';
          buildTask = "server:build";
          mainProgram = "trilium-server";
          installCommands = ''
            # No better-sqlite3 cleanup needed here any more: the server build
            # trims deps/, src/ and build/ (which held the store paths that used
            # to need remove-references-to) out of dist itself.
            mkdir -p $out/{bin,opt/trilium-server}
            cp --archive apps/server/dist/* $out/opt/trilium-server
            makeWrapper ${lib.getExe nodejs} $out/bin/trilium-server \
              --add-flags $out/opt/trilium-server/main.mjs
          '';
        };

        edit-docs = makeApp {
          app = "edit-docs";
          preBuildCommands = ''
            pnpm postinstall
          '';
          buildTask = "edit-docs:build";
          mainProgram = "trilium-edit-docs";
          installCommands = ''
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

        # Not something to install — it is here so the pinned Electron binary can be
        # built (and therefore its hashes verified) on its own, without going through
        # a full desktop build. The update-nix-flake workflow does exactly that.
        packages.electron = electron;

        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            pnpm
            electron
            nodejs.python
            # For the browser-mode tests (packages/ckeditor5). The Chrome and chromedriver
            # webdriverio downloads for itself are dynamically linked against libraries no NixOS
            # system provides, so they die on a missing libxcb.so.1; these come from the same
            # nixpkgs revision, so their versions match.
            pkgs.chromium
            pkgs.chromedriver
          ];

          # Read by packages/ckeditor5/vitest.config.ts and by webdriverio itself, respectively.
          # Without them webdriverio downloads its own pair and the suite cannot start.
          CHROME_BIN = "${pkgs.chromium}/bin/chromium";
          CHROMEDRIVER_PATH = "${pkgs.chromedriver}/bin/chromedriver";
        };
      }
    );
}
