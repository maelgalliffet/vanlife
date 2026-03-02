#!/bin/bash

# Script to fix photo URLs in db.json
# Converts S3 direct URLs to CloudFront /uploads/* paths

set -e

# Load environment variables
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  export $(cat .env | grep -v "^#" | xargs)
fi

# Get Terraform outputs
TERRAFORM_DIR="terraform"
DOMAIN_NAME=vanlife.galliffet.fr
DATA_BUCKET=$(cd "$TERRAFORM_DIR" && terraform output -raw data_bucket 2>/dev/null || echo "")

if [ -z "$DATA_BUCKET" ]; then
  echo "❌ Could not get DATA_BUCKET from terraform outputs"
  exit 1
fi

if [ -z "$DOMAIN_NAME" ]; then
  echo "❌ Could not get DOMAIN_NAME from terraform outputs"
  exit 1
fi

echo "📝 Fetching db.json from S3 bucket: $DATA_BUCKET"

# Download db.json
TEMP_DB="/tmp/db-backup.json"
aws s3 cp "s3://$DATA_BUCKET/db.json" "$TEMP_DB" || {
  echo "⚠️  No existing db.json found in S3, skipping migration"
  exit 0
}

echo "✓ Downloaded db.json"

# Create a Node.js script to fix URLs
NODE_SCRIPT="/tmp/fix-urls.js"
cat > "$NODE_SCRIPT" << 'EOF'
const fs = require('fs');
const path = require('path');

const dbFile = process.argv[2];
const domainName = process.argv[3];

console.log(`Reading ${dbFile}...`);
const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));

// Track changes
let photoCount = 0;
let changedCount = 0;

// Process each booking
if (db.bookings && Array.isArray(db.bookings)) {
  db.bookings.forEach((booking) => {
    if (booking.photoUrls && Array.isArray(booking.photoUrls)) {
      booking.photoUrls = booking.photoUrls.map((url) => {
        photoCount++;
        
        // Check if URL needs to be converted
        // Old formats:
        // - https://vanlife-uploads-prod.s3.eu-west-3.amazonaws.com/[file]
        // - https://d123abc.cloudfront.net/[file]
        // New format:
        // - https://vanlife.domain.com/uploads/[file]
        
        if (url.includes('.s3.') || url.includes('.amazonaws.com')) {
          // Extract filename from various URL formats
          const lastSlash = url.lastIndexOf('/');
          const filename = url.substring(lastSlash + 1);
          
          if (filename) {
            const newUrl = `https://${domainName}/uploads/${filename}`;
            console.log(`  Old: ${url}`);
            console.log(`  New: ${newUrl}`);
            changedCount++;
            return newUrl;
          }
        }
        
        return url;
      });
    }
  });
}

console.log(`\n📊 Summary:`);
console.log(`  Total photos: ${photoCount}`);
console.log(`  Changed: ${changedCount}`);

// Write back
fs.writeFileSync(dbFile, JSON.stringify(db, null, 2) + '\n');
console.log(`\n✓ Updated ${dbFile}`);
EOF

echo "🔄 Converting photo URLs to CloudFront paths..."
node "$NODE_SCRIPT" "$TEMP_DB" "$DOMAIN_NAME"

echo ""
echo "📤 Uploading updated db.json to S3..."
aws s3 cp "$TEMP_DB" "s3://$DATA_BUCKET/db.json" \
  --content-type "application/json" \
  --metadata "fixed-at=$(date -u +%Y-%m-%dT%H:%M:%SZ),migrated-to-cloudfront=true"

echo "✓ Uploaded to S3"

# Cleanup
rm -f "$TEMP_DB" "$NODE_SCRIPT"

echo ""
echo "✅ Photo URLs migration complete!"
echo ""
echo "Next steps:"
echo "1. Deploy infrastructure: cd terraform && terraform apply"
echo "2. Redeploy Lambda: ./scripts/deploy-lambda.sh"
