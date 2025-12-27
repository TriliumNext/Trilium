# Nginx
Configure Nginx proxy and HTTPS. The operating system here is Ubuntu 18.04.

1.  Download Nginx and remove Apache2
    
    ```
    sudo apt-get install nginx
    sudo apt-get remove apache2
    ```
2.  Create configure file
    
    ```
    cd /etc/nginx/conf.d
    vim default.conf
    ```
3.  Fill the file with the context shown below, part of the setting show be changed. Then you can enjoy your web with HTTPS forced and proxy.
    
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
4.  Alternatively if you want to serve the instance under a different path (useful e.g. if you want to serve multiple instances), update the location block like so:
    
    *   update the location with your desired path (make sure to not leave a trailing slash "/", if your `proxy_pass` does not end on a slash as well)
    *   add the `proxy_cookie_path` directive with the same path: this allows you to stay logged in at multiple instances at the same time.
    
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