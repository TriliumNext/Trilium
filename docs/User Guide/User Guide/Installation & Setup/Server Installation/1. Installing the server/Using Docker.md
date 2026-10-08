# Using Docker
Official docker images are published on docker hub for **AMD64**, **ARMv7** and **ARM64/v8**: [https://hub.docker.com/r/triliumnext/trilium/](https://hub.docker.com/r/triliumnext/trilium/)

## Prerequisites

Ensure Docker is installed on your system.

If you need help installing Docker, reference the [Docker Installation Docs](https://docs.docker.com/engine/install/)

By default, the container starts as root, prepares the data directory and then runs Trilium as an unprivileged user. It can also run entirely without root, as described in _Running as a non-root user_ below.

> [!WARNING]
> If you're using a SMB/CIFS share or folder as your Trilium data directory, [you'll need](https://github.com/TriliumNext/Notes/issues/415#issuecomment-2344824400) to add the mount options of `nobrl` and `noperm` when mounting your SMB share.

## Running with Docker Compose

### Grab the latest docker-compose.yml:

```
wget https://raw.githubusercontent.com/TriliumNext/Trilium/master/docker-compose.yml
```

Optionally, edit the `docker-compose.yml` file to configure the container settings prior to starting it. Unless configured otherwise, the data directory will be `trilium-data` next to `docker-compose.yml` and the container will be accessible at port 8080.

To keep the data somewhere else, edit the `volumes` entry in `docker-compose.yml` and change the host path before the colon (for example `- /srv/trilium-data:/home/node/trilium-data`). Leave the path after the colon unchanged.

### Start the container:

Run the following command to start the container in the background:

```
docker compose up -d
```

## Running without Docker Compose / Further Configuration

### Pulling the Docker Image

To pull the image, use the following command, replacing `[VERSION]` with the desired version or tag, such as `v0.91.6` or just `latest`. (See published tag names at [https://hub.docker.com/r/triliumnext/trilium/tags](https://hub.docker.com/r/triliumnext/trilium/tags).):

```
docker pull triliumnext/trilium:v0.91.6
```

**Warning:** Avoid using the "latest" tag, as it may automatically upgrade your instance to a new minor version, potentially disrupting sync setups or causing other issues.

### Preparing the Data Directory

Trilium requires a directory on the host system to store its data. This directory must be mounted into the Docker container with write permissions.

### Running the Docker Container

=== "Local Access Only"

    Run the container to make it accessible only from the localhost. This setup is suitable for testing or when using a proxy server like Nginx or Apache.

    ```sh
    sudo docker run -t -i -p 127.0.0.1:8080:8080 \
    	-v ~/trilium-data:/home/node/trilium-data \
    	triliumnext/trilium:[VERSION]
    ```

    1.  Verify the container is running using `docker ps`.
    2.  Access Trilium via a web browser at `127.0.0.1:8080`.

=== "Local Network Access"

    To make the container accessible only on your local network, first create a new Docker network:

    ```sh
    docker network create -d macvlan -o parent=eth0 --subnet 192.168.2.0/24 --gateway 192.168.2.254 --ip-range 192.168.2.252/27 mynet
    ```

    Then, run the container with the network settings:

    ```sh
    docker run --net=mynet -d -p 127.0.0.1:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:-latest
    ```

    To set a different user ID (UID) and group ID (GID) for the saved data, use the `USER_UID` and `USER_GID` environment variables:

    ```sh
    docker run --net=mynet -d -p 127.0.0.1:8080:8080 -e "USER_UID=1001" -e "USER_GID=1001" -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:-latest
    ```

    Find the local IP address using `docker inspect [container_name]` and access the service from devices on the local network.

    ```sh
    docker ps
    docker inspect [container_name]
    ```

=== "Global Access"

    To allow access from any IP address, run the container as follows:

    ```sh
    docker run -d -p 0.0.0.0:8080:8080 \
    	-v ~/trilium-data:/home/node/trilium-data \
    	triliumnext/trilium:[VERSION]
    ```

    Stop the container with `docker stop <CONTAINER ID>`, where the container ID is obtained from `docker ps`.

### Custom Data Directory

For a custom data directory, use:

```
-v ~/YourOwnDirectory:/home/node/trilium-data triliumnext/trilium:[VERSION]
```

If you want to run your instance in a non-default way, please use the volume switch as follows: `-v ~/YourOwnDirectory:/home/node/trilium-data triliumnext/trilium:<VERSION>`. It is important to be aware of how Docker works for volumes, with the first path being your own and the second the one to virtually bind to. [https://docs.docker.com/storage/volumes/](https://docs.docker.com/storage/volumes/) The path before the colon is the host directory, and the path after the colon is the container's path. More details can be found in the [Docker Volumes Documentation](https://docs.docker.com/storage/volumes/).

## Reverse Proxy

1.  [Nginx](../2.%20Reverse%20proxy/Nginx.md)
2.  [Apache](../2.%20Reverse%20proxy/Apache%20using%20Docker.md)

### Note on timezones

If you are having timezone issues and you are not using docker-compose, you may need to add a `TZ` environment variable with the [TZ identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) of your local timezone.

### Other environment variables

For the complete list of environment variables Trilium reads (network settings, authentication, sync, etc.), see <a class="reference-link" href="../../../Advanced%20Usage/Configuration%20(config.ini%20or%20environment%20variables).md">Configuration (config.ini or environment variables)</a>.

## Running as a non-root user

By default, the container starts as root, gives the data directory to the `node` user (UID and GID `1000`, or the values of `USER_UID` and `USER_GID`) and then runs Trilium as that user. Some environments do not allow a container to start as root at all, for example rootless Docker or Podman, or Kubernetes with `runAsNonRoot`. Starting with v0.107.0, the same image can run entirely as a non-root user instead.

To run Trilium as a non-root user, set the user with Docker's `--user` flag:

```sh
docker run -d -p 8080:8080 --user 1000:1000 -v /srv/trilium-data:/home/node/trilium-data triliumnext/trilium:[VERSION]
```

With Docker Compose, add `user:` to the service in `docker-compose.yml`:

```yaml
services:
  trilium:
    user: "1000:1000"
```

The image also runs with a read-only root filesystem and without any capabilities, for example with `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`.

Without root, the container cannot change the ownership of files, so:

*   The data directory on the host must exist and belong to that user before the container starts. If the directory is missing, Docker creates it as root, and Trilium cannot write to it. For example:
    
    ```sh
    mkdir -p /srv/trilium-data
    sudo chown 1000:1000 /srv/trilium-data
    ```
*   A named volume instead of a host directory only works for UID `1000`: Docker gives a new volume the owner of the image's data directory, which is the `node` user.
*   `USER_UID` and `USER_GID` are ignored. The user comes from `--user` or `user:` alone.

If Trilium cannot use its data directory, it stops at startup and prints which directory or files it cannot use, who owns them, and the command that fixes it.

> [!NOTE]
> An installation that ran as root leaves its files owned by UID `1000`, or by `USER_UID` if it was set. To switch it to `--user`, either use that same UID, or give the data directory to the new user first, for example with `sudo chown -R 1001:1001 /srv/trilium-data`.