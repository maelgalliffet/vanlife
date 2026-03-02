# Photo Upload Refactoring - CloudFront /uploads Route

## Overview
This refactoring improves the photo upload functionality by:
1. Adding a CloudFront distribution route for `/uploads/*` that serves images from the S3 uploads bucket
2. Updating the backend to generate proper CloudFront URLs for uploaded images
3. Providing a migration script to update existing photo URLs in the database

## Changes Made

### 1. CloudFront Distribution Enhancement (`terraform/cloudfront.tf`)

**New Origin**: Added `S3Uploads` origin that points to the uploads S3 bucket
```terraform
origin {
  domain_name = aws_s3_bucket.uploads.bucket_regional_domain_name
  origin_id   = "S3Uploads"
  s3_origin_config {
    origin_access_identity = aws_cloudfront_origin_access_identity.uploads.cloudfront_access_identity_path
  }
}
```

**New Cache Behavior**: Added `/uploads/*` path pattern behavior
- Path Pattern: `/uploads/*`
- Target Origin: `S3Uploads`
- TTL: 1 year (since uploads have unique timestamps and UUIDs)
- Protocol: HTTPS only

**New Origin Access Identity (OAI)**: 
- Created separate OAI for uploads bucket to securely restrict S3 access through CloudFront only

**New S3 Bucket Policy**:
- Allows CloudFront OAI to read objects from the uploads bucket
- Prevents direct S3 access, enforcing CloudFront delivery

### 2. Backend Updates (`apps/api-lambda/src/s3-db.ts`)

**Environment Variable**:
- Added `CLOUDFRONT_CUSTOM_DOMAIN` to use the main domain's CloudFront distribution
- Falls back to direct S3 domain if custom domain not configured

**URL Generation**:
- When `CLOUDFRONT_CUSTOM_DOMAIN` is set: URLs are in format `https://vanlife.galliffet.fr/uploads/{filename}`
- When not set: URLs fallback to direct S3 domain

```typescript
const url = CLOUDFRONT_CUSTOM_DOMAIN 
  ? `https://${CLOUDFRONT_CUSTOM_DOMAIN}/uploads/${key}`
  : `https://${CLOUDFRONT_DOMAIN}/${key}`;
```

### 3. Lambda Configuration (`terraform/lambda.tf`)

**New Environment Variable**:
```terraform
CLOUDFRONT_CUSTOM_DOMAIN = var.domain_name
```

This ensures the Lambda function uses the main domain for image URLs.

### 4. Frontend Upload Enhancements (`apps/web/src/App.tsx`)

Previously added:
- File previews before upload
- Client-side validation (image types, 50MB limit)
- Automatic form reset after successful upload
- Better error messages

## Migration Script

### File: `scripts/fix-photo-urls.sh`

This script:
1. Downloads `db.json` from the data S3 bucket
2. Converts all photo URLs from old formats to CloudFront `/uploads/*` paths
3. Uploads the updated `db.json` back to S3

**Old URL formats converted**:
- `https://vanlife-uploads-prod.s3.eu-west-3.amazonaws.com/[file]` → `https://vanlife.galliffet.fr/uploads/[file]`
- `https://d123abc.cloudfront.net/[file]` → `https://vanlife.galliffet.fr/uploads/[file]`

**Usage**:
```bash
./scripts/fix-photo-urls.sh
```

## Deployment Steps

### 1. Deploy Infrastructure Changes
```bash
cd terraform
terraform plan    # Review changes
terraform apply   # Apply infrastructure changes
```

This will:
- Update the CloudFront distribution with new origin and cache behavior
- Create OAI for uploads bucket
- Update S3 bucket policies
- Update Lambda environment variables

### 2. Redeploy Lambda Function
```bash
./scripts/deploy-lambda.sh
```

This rebuilds and deploys the Lambda function with new environment variables.

### 3. Migrate Existing Photo URLs (Optional)
If you have existing photos with old URLs:
```bash
./scripts/fix-photo-urls.sh
```

This updates all photo URLs in your database to use the CloudFront path.

## URL Mapping

### Old URL Structure
```
https://vanlife-uploads-prod.s3.eu-west-3.amazonaws.com/[uuid].jpg
                                                           ↓
                                              Direct S3 access
```

### New URL Structure
```
https://vanlife.galliffet.fr/uploads/[uuid].jpg
                        ↓
                   CloudFront Distribution
                        ↓
                   S3 Uploads Bucket (via OAI)
```

## Benefits

1. **Unified CDN**: All content (frontend, uploads) served through single CloudFront distribution
2. **Better Caching**: CloudFront caches images for 1 year (safe because filenames are unique)
3. **Security**: Direct S3 access blocked, must go through CloudFront
4. **Consistency**: Single domain for all content (`vanlife.galliffet.fr`)
5. **Performance**: Content served from CloudFront edge locations globally

## Testing

### Test New Uploads
1. Deploy the infrastructure and Lambda changes
2. Upload a new photo through the UI
3. Verify it's served from `https://vanlife.galliffet.fr/uploads/[filename]`
4. Check CloudWatch logs for upload details

### Test Existing URLs
1. Run `fix-photo-urls.sh` to migrate existing photos
2. Verify old URLs redirect/work through CloudFront
3. Check that images display correctly

### CloudFront Cache Behavior
```bash
# Download and verify image integrity
curl -I https://vanlife.galliffet.fr/uploads/[uuid].jpg

# Should show:
# - Content-Type: image/jpeg (correct type)
# - Cache-Control: max-age=31536000 (1 year cache)
# - Via: cloudfront (served from CloudFront)
```

## Troubleshooting

### Images return 404 through CloudFront
1. Check S3 bucket policy: `aws s3api get-bucket-policy --bucket vanlife-uploads-prod`
2. Verify OAI is in the policy
3. Check bucket versioning and object exists

### Old URLs still return errors
1. Run `fix-photo-urls.sh` to migrate database
2. Wait for CloudFront cache invalidation (can take a few minutes)
3. Clear browser cache

### Wrong URL format generated
1. Check Lambda environment variable: `aws lambda get-function-configuration --function-name vanlife-api-prod`
2. Verify `CLOUDFRONT_CUSTOM_DOMAIN` is set to domain name
3. Redeploy Lambda with new environment variables

## Files Modified

- `terraform/cloudfront.tf` - CloudFront distribution and policies
- `terraform/lambda.tf` - Lambda environment variables
- `apps/api-lambda/src/s3-db.ts` - URL generation logic
- `scripts/fix-photo-urls.sh` - Database migration script (new)
- `apps/web/src/App.tsx` - Frontend improvements (previously done)

## Rollback Plan

If issues occur:
1. Comment out the new `ordered_cache_behavior` section in `terraform/cloudfront.tf`
2. Remove the `CLOUDFRONT_CUSTOM_DOMAIN` variable from Lambda
3. Revert `s3-db.ts` to use only direct S3 URL
4. Apply infrastructure and redeploy Lambda
