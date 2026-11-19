# Nginx
Настройка прокси Nginx и HTTPS. В качестве операционной системы здесь используется Ubuntu.

## Установка Nginx

Установите Nginx и удалите Apache2:

```
sudo apt-get install nginx
sudo apt-get remove apache2
```

## Создание файла конфигурации

1.  Сначала создайте файл конфигурации:
    
    ```
    cd /etc/nginx/conf.d
    vim default.conf
    ```
2.  Заполните файл содержимым, показанным ниже (часть параметров необходимо изменить). После этого вы сможете пользоваться веб-интерфейсом с принудительным HTTPS и прокси.
    
    ```
    # This part configures, where your Trilium server is running
    upstream trilium {
      zone trilium 64k;
      server 127.0.0.1:8080; # change it to a different hostname and port if non-default is used
      keepalive 2;
    }
    
    # This part is for proxy and HTTPS configure
    server {
        listen 443 ssl;
        server_name trilium.example.net; #change trilium.example.net to your domain without HTTPS or HTTP.
        ssl_certificate /etc/ssl/note/example.crt; #change /etc/ssl/note/example.crt to your path of crt file.
        ssl_certificate_key /etc/ssl/note/example.net.key; #change /etc/ssl/note/example.net.key to your path of key file.
        ssl_session_cache builtin:1000 shared:SSL:10m;
        ssl_protocols TLSv1 TLSv1.1 TLSv1.2;
        ssl_ciphers HIGH:!aNULL:!eNULL:!EXPORT:!CAMELLIA:!DES:!MD5:!PSK:!RC4;
        ssl_prefer_server_ciphers on;
        access_log /var/log/nginx/access.log; #check the path of access.log, if it doesn't fit your file, change it
    
        location / {
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_pass http://trilium;
            proxy_read_timeout 90;
        }
    }
    
    # This part is for HTTPS forced
    server {
        listen 80;
        server_name trilium.example.net; # change to your domain
        return 301 https://$server_name$request_uri;
    }
    ```

## Размещение по другому пути

Если вы хотите разместить экземпляр по другому пути (например, чтобы обслуживать несколько экземпляров), обновите блок `location` следующим образом:

*   укажите нужный путь в `location` (убедитесь, что в конце нет косой черты `/`, если `proxy_pass` также не заканчивается косой чертой);
*   добавьте директиву `proxy_cookie_path` с тем же путём: это позволит оставаться авторизованным в нескольких экземплярах одновременно.

```
    location /trilium/instance-one {
        rewrite /trilium/instance-one/(.*) /$1  break;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://trilium;
        proxy_cookie_path / /trilium/instance-one
        proxy_read_timeout 90;
    }
```

## Настройка доверенного прокси

После настройки обратного прокси обязательно настройте <a class="reference-link" href="Trusted%20proxy.md">Доверенный прокси</a>.