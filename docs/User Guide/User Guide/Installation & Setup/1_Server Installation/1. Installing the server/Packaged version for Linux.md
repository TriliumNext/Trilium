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

## Simple Autoupdate for Server

Run as the same User Trilium runs

if you run as root please remove 'sudo' from the commands

requires "jq" `apt install jq`

It will stop the service above, overwrite everything (i expect no config.ini), and start service It also creates a version file in the Trilium directory so it updates only with a newer Version

```
#!/bin/bash

# Configuration
REPO="TriliumNext/Trilium"
PATTERN="TriliumNotes-Server-.*-linux-x64.tar.xz"
DOWNLOAD_DIR="/var/tmp/trilium_download"
OUTPUT_DIR="/opt/trilium"
SERVICE_NAME="trilium"
VERSION_FILE="$OUTPUT_DIR/version.txt"

# Ensure dependencies are installed
command -v curl >/dev/null 2>&1 || { echo "Error: curl is required"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required"; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "Error: tar is required"; exit 1; }

# Create download directory
mkdir -p "$DOWNLOAD_DIR" || { echo "Error: Cannot create $DOWNLOAD_DIR"; exit 1; }

# Get the latest release version
LATEST_VERSION=$(curl -sL https://api.github.com/repos/$REPO/releases/latest | jq -r '.tag_name')
if [ -z "$LATEST_VERSION" ]; then
  echo "Error: Could not fetch latest release version"
  exit 1
fi

# Check current installed version (from version.txt or existing tarball)
CURRENT_VERSION=""
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(cat "$VERSION_FILE")
elif [ -f "$DOWNLOAD_DIR/TriliumNotes-Server-$LATEST_VERSION-linux-x64.tar.xz" ]; then
  CURRENT_VERSION="$LATEST_VERSION"
fi

# Compare versions
if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "Latest version ($LATEST_VERSION) is already installed"
  exit 0
fi

# Download the latest release
LATEST_URL=$(curl -sL https://api.github.com/repos/$REPO/releases/latest | jq -r ".assets[] | select(.name | test(\"$PATTERN\")) | .browser_download_url")
if [ -z "$LATEST_URL" ]; then
  echo "Error: No asset found matching pattern '$PATTERN'"
  exit 1
fi

FILE_NAME=$(basename "$LATEST_URL")
FILE_PATH="$DOWNLOAD_DIR/$FILE_NAME"

# Download if not already present
if [ -f "$FILE_PATH" ]; then
  echo "Latest release $FILE_NAME already downloaded"
else
  curl -LO --output-dir "$DOWNLOAD_DIR" "$LATEST_URL" || { echo "Error: Download failed"; exit 1; }
  echo "Downloaded $FILE_NAME to $DOWNLOAD_DIR"
fi

# Extract the tarball
EXTRACT_DIR="$DOWNLOAD_DIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xJf "$FILE_PATH" -C "$EXTRACT_DIR" || { echo "Error: Extraction failed"; exit 1; }

# Find the extracted directory (e.g., TriliumNotes-Server-0.97.2-linux-x64)
INNER_DIR=$(find "$EXTRACT_DIR" -maxdepth 1 -type d -name "TriliumNotes-Server-*-linux-x64" | head -n 1)
if [ -z "$INNER_DIR" ]; then
  echo "Error: Could not find extracted directory matching TriliumNotes-Server-*-linux-x64"
  exit 1
fi

# Stop the trilium-server service
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "Stopping $SERVICE_NAME service..."
  sudo systemctl stop "$SERVICE_NAME" || { echo "Error: Failed to stop $SERVICE_NAME"; exit 1; }
fi

# Copy contents to /opt/trilium, overwriting existing files
echo "Copying contents from $INNER_DIR to $OUTPUT_DIR..."
sudo mkdir -p "$OUTPUT_DIR"
sudo cp -r "$INNER_DIR"/* "$OUTPUT_DIR"/ || { echo "Error: Copy failed"; exit 1; }
echo "$LATEST_VERSION" | sudo tee "$VERSION_FILE" >/dev/null
echo "Files copied to $OUTPUT_DIR"

# Start the trilium-server service
echo "Starting $SERVICE_NAME service..."
sudo systemctl start "$SERVICE_NAME" || { echo "Error: Failed to start $SERVICE_NAME"; exit 1; }

# Clean up
rm -rf "$EXTRACT_DIR"
echo "Cleanup complete. Trilium updated to $LATEST_VERSION."
```

## Common issues

### Outdated glibc

```
Error: /usr/lib64/libstdc++.so.6: version `GLIBCXX_3.4.21' not found (required by /var/www/virtual/.../node_modules/@mlink/scrypt/build/Release/scrypt.node)
    at Object.Module._extensions..node (module.js:681:18)
    at Module.load (module.js:565:32)
    at tryModuleLoad (module.js:505:12)
```

If you get an error like this, you need to either upgrade your glibc (typically by upgrading to up-to-date distribution version) or use some other [server installation](../../1_Server%20Installation.md) method.

## TLS

Don't forget to [configure TLS](../TLS%20Configuration.md), which is required for secure usage!