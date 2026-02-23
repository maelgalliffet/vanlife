import cors from "cors";
import express, { Request } from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { readDb, writeDb } from "./db";
import { Booking, BookingType } from "./types";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

const uploadDir = path.resolve(process.cwd(), "apps/api/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname);
    callback(null, `${Date.now()}-${uuidv4()}${extension}`);
  }
});

const upload = multer({ storage });

app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));
app.use(express.json());
app.use("/uploads", express.static(uploadDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/users", (_req, res) => {
  const db = readDb();
  res.json(db.users);
});

app.get("/bookings", (req, res) => {
  const db = readDb();
  const dateKey = typeof req.query.dateKey === "string" ? req.query.dateKey : null;

  const normalized = db.bookings.map(normalizeBooking);
  if (dateKey) {
    return res.json(normalized.filter((booking) => booking.dateKeys.includes(dateKey)));
  }

  return res.json(normalized);
});

app.post("/bookings/:type", upload.array("photos", 10), (req: Request<{ type: BookingType }>, res) => {
  const type = req.params.type;
  if (type !== "provisional" && type !== "definitive") {
    return res.status(400).json({ message: "Invalid booking type" });
  }

  const { date, startDate, endDate, userId, note } = req.body as {
    date?: string;
    startDate?: string;
    endDate?: string;
    userId?: string;
    note?: string;
  };

  const effectiveStart = startDate ?? date;
  const effectiveEnd = endDate ?? effectiveStart;

  if (!effectiveStart || !effectiveEnd || !userId) {
    return res.status(400).json({ message: "startDate, endDate and userId are required" });
  }

  const db = readDb();
  const user = db.users.find((current) => current.id === userId);
  if (!user) {
    return res.status(404).json({ message: "Unknown user" });
  }

  const dateKeys = getDateKeysBetween(effectiveStart, effectiveEnd);
  if (dateKeys.length === 0) {
    return res.status(400).json({ message: "Plage de dates invalide" });
  }

  if (type === "definitive") {
    const alreadyBooked = db.bookings
      .map(normalizeBooking)
      .filter((booking) => booking.type === "definitive")
      .some((booking) => booking.dateKeys.some((key) => dateKeys.includes(key)));

    if (alreadyBooked) {
      return res.status(409).json({
        message: "Au moins une date du séjour est déjà réservée définitivement"
      });
    }
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const photoUrls = files.map((file) => `${baseUrl}/uploads/${file.filename}`);

  const booking = {
    id: uuidv4(),
    weekendKey: dateKeys[0],
    startDate: dateKeys[0],
    endDate: dateKeys[dateKeys.length - 1],
    dateKeys,
    userId,
    userName: user.name,
    type,
    note: note ?? "",
    photoUrls,
    createdAt: new Date().toISOString()
  };

  db.bookings.push(booking);
  writeDb(db);

  return res.status(201).json(booking);
});

app.put("/bookings/:id", upload.array("photos", 10), (req: Request<{ id: string }>, res) => {
  const bookingId = req.params.id;
  const db = readDb();
  const index = db.bookings.findIndex((booking) => booking.id === bookingId);

  if (index === -1) {
    return res.status(404).json({ message: "Réservation introuvable" });
  }

  const currentBooking = normalizeBooking(db.bookings[index]);
  const payload = req.body as {
    startDate?: string;
    endDate?: string;
    note?: string;
    type?: BookingType;
    removePhotoUrls?: string;
  };

  const nextType = payload.type ?? currentBooking.type;
  if (nextType !== "provisional" && nextType !== "definitive") {
    return res.status(400).json({ message: "Invalid booking type" });
  }

  const nextStart = payload.startDate ?? currentBooking.startDate;
  const nextEnd = payload.endDate ?? currentBooking.endDate;
  const nextDateKeys = getDateKeysBetween(nextStart, nextEnd);
  if (nextDateKeys.length === 0) {
    return res.status(400).json({ message: "Plage de dates invalide" });
  }

  if (nextType === "definitive") {
    const hasConflict = db.bookings
      .filter((booking) => booking.id !== bookingId)
      .map(normalizeBooking)
      .filter((booking) => booking.type === "definitive")
      .some((booking) => booking.dateKeys.some((key) => nextDateKeys.includes(key)));

    if (hasConflict) {
      return res.status(409).json({ message: "Au moins une date du séjour est déjà réservée définitivement" });
    }
  }

  const removePhotoUrls = parseRemovePhotoUrls(payload.removePhotoUrls);
  const keptPhotoUrls = currentBooking.photoUrls.filter((url) => !removePhotoUrls.includes(url));
  const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
  const addedPhotoUrls = uploadedFiles.map((file) => `${baseUrl}/uploads/${file.filename}`);
  const nextPhotoUrls = [...keptPhotoUrls, ...addedPhotoUrls];

  deletePhotoFiles(removePhotoUrls);

  const updatedBooking: Booking = {
    ...currentBooking,
    type: nextType,
    note: payload.note ?? currentBooking.note,
    startDate: nextDateKeys[0],
    endDate: nextDateKeys[nextDateKeys.length - 1],
    weekendKey: nextDateKeys[0],
    dateKeys: nextDateKeys,
    photoUrls: nextPhotoUrls
  };

  db.bookings[index] = updatedBooking;
  writeDb(db);

  return res.json(updatedBooking);
});

app.delete("/bookings/:id", (req: Request<{ id: string }>, res) => {
  const bookingId = req.params.id;
  const requesterUserId =
    typeof req.query.requesterUserId === "string"
      ? req.query.requesterUserId
      : ((req.body as { requesterUserId?: string } | undefined)?.requesterUserId ?? "");

  if (!requesterUserId) {
    return res.status(400).json({ message: "requesterUserId is required" });
  }

  const db = readDb();
  const booking = db.bookings.find((current) => current.id === bookingId);

  if (!booking) {
    return res.status(404).json({ message: "Réservation introuvable" });
  }

  const normalizedBooking = normalizeBooking(booking);
  if (normalizedBooking.userId !== requesterUserId) {
    return res.status(403).json({ message: "Seul le créateur peut supprimer cette réservation" });
  }

  deletePhotoFiles(normalizedBooking.photoUrls);

  db.bookings = db.bookings.filter((current) => current.id !== bookingId);
  writeDb(db);

  return res.json({ ok: true });
});

app.post("/bookings/:id/reactions", (req: Request<{ id: string }>, res) => {
  const bookingId = req.params.id;
  const { emoji, userId } = req.body as { emoji?: string; userId?: string };

  if (!emoji || !userId) {
    return res.status(400).json({ message: "emoji and userId are required" });
  }

  const db = readDb();
  const booking = db.bookings.find((current) => current.id === bookingId);
  if (!booking) {
    return res.status(404).json({ message: "Réservation introuvable" });
  }

  const user = db.users.find((current) => current.id === userId);
  if (!user) {
    return res.status(404).json({ message: "Utilisateur inconnu" });
  }

  const normalized = normalizeBooking(booking);
  const reactions = { ...(normalized.reactions ?? {}) };

  const alreadyReactedOnEmoji = (reactions[emoji] ?? []).includes(userId);

  for (const key of Object.keys(reactions)) {
    reactions[key] = reactions[key].filter((id) => id !== userId);
    if (reactions[key].length === 0) {
      delete reactions[key];
    }
  }

  if (!alreadyReactedOnEmoji) {
    const current = reactions[emoji] ?? [];
    reactions[emoji] = [...current, userId];
  }

  const index = db.bookings.findIndex((current) => current.id === bookingId);
  const updatedBooking: Booking = {
    ...normalized,
    reactions
  };
  db.bookings[index] = updatedBooking;
  writeDb(db);

  return res.json(updatedBooking);
});

app.post("/bookings/:id/comments", (req: Request<{ id: string }>, res) => {
  const bookingId = req.params.id;
  const { userId, text } = req.body as { userId?: string; text?: string };

  if (!userId || !text?.trim()) {
    return res.status(400).json({ message: "userId and text are required" });
  }

  const db = readDb();
  const booking = db.bookings.find((current) => current.id === bookingId);
  if (!booking) {
    return res.status(404).json({ message: "Réservation introuvable" });
  }

  const user = db.users.find((current) => current.id === userId);
  if (!user) {
    return res.status(404).json({ message: "Utilisateur inconnu" });
  }

  const normalized = normalizeBooking(booking);
  const nextComments = [
    ...(normalized.comments ?? []),
    {
      id: uuidv4(),
      userId,
      userName: user.name,
      text: text.trim(),
      createdAt: new Date().toISOString()
    }
  ];

  const index = db.bookings.findIndex((current) => current.id === bookingId);
  const updatedBooking: Booking = {
    ...normalized,
    comments: nextComments
  };
  db.bookings[index] = updatedBooking;
  writeDb(db);

  return res.json(updatedBooking);
});

app.get("/photos", (_req, res) => {
  const db = readDb();
  const photos = db.bookings.map(normalizeBooking).flatMap((booking) =>
    booking.photoUrls.map((url) => ({
      url,
      startDate: booking.startDate,
      endDate: booking.endDate,
      userName: booking.userName,
      type: booking.type,
      note: booking.note,
      bookingId: booking.id
    }))
  );

  res.json(photos);
});

app.post("/dev/reset", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Reset disabled in production" });
  }

  const db = readDb();
  const removedBookings = db.bookings.length;
  db.bookings = [];
  writeDb(db);

  const removedFiles = clearUploadFiles(uploadDir);

  return res.json({
    ok: true,
    removedBookings,
    removedFiles
  });
});

function toDateKey(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function getDateKeysBetween(startInput: string, endInput: string): string[] {
  const startKey = toDateKey(startInput);
  const endKey = toDateKey(endInput);
  const start = new Date(`${startKey}T00:00:00.000Z`);
  const end = new Date(`${endKey}T00:00:00.000Z`);

  if (end.getTime() < start.getTime()) {
    return [];
  }

  const keys: string[] = [];
  const current = new Date(start);
  while (current.getTime() <= end.getTime()) {
    keys.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return keys;
}

function normalizeBooking(booking: Booking): Booking {
  if (booking.startDate && booking.endDate && Array.isArray(booking.dateKeys) && booking.dateKeys.length > 0) {
    return {
      ...booking,
      reactions: booking.reactions ?? {},
      comments: booking.comments ?? []
    };
  }

  const key = booking.weekendKey ?? booking.createdAt.slice(0, 10);
  return {
    ...booking,
    weekendKey: key,
    startDate: key,
    endDate: key,
    dateKeys: [key],
    reactions: booking.reactions ?? {},
    comments: booking.comments ?? []
  };
}

function clearUploadFiles(directory: string): number {
  if (!fs.existsSync(directory)) {
    return 0;
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true });
  let removedFiles = 0;

  for (const entry of entries) {
    const targetPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }

    fs.unlinkSync(targetPath);
    removedFiles += 1;
  }

  return removedFiles;
}

function parseRemovePhotoUrls(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}

function deletePhotoFiles(urls: string[]): void {
  for (const url of urls) {
    const fileName = extractUploadedFileName(url);
    if (!fileName) {
      continue;
    }

    const filePath = path.join(uploadDir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function extractUploadedFileName(url: string): string | null {
  const marker = "/uploads/";
  const markerIndex = url.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const fileName = url.slice(markerIndex + marker.length);
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    return null;
  }

  return fileName;
}

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API running on http://localhost:${port}`);
});
