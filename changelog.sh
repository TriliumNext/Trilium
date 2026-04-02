#!/bin/bash

# changelog.sh - Auto-generates a structured CHANGELOG.md from git history

echo "Generating CHANGELOG.md..."

# Find the last tag
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)

if [ -z "$LAST_TAG" ]; then
    echo "No tags found. Fetching all commits."
    COMMITS=$(git log --pretty=format:"%s (%h)")
    LOG_RANGE="All commits"
else
    echo "Fetching commits since tag: $LAST_TAG"
    COMMITS=$(git log ${LAST_TAG}..HEAD --pretty=format:"%s (%h)")
    LOG_RANGE="Commits since $LAST_TAG"
fi

cat <<EOF > CHANGELOG.md
# Changelog

*Auto-generated. Range: $LOG_RANGE*

EOF

ADDED=$(echo "$COMMITS" | grep -E -i "^(feat|add|new|feature):?|^Added" | sed -E 's/^(feat|add|new|feature):?[[:space:]]*//I')
FIXED=$(echo "$COMMITS" | grep -E -i "^(fix|bug|patch):?|^Fixed" | sed -E 's/^(fix|bug|patch):?[[:space:]]*//I')
REMOVED=$(echo "$COMMITS" | grep -E -i "^(remove|delete|drop|rm):?|^Removed" | sed -E 's/^(remove|delete|drop|rm):?[[:space:]]*//I')
CHANGED=$(echo "$COMMITS" | grep -E -v -i "^(feat|add|new|feature|fix|bug|patch|remove|delete|drop|rm):?|^Added|^Fixed|^Removed" | sed -E 's/^(chore|refactor|style|docs|test):?[[:space:]]*//I')

if [ ! -z "$ADDED" ]; then
    echo "## Added" >> CHANGELOG.md
    while IFS= read -r line; do echo "- $line" >> CHANGELOG.md; done <<< "$ADDED"
    echo "" >> CHANGELOG.md
fi

if [ ! -z "$FIXED" ]; then
    echo "## Fixed" >> CHANGELOG.md
    while IFS= read -r line; do echo "- $line" >> CHANGELOG.md; done <<< "$FIXED"
    echo "" >> CHANGELOG.md
fi

if [ ! -z "$CHANGED" ]; then
    echo "## Changed" >> CHANGELOG.md
    while IFS= read -r line; do echo "- $line" >> CHANGELOG.md; done <<< "$CHANGED"
    echo "" >> CHANGELOG.md
fi

if [ ! -z "$REMOVED" ]; then
    echo "## Removed" >> CHANGELOG.md
    while IFS= read -r line; do echo "- $line" >> CHANGELOG.md; done <<< "$REMOVED"
    echo "" >> CHANGELOG.md
fi

echo "CHANGELOG.md created successfully!"
