#!/usr/bin/env bash

# --------------------------------------------------------------------------------------------------
#
# Create PO files to make easier the labor of translation.
#
# Info:
# 	https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html
# 	https://docs.translatehouse.org/projects/translate-toolkit/en/latest/commands/json2po.html
#
# Dependencies:
# 	jq
# 	translate-toolkit
# 		python-wcwidth
#
# Created by @hasecilu
#
# --------------------------------------------------------------------------------------------------

number_of_keys() {
	[ -f "$1" ] && jq 'path(..) | select(length == 2) | .[1]' "$1" | wc -l || echo "0"
}

stats() {
	# Print the number of existing strings on the JSON files for each locale
	s=$(number_of_keys "${paths[0]}/en/server.json")
	c=$(number_of_keys "${paths[1]}/en/translation.json")
	echo "| locale | server strings | client strings |"
	echo "|--------|----------------|----------------|"
	echo "|   en   |       ${s}      |      ${c}      |"
	echo "|--------|----------------|----------------|"
	for locale in "${locales[@]}"; do
		s=$(number_of_keys "${paths[0]}/${locale}/server.json")
		c=$(number_of_keys "${paths[1]}/${locale}/translation.json")
		n1=$(((8 - ${#locale}) / 2))
		n2=$((n1 == 1 ? n1 + 1 : n1))
		echo "|$(printf "%${n1}s")${locale}$(printf "%${n2}s")|       ${s}      |      ${c}      |"
	done
}

update_1() {
	# Update PO files from English and localized JSON files as source
	# NOTE: if you want a new language you need to first create the JSON files
	# on their corresponding place with `{}` as content to avoid error on `json2po`
	local locales=("$@")
	for path in "${paths[@]}"; do
		for locale in "${locales[@]}"; do
			json2po -t "${path}/en" "${path}/${locale}" "${path}/po-${locale}"
		done
	done
}

update_2() {
	# Recover translation from PO files to localized JSON files
	local locales=("$@")
	for path in "${paths[@]}"; do
		for locale in "${locales[@]}"; do
			po2json -t "${path}/en" "${path}/po-${locale}" "${path}/${locale}"
		done
	done
}

help() {
	echo -e "\nDescription:"
	echo -e "\tCreate PO files to make easier the labor of translation"
	echo -e "\nUsage:"
	echo -e "\t./translation.sh [--stats] [--update1 <OPT_LOCALE>] [--update2 <OPT_LOCALE>]"
	echo -e "\nFlags:"
	echo -e "  --clear\n\tClear all po-* directories"
	echo -e "  --stats\n\tPrint the number of existing strings on the JSON files for each locale"
	echo -e "  --update1 <LOCALE>\n\tUpdate PO files from English and localized JSON files as source"
	echo -e "  --update2 <LOCALE>\n\tRecover translation from PO files to localized JSON files"
}

# Main function ------------------------------------------------------------------------------------

# Get script directory to set file path relative to it
file_path="$(
	cd -- "$(dirname "${0}")" >/dev/null 2>&1 || exit
	pwd -P
)"
paths=(
	"${file_path}/../../apps/server/src/assets/translations/"
	"${file_path}/../../apps/client/src/translations/"
)
locales=(cn de es fr pt_br ro tw)

if [ $# -eq 1 ]; then
	if [ "$1" == "--clear" ]; then
		for path in "${paths[@]}"; do
			for locale in "${locales[@]}"; do
				[ -d "${path}/po-${locale}" ] && rm -r "${path}/po-${locale}"
			done
		done
	elif [ "$1" == "--stats" ]; then
		stats
	elif [ "$1" == "--update1" ]; then
		update_1 "${locales[@]}"
	elif [ "$1" == "--update2" ]; then
		update_2 "${locales[@]}"
	else
		help
	fi
elif [ $# -eq 2 ]; then
	if [ "$1" == "--update1" ]; then
		update_1 "$2"
	elif [ "$1" == "--update2" ]; then
		update_2 "$2"
	else
		help
	fi
else
	help
fi
