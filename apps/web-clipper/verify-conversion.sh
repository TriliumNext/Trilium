#!/bin/bash
# Trilium Web Clipper - Manifest V3 Verification Script

echo "🔍 Trilium Web Clipper Manifest V3 Conversion Verification"
echo "=========================================================="

# Check manifest.json structure
echo ""
echo "📋 Checking manifest.json..."
if grep -q '"manifest_version": 3' manifest.json; then
    echo "✅ Manifest version 3 detected"
else
    echo "❌ Manifest version 3 not found"
fi

if grep -q '"service_worker"' manifest.json; then
    echo "✅ Service worker configuration found"
else
    echo "❌ Service worker configuration missing"
fi

if grep -q '"scripting"' manifest.json; then
    echo "✅ Scripting permission found"
else
    echo "❌ Scripting permission missing"
fi

# Check file existence
echo ""
echo "📁 Checking required files..."
files=("background.js" "content.js" "utils.js" "trilium_server_facade.js" "popup/popup.js" "options/options.js")

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
    fi
done

# Check for chrome API usage
echo ""
echo "🌐 Checking Chrome API usage..."
if grep -q "chrome\." background.js; then
    echo "✅ Chrome APIs found in background.js"
else
    echo "❌ Chrome APIs missing in background.js"
fi

if grep -q "chrome\." content.js; then
    echo "✅ Chrome APIs found in content.js"
else
    echo "❌ Chrome APIs missing in content.js"
fi

# Check ES module exports
echo ""
echo "📦 Checking ES module structure..."
if grep -q "export" utils.js; then
    echo "✅ ES module exports found in utils.js"
else
    echo "❌ ES module exports missing in utils.js"
fi

if grep -q "import" background.js; then
    echo "✅ ES module imports found in background.js"
else
    echo "❌ ES module imports missing in background.js"
fi

echo ""
echo "🚀 Verification complete!"
echo ""
echo "Next steps:"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Enable Developer mode"
echo "3. Click 'Load unpacked' and select this directory"
echo "4. Test the extension functionality"