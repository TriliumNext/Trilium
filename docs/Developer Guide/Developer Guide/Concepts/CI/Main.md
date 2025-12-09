# Main
The main workflow of the CI:

*   Builds the Docker image and publishes in the GitHub Docker registry.
*   Builds using a portion of the [delivery script](../../Building/Build%20deliveries%20locally.md) artifacts for the following platforms:
    *   Windows `x86_64` as .zip file
    *   Windows `x86_64` installer (using Squirrel)
    *   macOS `x86_64` and `aarch64`.
    *   Linux `x86_64`
    *   Linux server `x86_64`.

The main workflow of the CI runs on `develop` branches as well as any branch that starts with `feature/update_`.

## Downloading the artifacts from the main branch

Simply go to the [`develop` branch on GitHub](https://github.com/TriliumNext/Trilium) and look at the commit bar:

<figure class="image"><img src="Main_image.png"></figure>

Press the green checkmark (or red cross if something went bad). Then look at the list of jobs and their status:

<figure class="image"><img src="1_Main_image.png"></figure>

Then look for any of the entires that starts with “Main” and press the “Details” link next to it. It doesn't really matter which platform you'll choose as the artifacts are available on the same page.