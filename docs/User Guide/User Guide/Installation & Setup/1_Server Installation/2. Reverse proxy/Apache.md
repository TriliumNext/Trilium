# Apache
I've assumed you have created a DNS A record for `trilium.yourdomain.com` that you want to use for your Trilium server.

1.  Download docker image and create container
    
    ```
     docker pull triliumnext/trilium:[VERSION]
     docker create --name trilium -t -p 127.0.0.1:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:[VERSION]
    ```
2.  Configure Apache proxy and websocket proxy
    
    1.  Enable apache proxy modules
        
        ```
         a2enmod ssl
         a2enmod proxy
         a2enmod proxy_http
         a2enmod proxy_wstunnel
        ```
    2.  Create a new let's encrypt certificate
        
        ```
         sudo certbot certonly -d trilium.mydomain.com
        ```
        
        Choose standalone (2) and note the location of the created certificates (typically /etc/letsencrypt/live/...)
    3.  Create a new virtual host file for apache (you may want to use `apachectl -S` to determine the server root location, mine is /etc/apache2)
        
        ```
         sudo nano /etc/apache2/sites-available/trilium.yourdomain.com.conf
        ```
        
        Paste (and customize) the following text into the configuration file
        
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
    4.  Enable the virtual host with `sudo a2ensite trilium.yourdomain.com.conf`
    5.  Reload apache2 with `sudo systemctl reload apache2`
3.  Create and enable a systemd service to start the docker container on boot
    
    1.  Create a new empty file called `/lib/systemd/system/trilium.service` with the contents
        
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
    2.  Install, enable and start service
        
        ```
         sudo systemctl daemon-reload
         sudo systemctl enable trilium.service
         sudo systemctl start trilium.service
        ```