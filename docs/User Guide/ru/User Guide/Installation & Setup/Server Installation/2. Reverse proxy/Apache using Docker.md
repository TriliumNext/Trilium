# Apache с использованием Docker
Это руководство предполагает, что вы создали DNS A-запись для `trilium.yourdomain.com`, которую хотите использовать для своего сервера Trilium.

## Настройка Docker

Скачайте Docker-образ и создайте контейнер:

```
 docker pull triliumnext/trilium:[VERSION]
 docker create --name trilium -t -p 127.0.0.1:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:[VERSION]
```

## Настройка прокси Apache

1.  Включите модули прокси Apache:
    
    ```
     a2enmod ssl
     a2enmod proxy
     a2enmod proxy_http
     a2enmod proxy_wstunnel
    ```
2.  Создайте новый сертификат Let's Encrypt:
    
    ```
     sudo certbot certonly -d trilium.mydomain.com
    ```
    
    Выберите standalone (2) и запомните расположение созданных сертификатов (обычно `/etc/letsencrypt/live/...`).
3.  Создайте новый файл виртуального хоста для Apache (вы можете использовать `apachectl -S`, чтобы определить корневой каталог сервера; в данном примере это `/etc/apache2`):
    
    ```
     sudo nano /etc/apache2/sites-available/trilium.yourdomain.com.conf
    ```
    
    Вставьте (и отредактируйте под свои нужды) следующий текст в файл конфигурации:
    
    ```
     
         ServerName http://trilium.yourdomain.com
         RewriteEngine on
             RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,QSA,R=permanent]
     
     
         ServerName https://trilium.yourdomain.com
         RewriteEngine On
         RewriteCond %{HTTP:Connection} Upgrade [NC]
         RewriteCond %{HTTP:Upgrade} websocket [NC]
         RewriteRule /(.*) ws://localhost:8080/$1 [P,L]
         AllowEncodedSlashes NoDecode
         ProxyPass / http://localhost:8080/ nocanon
         ProxyPassReverse / http://localhost:8080/
         SSLCertificateFile /etc/letsencrypt/live/trilium.yourdomain.com/fullchain.pem
         SSLCertificateKeyFile /etc/letsencrypt/live/trilium.yourdomain.com/privkey.pem
         Include /etc/letsencrypt/options-ssl-apache.conf
     
    ```
4.  Включите виртуальный хост с помощью `sudo a2ensite trilium.yourdomain.com.conf`.
5.  Перезагрузите apache2 с помощью `sudo systemctl reload apache2`.

## Настройка доверенного прокси

После настройки обратного прокси обязательно настройте <a class="reference-link" href="Trusted%20proxy.md">Доверенный прокси</a>.

## Настройка службы systemd для запуска сервера

Создайте и включите службу systemd для запуска Docker-контейнера при загрузке системы:

1.  Создайте новый пустой файл `/lib/systemd/system/trilium.service` со следующим содержимым:
    
    ```
     [Unit]
     Description=Trilium Server
     Requires=docker.service
     After=docker.service
    
     [Service]
     Restart=always
     ExecStart=/usr/bin/docker start -a trilium
     ExecStop=/usr/bin/docker stop -t 2 trilium
    
     [Install]
     WantedBy=local.target
    ```
2.  Установите, включите и запустите службу:
    
    ```
     sudo systemctl daemon-reload
     sudo systemctl enable trilium.service
     sudo systemctl start trilium.service
    ```