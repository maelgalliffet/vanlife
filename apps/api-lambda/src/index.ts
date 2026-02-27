import serverless from "serverless-http";
import express, { Request } from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { readDb, writeDb, uploadFileToS3, deleteFileFromS3, Booking } from "./s3-db.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors({ origin: "*" }));
app.use(express.json());

// Helper functions
function getDateKeysBetween(startDateStr: string, endDateStr: string): string[] {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(endDateStr + "T00:00:00Z");

  if (end < start) return [];

  const keys: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    keys.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return keys;
}

function normalizeBooking(booking: any): Booking {
  const normalizedType = booking.type === "tentative" ? "provisional" : booking.type;
  return {
    ...booking,
    type: normalizedType,
    reactions: booking.reactions ?? {},
    comments: booking.comments ?? []
  };
}

function parseRemovePhotoUrls(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type BookingType = "provisional" | "definitive";

// Routes
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/users", async (_req, res) => {
  try {
    const db = await readDb();
    res.json(db.users);
  } catch (error) {
    console.error("Error reading users:", error);
    res.status(500).json({ message: "Error reading users" });
  }
});

app.get("/bookings", async (req, res) => {
  try {
    const db = await readDb();
    const dateKey = typeof req.query.dateKey === "string" ? req.query.dateKey : null;

    const normalized = db.bookings.map(normalizeBooking);
    if (dateKey) {
      return res.json(normalized.filter((booking) => booking.dateKeys.includes(dateKey)));
    }

    return res.json(normalized);
  } catch (error) {
    console.error("Error reading bookings:", error);
    res.status(500).json({ message: "Error reading bookings" });
  }
});

app.post("/bookings/:type", upload.array("photos", 10), async (req: Request<{ type: BookingType }>, res) => {
  try {
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

    const db = await readDb();
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
    const photoUrls: string[] = [];
    
    for (const file of files) {
      const key = `${Date.now()}-${uuidv4()}${file.originalname.substring(file.originalname.lastIndexOf("."))}`;
      const url = await uploadFileToS3(file, key);
      photoUrls.push(url);
    }

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
      createdAt: new Date().toISOString(),
      reactions: {},
      comments: []
    };

    db.bookings.push(booking);
    await writeDb(db);

    return res.status(201).json(booking);
  } catch (error) {
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Error creating booking" });
  }
});

app.put("/bookings/:id", upload.array("photos", 10), async (req: Request<{ id: string }>, res) => {
  try {
    const bookingId = req.params.id;
    const db = await readDb();
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
    
    // Delete removed photos from S3
    for (const url of removePhotoUrls) {
      await deleteFileFromS3(url);
    }

    // Upload new photos
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) ?? [];
    const addedPhotoUrls: string[] = [];
    
    for (const file of uploadedFiles) {
      const key = `${Date.now()}-${uuidv4()}${file.originalname.substring(file.originalname.lastIndexOf("."))}`;
      const url = await uploadFileToS3(file, key);
      addedPhotoUrls.push(url);
    }

    const nextPhotoUrls = [...keptPhotoUrls, ...addedPhotoUrls];

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
    await writeDb(db);

    return res.json(updatedBooking);
  } catch (error) {
    console.error("Error updating booking:", error);
    return res.status(500).json({ message: "Error updating booking" });
  }
});

app.delete("/bookings/:id", async (req: Request<{ id: string }>, res) => {
  try {
    const bookingId = req.params.id;
    const requesterUserId =
      typeof req.query.requesterUserId === "string"
        ? req.query.requesterUserId
        : ((req.body as { requesterUserId?: string } | undefined)?.requesterUserId ?? "");

    if (!requesterUserId) {
      return res.status(400).json({ message: "requesterUserId is required" });
    }

    const db = await readDb();
    const index = db.bookings.findIndex((booking) => booking.id === bookingId);

    if (index === -1) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }

    const booking = normalizeBooking(db.bookings[index]);

    if (booking.userId !== requesterUserId) {
      return res.status(403).json({ message: "Vous ne pouvez supprimer que vos propres réservations" });
    }

    // Delete photos from S3
    for (const photoUrl of booking.photoUrls) {
      await deleteFileFromS3(photoUrl);
    }

    db.bookings.splice(index, 1);
    await writeDb(db);

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting booking:", error);
    return res.status(500).json({ message: "Error deleting booking" });
  }
});

// Reaction routes
app.post("/bookings/:id/reactions", async (req: Request<{ id: string }>, res) => {
  try {
    const bookingId = req.params.id;
    const { userId, emoji } = req.body as { userId?: string; emoji?: string };

    if (!userId || !emoji) {
      return res.status(400).json({ message: "userId and emoji are required" });
    }

    const db = await readDb();
    const booking = db.bookings.find((booking) => booking.id === bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }

    const normalized = normalizeBooking(booking);
    normalized.reactions[userId] = emoji;

    Object.assign(booking, normalized);
    await writeDb(db);

    return res.json(normalized);
  } catch (error) {
    console.error("Error adding reaction:", error);
    return res.status(500).json({ message: "Error adding reaction" });
  }
});

app.delete("/bookings/:id/reactions/:userId", async (req: Request<{ id: string; userId: string }>, res) => {
  try {
    const { id: bookingId, userId } = req.params;

    const db = await readDb();
    const booking = db.bookings.find((booking) => booking.id === bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }

    const normalized = normalizeBooking(booking);
    delete normalized.reactions[userId];

    Object.assign(booking, normalized);
    await writeDb(db);

    return res.json(normalized);
  } catch (error) {
    console.error("Error removing reaction:", error);
    return res.status(500).json({ message: "Error removing reaction" });
  }
});

// Comment routes
app.post("/bookings/:id/comments", async (req: Request<{ id: string }>, res) => {
  try {
    const bookingId = req.params.id;
    const { userId, text } = req.body as { userId?: string; text?: string };

    if (!userId || !text) {
      return res.status(400).json({ message: "userId and text are required" });
    }

    const db = await readDb();
    const booking = db.bookings.find((booking) => booking.id === bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }

    const user = db.users.find((u) => u.id === userId);
    if (!user) {
      return res.status(404).json({ message: "Unknown user" });
    }

    const normalized = normalizeBooking(booking);
    const comment = {
      id: uuidv4(),
      userId,
      userName: user.name,
      text,
      createdAt: new Date().toISOString()
    };

    normalized.comments.push(comment);

    Object.assign(booking, normalized);
    await writeDb(db);

    return res.status(201).json(comment);
  } catch (error) {
    console.error("Error adding comment:", error);
    return res.status(500).json({ message: "Error adding comment" });
  }
});

app.delete("/bookings/:bookingId/comments/:commentId", async (req: Request<{ bookingId: string; commentId: string }>, res) => {
  try {
    const { bookingId, commentId } = req.params;
    const requesterUserId =
      typeof req.query.requesterUserId === "string"
        ? req.query.requesterUserId
        : ((req.body as { requesterUserId?: string } | undefined)?.requesterUserId ?? "");

    if (!requesterUserId) {
      return res.status(400).json({ message: "requesterUserId is required" });
    }

    const db = await readDb();
    const booking = db.bookings.find((booking) => booking.id === bookingId);

    if (!booking) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }

    const normalized = normalizeBooking(booking);
    const commentIndex = normalized.comments.findIndex((comment) => comment.id === commentId);

    if (commentIndex === -1) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const comment = normalized.comments[commentIndex];
    if (comment.userId !== requesterUserId) {
      return res.status(403).json({ message: "Vous ne pouvez supprimer que vos propres commentaires" });
    }

    normalized.comments.splice(commentIndex, 1);

    Object.assign(booking, normalized);
    await writeDb(db);

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting comment:", error);
    return res.status(500).json({ message: "Error deleting comment" });
  }
});

// Export handler wrapped with serverless-http
export const handler = serverless(app);
