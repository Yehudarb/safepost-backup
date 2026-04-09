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

echo "✅ Build complete!"
