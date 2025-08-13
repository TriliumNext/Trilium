# Download latest nightly and install it
On Ubuntu:

```
#!/usr/bin/env bash

name=TriliumNotes-linux-x64-nightly.deb
rm -f $name*
wget https://github.com/TriliumNext/Trilium/releases/download/nightly/$name
sudo apt-get install ./$name
rm $name
```