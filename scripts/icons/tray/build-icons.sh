#!/usr/bin/env bash

if ! command -v magick &> /dev/null; then
  echo "This tool requires ImageMagick to be installed in order to create the icons."
  exit 1
fi

if ! command -v inkscape &> /dev/null; then
  echo "This tool requires Inkscape to be render sharper SVGs than ImageMagick."
  exit 1
fi

script_dir=$(realpath $(dirname $0))
images_dir="$script_dir/../../images"
output_dir="$images_dir/app-icons/tray"

function generateDpiScaledIcons {
  file=$1
  suffix=$2
  name="$(basename $file .svg)$suffix"
  inkscape -w 16 -h 16 "$file" -o "$output_dir/$name.png"
  inkscape -w 20 -h 20 "$file" -o "$output_dir/$name@1.25x.png"
  inkscape -w 24 -h 24 "$file" -o "$output_dir/$name@1.5x.png"
  inkscape -w 32 -h 32 "$file" -o "$output_dir/$name@2x.png"
}

generateDpiScaledIcons "$images_dir/icon-black.svg" "Template"
generateDpiScaledIcons "$images_dir/icon-color.svg"
generateDpiScaledIcons "$images_dir/icon-purple.svg"

for file in *.svg; do
    name="$(basename $file .svg)Template"
    generateDpiScaledIcons "$file" "Template"
    magick "$output_dir/$name.png" -channel RGB -negate "$output_dir/$name-inverted.png"
    magick "$output_dir/$name@1.25x.png" -channel RGB -negate "$output_dir/$name-inverted@1.25x.png"
    magick "$output_dir/$name@1.5x.png" -channel RGB -negate "$output_dir/$name-inverted@1.5x.png"
    magick "$output_dir/$name@2x.png" -channel RGB -negate "$output_dir/$name-inverted@2x.png"
done

