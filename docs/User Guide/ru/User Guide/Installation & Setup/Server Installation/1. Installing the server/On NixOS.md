# На NixOS
На этой странице описана настройка модуля Trilium, входящего в состав NixOS.

## Требования

Установленная [NixOS](https://nixos.org/).

## Настройка

Добавьте следующий фрагмент в ваш `configuration.nix`:

```
services.trilium-server.enable = true;

# default data directory: /var/lib/trilium
#services.trilium-server.dataDir = "/var/lib/trilium-sync-server";

# default bind address: 127.0.0.1, port 8080
#services.trilium-server.host = "0.0.0.0";
#services.trilium-server.port = 12783;
```

Раскомментируйте любые параметры, которые хотите изменить.

Дополнительные параметры (включая настройку обратного прокси nginx) см. в [списке параметров NixOS](https://search.nixos.org/options?channel=unstable&from=0&size=50&sort=relevance&type=packages&query=trilium-server).
