#!/usr/bin/env bash
set -euo pipefail

MAX_BYTES=$((10 * 1024 * 1024))
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -n "${1:-}" ]]; then
  UPLOADS_BUCKET="$1"
else
  UPLOADS_BUCKET="$(cd "$ROOT_DIR/terraform" && terraform output -raw uploads_bucket)"
fi

echo "[COMPRESS] Bucket: $UPLOADS_BUCKET"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# List oversized images under uploads/
mapfile -t OVERSIZED < <(
  aws s3api list-objects-v2 \
    --bucket "$UPLOADS_BUCKET" \
    --prefix "uploads/" \
    --query "Contents[].[Key,Size]" \
    --output text | awk -v max="$MAX_BYTES" '
      {
        key=$1;
        size=$2;
        lower=tolower(key);
        if (size > max && (lower ~ /\.jpg$/ || lower ~ /\.jpeg$/ || lower ~ /\.png$/ || lower ~ /\.webp$/ || lower ~ /\.gif$/)) {
          print key " " size;
        }
      }
    '
)

if [[ ${#OVERSIZED[@]} -eq 0 ]]; then
  echo "[COMPRESS] No oversized images found."
  exit 0
fi

compress_with_sharp() {
  local input="$1"
  local output="$2"
  local mime="$3"

  node --input-type=module - "$input" "$output" "$mime" <<'NODE'
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const mimeType = process.argv[4];
const MAX_BYTES = 10 * 1024 * 1024;

const source = readFileSync(inputPath);
if (source.length <= MAX_BYTES) {
  writeFileSync(outputPath, source);
  process.exit(0);
}

const qualitySteps = [82, 74, 66, 58, 50, 42, 34, 28];
const maxWidths = [3840, 3200, 2560, 2048, 1920, 1600, 1366, 1280, 1024];
const metadata = await sharp(source).metadata();
const originalWidth = metadata.width ?? 4096;

let best = source;

for (const maxWidth of maxWidths) {
  const targetWidth = Math.min(originalWidth, maxWidth);

  for (const quality of qualitySteps) {
    let pipeline = sharp(source, { failOn: "none" })
      .rotate()
      .resize({ width: targetWidth, fit: "inside", withoutEnlargement: true });

    if (mimeType === "image/png") {
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, quality, palette: true });
    } else if (mimeType === "image/webp") {
      pipeline = pipeline.webp({ quality, effort: 6 });
    } else if (mimeType === "image/gif") {
      pipeline = pipeline.gif({ effort: 10 });
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    }

    const candidate = await pipeline.toBuffer();
    if (candidate.length < best.length) best = candidate;
    if (candidate.length <= MAX_BYTES) {
      writeFileSync(outputPath, candidate);
      process.exit(0);
    }
  }
}

if (best.length > MAX_BYTES) {
  console.error(`Unable to compress below 10MB. Best size: ${best.length}`);
  process.exit(2);
}

writeFileSync(outputPath, best);
NODE
}

get_mime() {
  local key="$1"
  case "${key,,}" in
    *.jpg|*.jpeg) echo "image/jpeg" ;;
    *.png) echo "image/png" ;;
    *.webp) echo "image/webp" ;;
    *.gif) echo "image/gif" ;;
    *) echo "application/octet-stream" ;;
  esac
}

for line in "${OVERSIZED[@]}"; do
  key="$(echo "$line" | awk '{print $1}')"
  size="$(echo "$line" | awk '{print $2}')"

  if [[ -z "$key" || -z "$size" ]]; then
    continue
  fi

  input="$TMP_DIR/in.bin"
  output="$TMP_DIR/out.bin"
  mime="$(get_mime "$key")"

  echo "[COMPRESS] Processing $key (${size} bytes)"
  aws s3 cp "s3://$UPLOADS_BUCKET/$key" "$input" >/dev/null

  if ! compress_with_sharp "$input" "$output" "$mime"; then
    echo "[COMPRESS] Failed to compress $key under 10MB"
    exit 1
  fi

  new_size="$(wc -c < "$output")"
  echo "[COMPRESS] New size: $new_size bytes"

  if (( new_size > MAX_BYTES )); then
    echo "[COMPRESS] Refusing upload, still above 10MB: $key"
    exit 1
  fi

  aws s3 cp "$output" "s3://$UPLOADS_BUCKET/$key" \
    --content-type "$mime" \
    --cache-control "max-age=31536000" >/dev/null

  echo "[COMPRESS] Updated $key"
done

echo "[COMPRESS] Done."
