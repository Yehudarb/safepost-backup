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

# Build the frontend and the complete extension artifact from
# safe_post_extension/. The extension build validates every runtime dependency.
npm run build

echo "✅ Build complete!"
