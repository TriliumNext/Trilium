# Установка на сервер
Это руководство описывает шаги по установке Trilium на собственный сервер. Вы можете рассмотреть этот вариант, если хотите настроить [синхронизацию](Synchronization.md) или использовать Trilium в браузере — доступным откуда угодно.

## Варианты установки

Есть несколько способов установить Trilium на сервер, каждый со своими преимуществами:

*   **Рекомендуется**: [Установка через Docker](Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md) — доступна для архитектур **AMD64** и **ARM**.
*   [Пакетная установка сервера](Server%20Installation/1.%20Installing%20the%20server/Packaged%20version%20for%20Linux.md)
*   [Управляемый хостинг PikaPods](https://www.pikapods.com/pods?run=trilium-next)
*   [Ручная установка](Server%20Installation/1.%20Installing%20the%20server/Manually.md)
*   [Kubernetes](Server%20Installation/1.%20Installing%20the%20server/Using%20Kubernetes.md)
*   [Cloudron](https://www.cloudron.io/store/com.github.trilium.cloudronapp.html)
*   [HomelabOS](https://homelabos.com/docs/software/trilium/)
*   [Модуль NixOS](Server%20Installation/1.%20Installing%20the%20server/On%20NixOS.md)

Установка на сервер включает и веб-, и [мобильный интерфейс](Mobile%20Frontend.md).

## Конфигурация

После настройки установки на сервере вы можете захотеть настроить параметры, такие как порт, или включить [TLS](Server%20Installation/HTTPS%20\(TLS\).md). Конфигурация управляется через файл Trilium `config.ini`, который по умолчанию находится в [каталоге данных](Data%20directory.md). Чтобы начать настраивать свою установку, скопируйте предоставленный файл `config-sample.ini` со значениями по умолчанию в `config.ini`.

Также можно рассмотреть [конфигурацию](../Advanced%20Usage/Configuration%20\(config.ini%20or%20environment%20variables\).md), чтобы задавать все значения `config.ini` вместо этого как переменные окружения.

### Расположение конфигурации

По умолчанию `config.ini`, [база данных](../Advanced%20Usage/Database.md) и другие важные файлы данных Trilium хранятся в [каталоге данных](Data%20directory.md). Если вы предпочитаете другое местоположение, можно изменить его, задав переменную окружения `TRILIUM_DATA_DIR`:

```
export TRILIUM_DATA_DIR=/home/myuser/data/my-trilium-data
```

### Отключение аутентификации

См. <a class="reference-link" href="Server%20Installation/Authentication.md">Аутентификация</a>.

## Настройка обратного прокси

Чтобы настроить обратный прокси для Trilium, можно использовать либо **nginx**, либо **Apache**. Также можно изучить документацию, хранящуюся в папке обратного прокси.

=== "nginx"

    Добавьте следующую конфигурацию в вашу настройку `nginx`, чтобы проксировать запросы в Trilium:

    ```
    location /trilium/ {
        proxy_pass http://127.0.0.1:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    ```

    Чтобы избежать ограничения размера полезной нагрузки, включите это в блок `server {}`:

    ```
    # Установите 0 для безлимита. По умолчанию 1M.
    client_max_body_size 0;
    ```

=== "Apache"

    Для настройки Apache обратитесь к руководству <a class="reference-link" href="Server%20Installation/2.%20Reverse%20proxy/Apache%20using%20Docker.md">Apache с использованием Docker</a>.
