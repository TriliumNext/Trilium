# Packaged version for Linux
This is essentially Trilium sources + node modules + node.js runtime packaged into one 7z file.

## Steps

*   SSH into your server
*   use `wget` (or `curl`) to download latest `TriliumNotes-Server-[VERSION]-linux-x64.tar.xz` (copy link from [release page](https://github.com/TriliumNext/Trilium/releases), notice `-Server` suffix) on your server.
*   unpack the archive, e.g. using `tar -xf -d TriliumNotes-Server-[VERSION]-linux-x64.tar.xz`
*   `cd trilium-linux-x64-server`
*   `./trilium.sh`
*   you can open the browser and open http://\[your-server-hostname\]:8080 and you should see Trilium initialization page

The problem with above steps is that once you close the SSH connection, the Trilium process is terminated. To avoid that, you have two options:

*   Kill it (with e.g. <kbd>Ctrl</kbd> + <kbd>C</kbd>) and run again like this: `nohup ./trilium.sh &`. (nohup keeps the process running in the background, `&` runs it in the background)
*   Configure systemd to automatically run Trilium in the background on every boot

## Configure Trilium to auto-run on boot with systemd

*   After downloading, extract and move Trilium:

```
tar -xvf TriliumNotes-Server-[VERSION]-linux-x64.tar.xz
sudo mv trilium-linux-x64-server /opt/trilium
```

*   Create the service:

```
sudo nano /etc/systemd/system/trilium.service
```

*   Paste this into the file (replace the user and group as needed):

```
[Unit]
Description=Trilium Daemon
After=syslog.target network.target

[Service]
User=xxx
Group=xxx
Type=simple
ExecStart=/opt/trilium/trilium.sh
WorkingDirectory=/opt/trilium/

TimeoutStopSec=20
# KillMode=process leads to error, according to https://www.freedesktop.org/software/systemd/man/systemd.kill.html
Restart=always

[Install]
WantedBy=multi-user.target
```

*   Save the file (CTRL-S) and exit (CTRL-X)
*   Enable and launch the service:

```
sudo systemctl enable --now -q trilium
```

*   You can now open a browser to http://\[your-server-hostname\]:8080 and you should see the Trilium initialization page.

## Simple auto-update for Server

The script is available in <a class="reference-link" href="Packaged%20version%20for%20Linux/Simple%20auto-update%20for%20server.dat">Simple auto-update for server</a>.

*   Run as the same User Trilium runs.
    *   If you run as `root` please remove `sudo` from the commands.
*   Requires `jq`:
    
    ```sh
    apt install jq
    ```

It will stop the service above, overwrite everything (expecting no `config.ini`), and start service. It also creates a version file in the Trilium directory so it updates only with a newer version.

## Common issues

### Outdated glibc

```
Error: /usr/lib64/libstdc++.so.6: version `GLIBCXX_3.4.21' not found (required by /var/www/virtual/.../node_modules/@mlink/scrypt/build/Release/scrypt.node)
    at Object.Module._extensions..node (module.js:681:18)
    at Module.load (module.js:565:32)
    at tryModuleLoad (module.js:505:12)
```

If you get an error like this, you need to either upgrade your glibc (typically by upgrading to up-to-date distribution version) or use some other [server installation](../../Server%20Installation.md) method.

## TLS

Don't forget to [configure TLS](../HTTPS%20\(TLS\).md), which is required for secure usage!