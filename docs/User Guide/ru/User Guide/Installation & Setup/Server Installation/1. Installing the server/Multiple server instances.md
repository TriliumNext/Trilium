# Несколько экземпляров сервера
Trilium не поддерживает многопользовательский режим. Чтобы два или более человека могли вести собственные наборы заметок, необходимо развернуть несколько экземпляров сервера. Также невозможно использовать несколько серверов [синхронизации](../../Synchronization.md).

Чтобы запустить несколько экземпляров сервера на одном физическом сервере:

*   Для <a class="reference-link" href="Packaged%20version%20for%20Linux.md">готовой сборки для Linux</a> или <a class="reference-link" href="Manually.md">ручной установки</a> при запуске сервера вручную просто укажите разные порты и каталоги данных для каждого экземпляра:
    
    ```
    TRILIUM_NETWORK_PORT=8080 TRILIUM_DATA_DIR=/path/to/your/data-dir-A /opt/trilium/trilium.sh
    ```
    
    Для второго экземпляра:
    
    ```
    TRILIUM_NETWORK_PORT=8081 TRILIUM_DATA_DIR=/path/to/your/data-dir-B /opt/trilium/trilium.sh
    ```
    
    Если вы используете `systemd`, задайте [переменные окружения в конфигурации службы](https://serverfault.com/questions/413397/how-to-set-environment-variable-in-systemd-service).
*   Для <a class="reference-link" href="Using%20Docker.md">Docker</a> просто запустите два разных контейнера, каждый со своей привязкой порта и своим каталогом данных.
*   Для <a class="reference-link" href="On%20NixOS.md">NixOS</a> единственный возможный способ — использовать OCI-контейнеры Docker или хотя бы один контейнер NixOS с собственным описанием службы.

За поддержкой или дополнительными подробностями обратитесь к соответствующему [обсуждению на GitHub](https://github.com/orgs/TriliumNext/discussions/1642#discussioncomment-12768808).
