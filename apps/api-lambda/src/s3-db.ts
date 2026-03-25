import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Helper function to detect MIME type from filename
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'pdf': 'application/pdf',
    'txt': 'text/plain',
    'json': 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

const DATA_BUCKET = process.env.DATA_BUCKET;
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET;
// CloudFront custom domain (e.g., vanlife.galliffet.com)
const CLOUDFRONT_CUSTOM_DOMAIN = process.env.CLOUDFRONT_CUSTOM_DOMAIN;
// Fallback to direct S3 domain if custom domain not set
const CLOUDFRONT_DOMAIN =
  CLOUDFRONT_CUSTOM_DOMAIN ||
  (UPLOADS_BUCKET ? `${UPLOADS_BUCKET}.s3.${process.env.AWS_REGION || "eu-west-3"}.amazonaws.com` : "");
const DB_KEY = "db.json";
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_DATA_DIR = path.resolve(__dirname, "../../../tmp/local-storage");
const LOCAL_DB_PATH = path.join(LOCAL_DATA_DIR, DB_KEY);
export const LOCAL_UPLOADS_DIR = path.join(LOCAL_DATA_DIR, "uploads");
const LOCAL_UPLOAD_BASE_URL = process.env.LOCAL_UPLOAD_BASE_URL || "http://localhost:4000";

export const isLocalStorage = process.env.LOCAL_DEV === "true" || !DATA_BUCKET || !UPLOADS_BUCKET;

export class UploadTooLargeError extends Error {
  statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = "UploadTooLargeError";
    this.statusCode = 413;
  }
}

async function compressImageIfNeeded(body: Buffer, mimeType: string): Promise<Buffer> {
  if (!mimeType.startsWith("image/") || body.length <= MAX_IMAGE_SIZE_BYTES) {
    return body;
  }

  const qualitySteps = [82, 74, 66, 58, 50, 42, 34, 28];
  const maxWidths = [3840, 3200, 2560, 2048, 1920, 1600, 1366, 1280, 1024];
  const metadata = await sharp(body).metadata();
  const originalWidth = metadata.width ?? 4096;

  let bestCandidate = body;

  for (const maxWidth of maxWidths) {
    const targetWidth = Math.min(originalWidth, maxWidth);

    for (const quality of qualitySteps) {
      let pipeline = sharp(body, { failOn: "none" }).rotate().resize({
        width: targetWidth,
        fit: "inside",
        withoutEnlargement: true,
      });

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
      if (candidate.length < bestCandidate.length) {
        bestCandidate = candidate;
      }

      if (candidate.length <= MAX_IMAGE_SIZE_BYTES) {
        console.log("[UPLOAD DEBUG] Image compressed successfully:", {
          originalBytes: body.length,
          compressedBytes: candidate.length,
          mimeType,
          maxWidth: targetWidth,
          quality,
        });
        return candidate;
      }
    }
  }

  throw new UploadTooLargeError(
    `Image trop volumineuse après compression (${Math.ceil(bestCandidate.length / (1024 * 1024))}MB). Max autorisé: 10MB.`
  );
}

export interface User {
  id: string;
  name: string;
}

export interface Booking {
  id: string;
  weekendKey: string;
  startDate: string;
  endDate: string;
  dateKeys: string[];
  userId: string;
  userName: string;
  type: "tentative" | "definitive" | "provisional";
  note: string;
  photoUrls: string[];
  createdAt: string;
  reactions: Record<string, string>;
  comments: Array<{
    id: string;
    userId: string;
    userName: string;
    text: string;
    createdAt: string;
    updatedAt?: string;
  }>;
}

export interface Database {
  users: User[];
  bookings: Booking[];
}

// Read database from S3
export async function readDb(): Promise<Database> {
  if (isLocalStorage) {
    await mkdir(LOCAL_DATA_DIR, { recursive: true });
    await mkdir(LOCAL_UPLOADS_DIR, { recursive: true });

    if (!existsSync(LOCAL_DB_PATH)) {
      const defaultDb: Database = {
        users: [
          { id: "mael", name: "Maël/Salma" },
          { id: "ivan", name: "Ivan/Isa" },
          { id: "lena", name: "Lena/Lucas" },
        ],
        bookings: [],
      };
      await writeDb(defaultDb);
      return defaultDb;
    }

    const dbRaw = await readFile(LOCAL_DB_PATH, "utf-8");
    return JSON.parse(dbRaw) as Database;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: DATA_BUCKET!,
      Key: DB_KEY,
    });
    const response = await s3Client.send(command);
    const body = await response.Body!.transformToString();
    return JSON.parse(body);
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      // Initialize with default data
      const defaultDb: Database = {
        users: [
          { id: "mael", name: "Maël/Salma" },
          { id: "ivan", name: "Ivan/Isa" },
          { id: "lena", name: "Lena/Lucas" },
        ],
        bookings: [],
      };
      await writeDb(defaultDb);
      return defaultDb;
    }
    throw error;
  }
}

// Write database to S3
export async function writeDb(db: Database): Promise<void> {
  if (isLocalStorage) {
    await mkdir(LOCAL_DATA_DIR, { recursive: true });
    await writeFile(LOCAL_DB_PATH, JSON.stringify(db, null, 2), "utf-8");
    return;
  }

  const command = new PutObjectCommand({
    Bucket: DATA_BUCKET!,
    Key: DB_KEY,
    Body: JSON.stringify(db, null, 2),
    ContentType: "application/json",
  });
  await s3Client.send(command);
}

// Upload file to S3
export async function uploadFileToS3(
  file: Express.Multer.File,
  key: string
): Promise<string> {
  // Debug logging
  const buffer: any = file.buffer;
  console.log('[UPLOAD DEBUG] File info:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    bufferType: typeof buffer,
    bufferIsBuffer: Buffer.isBuffer(buffer),
    bufferLength: buffer?.length || 0,
  });

  // Ensure Body is a Buffer
  // NOTE: Multer with memoryStorage should ALWAYS provide a Buffer, not a string
  // Do NOT attempt to decode base64 strings - this corrupts binary data
  let body: Buffer;
  if (Buffer.isBuffer(buffer)) {
    console.log('[UPLOAD DEBUG] Buffer is a Buffer (OK)');
    body = buffer;
  } else if (typeof buffer === 'string') {
    // This should not happen with multer memoryStorage
    // If it does, the data is already corrupted upstream
    console.warn('[UPLOAD WARNING] Buffer is string (unexpected), converting with UTF-8 encoding');
    body = Buffer.from(buffer, 'utf-8');
  } else {
    console.error('[UPLOAD ERROR] Unexpected buffer type:', typeof buffer);
    body = Buffer.from(String(buffer));
  }

  console.log('[UPLOAD DEBUG] Final body size:', body.length);
  console.log('[UPLOAD DEBUG] Uploading to bucket:', UPLOADS_BUCKET, 'with key:', key);

  try {
    // Detect the correct MIME type from file extension or use provided mimetype
    const detectedMimeType = getMimeType(key) || file.mimetype || 'application/octet-stream';
    console.log('[UPLOAD DEBUG] Detected MIME type:', detectedMimeType, '(from key:', key, ')');

    const processedBody = await compressImageIfNeeded(body, detectedMimeType);

    if (processedBody.length > MAX_IMAGE_SIZE_BYTES && detectedMimeType.startsWith("image/")) {
      throw new UploadTooLargeError("Image trop volumineuse. Taille maximale: 10MB.");
    }

    if (isLocalStorage) {
      await mkdir(LOCAL_UPLOADS_DIR, { recursive: true });
      const relativeKey = key.replace(/^uploads\//, "");
      const localFilePath = path.join(LOCAL_UPLOADS_DIR, relativeKey);
      await mkdir(path.dirname(localFilePath), { recursive: true });
      await writeFile(localFilePath, processedBody);
      return `${LOCAL_UPLOAD_BASE_URL}/uploads/${relativeKey}`;
    }

    // Use PutObjectCommand directly instead of Upload for better reliability in Lambda
    const command = new PutObjectCommand({
      Bucket: UPLOADS_BUCKET!,
      Key: key,
      Body: processedBody,
      ContentType: detectedMimeType,
      CacheControl: "max-age=31536000",
    });

    const result = await s3Client.send(command);
    // Use CloudFront custom domain if available, otherwise fallback to direct S3 URL
    // Note: key already includes the path prefix (e.g., "uploads/filename.jpg")
    const url = CLOUDFRONT_CUSTOM_DOMAIN
      ? `https://${CLOUDFRONT_CUSTOM_DOMAIN}/${key}`
      : `https://${CLOUDFRONT_DOMAIN}/${key}`;
    console.log('[UPLOAD DEBUG] Upload completed successfully:', url);
    console.log('[UPLOAD DEBUG] Upload ETag:', result.ETag);
    return url;
  } catch (error) {
    console.error('[UPLOAD ERROR] Failed to upload file:', error);
    console.error('[UPLOAD ERROR] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    throw error;
  }
}

// Delete file from S3
export async function deleteFileFromS3(url: string): Promise<void> {
  // Extract key from URL (e.g., "https://example.com/uploads/file.jpg" -> "uploads/file.jpg")
  try {
    const urlObj = new URL(url);
    const key = urlObj.pathname.slice(1); // Remove leading slash

    if (!key) return;

    if (isLocalStorage) {
      const relativeKey = key.replace(/^uploads\//, "");
      const localFilePath = path.join(LOCAL_UPLOADS_DIR, relativeKey);
      if (existsSync(localFilePath)) {
        await unlink(localFilePath);
      }
      return;
    }

    const command = new DeleteObjectCommand({
      Bucket: UPLOADS_BUCKET!,
      Key: key,
    });
    await s3Client.send(command);
  } catch (error) {
    console.error('[DELETE ERROR] Failed to parse URL or delete file:', url, error);
  }
}
