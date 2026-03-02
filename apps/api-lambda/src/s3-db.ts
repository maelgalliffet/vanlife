import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

const DATA_BUCKET = process.env.DATA_BUCKET!;
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET!;
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || `${UPLOADS_BUCKET}.s3.${process.env.AWS_REGION || "eu-west-3"}.amazonaws.com`;
const DB_KEY = "db.json";

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
  try {
    const command = new GetObjectCommand({
      Bucket: DATA_BUCKET,
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
  const command = new PutObjectCommand({
    Bucket: DATA_BUCKET,
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
    // Use PutObjectCommand directly instead of Upload for better reliability in Lambda
    const command = new PutObjectCommand({
      Bucket: UPLOADS_BUCKET,
      Key: key,
      Body: body,
      ContentType: file.mimetype,
      CacheControl: "max-age=31536000",
    });

    const result = await s3Client.send(command);
    const url = `https://${CLOUDFRONT_DOMAIN}/${key}`;
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
  // Extract key from URL
  const urlParts = url.split("/");
  const key = urlParts[urlParts.length - 1];

  if (!key) return;

  const command = new DeleteObjectCommand({
    Bucket: UPLOADS_BUCKET,
    Key: key,
  });
  await s3Client.send(command);
}
