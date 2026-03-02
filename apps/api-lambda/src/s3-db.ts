import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

const DATA_BUCKET = process.env.DATA_BUCKET!;
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET!;
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
    // First 100 chars to see if it's base64 string
    bufferPreview: typeof buffer === 'string' ? (buffer as string).substring(0, 100) : 'Buffer'
  });

  // Ensure Body is a Buffer (not a string)
  let body: Buffer;
  if (typeof buffer === 'string') {
    // If buffer is a string (base64), convert it back to Buffer
    console.log('[UPLOAD DEBUG] Converting string to Buffer (assuming base64)');
    body = Buffer.from(buffer, 'base64');
  } else if (Buffer.isBuffer(buffer)) {
    console.log('[UPLOAD DEBUG] Buffer is already a Buffer');
    body = buffer;
  } else {
    // Fallback: convert to buffer if it's something else
    console.log('[UPLOAD DEBUG] Converting unknown type to Buffer');
    body = Buffer.from(buffer);
  }

  console.log('[UPLOAD DEBUG] Final body size:', body.length);

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: UPLOADS_BUCKET,
      Key: key,
      Body: body,
      ContentType: file.mimetype,
      CacheControl: "max-age=31536000", // 1 year for immutable uploads
    },
  });

  await upload.done();
  const url = `https://${UPLOADS_BUCKET}.s3.${process.env.AWS_REGION || "eu-west-3"}.amazonaws.com/${key}`;
  console.log('[UPLOAD DEBUG] Upload completed:', url);
  return url;
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
