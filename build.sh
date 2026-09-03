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

# Build frontend and package the service worker with every dependency parsed
# from its importScripts() calls. The build fails if a dependency is missing.
npm run build

# Copy non-service-worker extension files into the build output. background.js
# and its importScripts dependencies were copied and verified by npm run build.
echo "📋 Copying extension files..."
cp safe_post_extension/content.js dist/scripts/content.js
cp safe_post_extension/fbUtils.js dist/scripts/fbUtils.js

echo "✅ Build complete!"
