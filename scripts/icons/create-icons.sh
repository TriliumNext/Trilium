#!/usr/bin/env bash

set -e

if ! command -v magick &> /dev/null; then
  echo "This tool requires ImageMagick to be installed in order to create the icons."
  exit 1
fi

if ! command -v inkscape &> /dev/null; then
  echo "This tool requires Inkscape to be render sharper SVGs than ImageMagick."
  exit 1
fi

if ! command -v icnsutil &> /dev/null; then
  echo "This tool requires icnsutil to be installed in order to generate macOS icons."
  exit 1
fi

script_dir=$(realpath $(dirname $0))
source_icon_dir="$script_dir/../../apps/server/src/assets/images"
desktop_forge_dir="$script_dir/../../apps/desktop/electron-forge"
cd "$desktop_forge_dir/app-icon"
inkscape -w 180 -h 180 "$source_icon_dir/icon-color.svg" -o "./ios/apple-touch-icon.png"

# Build PNGs
inkscape -w 128 -h 128 "$source_icon_dir/icon-color.svg" -o "./png/128x128.png"
inkscape -w 256 -h 256 "$source_icon_dir/icon-color.svg" -o "./png/256x256.png"

# Build dev icons (including tray)
inkscape -w 16 -h 16 "$source_icon_dir/icon-purple.svg" -o "./png/16x16-dev.png"
inkscape -w 32 -h 32 "$source_icon_dir/icon-purple.svg" -o "./png/32x32-dev.png"
inkscape -w 128 -h 128 "$source_icon_dir/icon-purple.svg" -o "./png/128x128-dev.png"
inkscape -w 256 -h 256 "$source_icon_dir/icon-purple.svg" -o "./png/256x256-dev.png"

# Build Mac default .icns
declare -a sizes=("16" "32" "512" "1024")
for size in "${sizes[@]}"; do
  inkscape -w $size -h $size "$source_icon_dir/icon-color.svg" -o "./png/${size}x${size}.png"
done

rm -r mac/*
mkdir -p fakeapp.app
npx iconsur set fakeapp.app -l -i "png/1024x1024.png" -o "mac/1024x1024.png" -s 0.8
declare -a sizes=("16x16" "32x32" "128x128" "512x512")
for size in "${sizes[@]}"; do
  magick "mac/1024x1024.png" -resize "${size}" "mac/${size}.png"
done
icnsutil compose -f "icon.icns" ./mac/*.png

# Build Mac dev .icns
declare -a sizes=("16" "32" "512" "1024")
for size in "${sizes[@]}"; do
  inkscape -w $size -h $size "$source_icon_dir/icon-purple.svg" -o "./png/${size}x${size}-dev.png"
done

npx iconsur set fakeapp.app -l -i "png/1024x1024-dev.png" -o "mac/1024x1024-dev.png" -s 0.8
declare -a sizes=("16x16" "32x32" "128x128" "512x512")
for size in "${sizes[@]}"; do
  magick "mac/1024x1024-dev.png" -resize "${size}" "mac/${size}-dev.png"
done
icnsutil compose -f "icon-dev.icns" ./mac/*-dev.png

# Build Windows icon
magick -background none "$source_icon_dir/icon-color.svg" -define icon:auto-resize=16,32,48,64,128,256 "./icon.ico"
magick -background none "$source_icon_dir/icon-purple.svg" -define icon:auto-resize=16,32,48,64,128,256 "./icon-dev.ico"

# Build Windows setup icon
magick -background none "$source_icon_dir/icon-installer.svg" -define icon:auto-resize=16,32,48,64,128,256 "$desktop_forge_dir/setup-icon/setup.ico"
magick -background none "$source_icon_dir/icon-installer-purple.svg" -define icon:auto-resize=16,32,48,64,128,256 "$desktop_forge_dir/setup-icon/setup-dev.ico"

# Build Squirrel splash image
magick "./png/256x256.png" -background "#ffffff" -gravity center -extent 640x480 "$desktop_forge_dir/setup-icon/setup-banner.gif"
magick "./png/256x256-dev.png" -background "#ffffff" -gravity center -extent 640x480 "$desktop_forge_dir/setup-icon/setup-banner-dev.gif"

# Copy server assets
server_dir="$script_dir/../../apps/server"
cp "$desktop_forge_dir/app-icon/icon.ico" "$server_dir/src/assets/icon.ico"
cp "$desktop_forge_dir/app-icon/icon-dev.ico" "$server_dir/src/assets/icon-dev.ico"