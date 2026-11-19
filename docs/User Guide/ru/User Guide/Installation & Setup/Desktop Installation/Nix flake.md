# Nix flake
Начиная с TriliumNext 0.94.1, настольное и серверное приложения можно собирать с помощью [Nix](https://nixos.org/).

## Системные требования

Установленный Nix на Mac или Linux ([страница загрузки](https://nixos.org/download/)). Около 3–4 гигабайт дополнительного свободного места на диске для артефактов сборки.

## Прямой запуск

С помощью [nix run](https://nix.dev/manual/nix/stable/command-ref/new-cli/nix3-run.html) настольное приложение можно запустить так: `nix run github:TriliumNext/Trilium/v0.95.0`

Для запуска сервера необходимо явно указать нужный пакет: `nix run github:TriliumNext/Trilium/v0.95.0#server`

Вместо версии (`v0.95.0` выше) можно также указать хеш коммита (или имя ветки). Это позволяет легко тестировать сборки для разработки.

## Установка на NixOS

Добавьте в ваш `flake.nix`:

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

Добавьте в ваш `configuration.nix`:

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

Flake ориентирован на совместимость с последними стабильной и нестабильной (unstable) версиями NixOS.
