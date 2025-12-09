# Using Docker
Official docker images are published on docker hub for **AMD64**, **ARMv7** and **ARM64/v8**: [https://hub.docker.com/r/triliumnext/trilium/](https://hub.docker.com/r/triliumnext/trilium/)

## Prerequisites

Ensure Docker is installed on your system.

If you need help installing Docker, reference the [Docker Installation Docs](https://docs.docker.com/engine/install/)

**Note:** Trilium's Docker container requires root privileges to operate correctly.

> [!WARNING]
> If you're using a SMB/CIFS share or folder as your Trilium data directory, [you'll need](https://github.com/TriliumNext/Notes/issues/415#issuecomment-2344824400) to add the mount options of `nobrl` and `noperm` when mounting your SMB share.

## Running with Docker Compose

### Grab the latest docker-compose.yml:

```
wget https://raw.githubusercontent.com/TriliumNext/Trilium/master/docker-compose.yml
```

Optionally, edit the `docker-compose.yml` file to configure the container settings prior to starting it. Unless configured otherwise, the data directory will be `~/trilium-data` and the container will be accessible at port 8080.

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

#### Local Access Only

Run the container to make it accessible only from the localhost. This setup is suitable for testing or when using a proxy server like Nginx or Apache.

```
sudo docker run -t -i -p 127.0.0.1:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:[VERSION]
```

1.  Verify the container is running using `docker ps`.
2.  Access Trilium via a web browser at `127.0.0.1:8080`.

#### Local Network Access

To make the container accessible only on your local network, first create a new Docker network:

```
docker network create -d macvlan -o parent=eth0 --subnet 192.168.2.0/24 --gateway 192.168.2.254 --ip-range 192.168.2.252/27 mynet
```

Then, run the container with the network settings:

```
docker run --net=mynet -d -p 127.0.0.1:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:-latest
```

To set a different user ID (UID) and group ID (GID) for the saved data, use the `USER_UID` and `USER_GID` environment variables:

```
docker run --net=mynet -d -p 127.0.0.1:8080:8080 -e "USER_UID=1001" -e "USER_GID=1001" -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:-latest
```

Find the local IP address using `docker inspect [container_name]` and access the service from devices on the local network.

```
docker ps
docker inspect [container_name]
```

#### Global Access

To allow access from any IP address, run the container as follows:

```
docker run -d -p 0.0.0.0:8080:8080 -v ~/trilium-data:/home/node/trilium-data triliumnext/trilium:[VERSION]
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

### Note on --user Directive

The `--user` directive is unsupported. Instead, use the `USER_UID` and `USER_GID` environment variables to set the appropriate user and group IDs.

### Note on timezones

If you are having timezone issues and you are not using docker-compose, you may need to add a `TZ` environment variable with the [TZ identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) of your local timezone.

## Rootless Docker Image

> [!NOTE]
> Please keep in mind that the data directory is at `/home/trilium/trilium-data` instead of the typical `/home/node/trilium-data`. This is because a new user is created and used to run Trilium within the rootless containers.

If you would prefer to run Trilium without having to run the Docker container as `root`, you can use either of the provided Debian (default) and Alpine-based images with the `rootless` tag. 

_**If you're unsure, stick to the “rootful” Docker image referenced above.**_

Below are some commands to pull the rootless images:

```
# For Debian-based image
docker pull triliumnext/trilium:rootless

# For Alpine-based image
docker pull triliumnext/trilium:rootless-alpine
```

### Why Rootless?

Running containers as non-root is a security best practice that reduces the potential impact of container breakouts. If an attacker manages to escape the container, they'll only have the permissions of the non-root user instead of full root access to the host.

### How It Works

The rootless Trilium image:

1.  Creates a non-root user (`trilium`) during build time
2.  Configures the application to run as this non-root user
3.  Allows runtime customization of the user's UID/GID via Docker's `--user` flag
4.  Does not require a separate Docker `entrypoint` script

### Usage

#### **Using docker-compose (Recommended)**

```
# Run with default UID/GID (1000:1000)
docker-compose -f docker-compose.rootless.yml up -d

# Run with custom UID/GID (e.g., match your host user)
TRILIUM_UID=$(id -u) TRILIUM_GID=$(id -g) docker-compose -f docker-compose.rootless.yml up -d

# Specify a custom data directory
TRILIUM_DATA_DIR=/path/to/your/data TRILIUM_UID=$(id -u) TRILIUM_GID=$(id -g) docker-compose -f docker-compose.rootless.yml up -d

```

#### **Using Docker CLI**

```
# Build the image
docker build -t triliumnext/trilium:rootless -f apps/server/Dockerfile.rootless .

# Run with default UID/GID (1000:1000)
docker run -d --name trilium -p 8080:8080 -v ~/trilium-data:/home/trilium/trilium-data triliumnext/trilium:rootless

# Run with custom UID/GID
docker run -d --name trilium -p 8080:8080 --user $(id -u):$(id -g) -v ~/trilium-data:/home/trilium/trilium-data triliumnext/trilium:rootless

```

### Environment Variables

*   `TRILIUM_UID`: UID to use for the container process (passed to Docker's `--user` flag)
*   `TRILIUM_GID`: GID to use for the container process (passed to Docker's `--user` flag)
*   `TRILIUM_DATA_DIR`: Path to the data directory inside the container (default: `/home/node/trilium-data`)

For a complete list of configuration environment variables (network settings, authentication, sync, etc.), see <a class="reference-link" href="../../../Advanced%20Usage/Configuration%20(config.ini%20or%20e.md">Configuration (config.ini or environment variables)</a>.

### Volume Permissions

If you encounter permission issues with the data volume, ensure that:

1.  The host directory has appropriate permissions for the UID/GID you're using
2.  You're setting both `TRILIUM_UID` and `TRILIUM_GID` to match the owner of the host directory

```
# For example, if your data directory is owned by UID 1001 and GID 1001:
TRILIUM_UID=1001 TRILIUM_GID=1001 docker-compose -f docker-compose.rootless.yml up -d

```

### Considerations

*   The container starts with a specific UID/GID which can be customized at runtime
*   Unlike the traditional setup, this approach does not use a separate entrypoint script with `usermod`/`groupmod` commands
*   The container cannot modify its own UID/GID at runtime, which is a security feature of rootless containers

### Available Rootless Images

Two rootless variants are provided:

1.  **Debian-based** (default): Uses the Debian Bullseye Slim base image
    *   Dockerfile: `apps/server/Dockerfile.rootless`
    *   Recommended for most users
2.  **Alpine-based**: Uses the Alpine base image for smaller size
    *   Dockerfile: `apps/server/Dockerfile.alpine.rootless`
    *   Smaller image size, but may have compatibility issues with some systems

### Building Custom Rootless Images

If you would prefer, you can also customize the UID/GID at build time:

```
# For Debian-based image with custom UID/GID
docker build --build-arg USER=myuser --build-arg UID=1001 --build-arg GID=1001 \
  -t triliumnext/trilium:rootless-custom -f apps/server/Dockerfile.rootless .

# For Alpine-based image with custom UID/GID
docker build --build-arg USER=myuser --build-arg UID=1001 --build-arg GID=1001 \
  -t triliumnext/trilium:alpine-rootless-custom -f apps/server/Dockerfile.alpine.rootless .

```

Available build arguments:

*   `USER`: Username for the non-root user (default: trilium)
*   `UID`: User ID for the non-root user (default: 1000)
*   `GID`: Group ID for the non-root user (default: 1000)