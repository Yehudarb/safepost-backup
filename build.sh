#!/bin/bash

# Create .env file from environment variables
cat > .env << EOF
SUPABASE_URL=https://namyhsldzufeoycleqxf.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_RnLBNjUkhLHjF630ucbfsA_MLuonpua
EOF

# Install dependencies
npm install

# Build frontend
npm run build

# Copy extension files to dist
echo "📋 Copying extension files..."
cp safe_post_extension/content.js dist/scripts/content.js
cp safe_post_extension/background.js dist/scripts/background.js
cp safe_post_extension/extensionStorage.js dist/scripts/extensionStorage.js

echo "✅ Build complete!"
