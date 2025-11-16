# Nix flake
Since TriliumNext 0.94.1, the desktop and server applications can be built using [Nix](https://nixos.org/).

## System requirements

Installation of Nix on Mac or Linux ([download page](https://nixos.org/download/)). About 3-4 gigabytes of additional storage space, for build artifacts.

## Run directly

Using [nix run](https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-run.html), the desktop app can be started as: `nix run github:TriliumNext/Trilium/v0.95.0`

Running the server requires explicitly specifying the desired package: `nix run github:TriliumNext/Trilium/v0.95.0#server`

Instead of a version (`v0.95.0` above), you can also specify a commit hash (or a branch name). This makes it easy to test development builds.

## Install on NixOS

Add to your `flake.nix`:

```
{
  inputs = {
    nixpkgs.url = # ...;
    trilium-notes = {
      url = "github:TriliumNext/Trilium/v0.95.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      # ...
      trilium-notes,
      ...
    }:
    {
      nixosConfigurations = {
        "nixos" = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          modules = [
            ./configuration.nix
          ];
          specialArgs = {
            inherit
              trilium-notes
              ;
          };
        };
      };
    };
}

```

Add to your `configuration.nix`:

```
{
  # ...
  trilium-notes,
  ...
}:

{
  # ...

  services.trilium-server.package = trilium-notes.packages.x86_64-linux.server;

  environment.systemPackages = [
    trilium-notes.packages.x86_64-linux.desktop
  ];
}
```

The flake aims to be compatible with the latest NixOS stable and unstable.