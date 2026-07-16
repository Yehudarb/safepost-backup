#!/bin/bash
set -e

# SafePost build script.
#
# Credentials are NEVER hardcoded here. The build expects the following
# environment variables to be provided by the deployment platform (Render /
# Vercel) or a local `.env` file (see `.env.example`):
#
#   SUPABASE_URL
#   SUPABASE_SERVICE_KEY
#
# For local builds, create a `.env` from `.env.example` first. Do NOT commit it.

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_KEY" ] && [ ! -f .env ]; then
  # Materialize a .env from the environment for tools that read .env directly.
  {
    echo "SUPABASE_URL=$SUPABASE_URL"
    echo "SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY"
  } > .env
fi

# Install dependencies
npm install

# Build frontend
npm run build

# Copy the active Chrome extension files into the build output
echo "📋 Copying extension files..."
cp safe_post_extension/content.js dist/scripts/content.js
cp safe_post_extension/background.js dist/scripts/background.js
cp safe_post_extension/extensionStorage.js dist/scripts/extensionStorage.js

echo "✅ Build complete!"
