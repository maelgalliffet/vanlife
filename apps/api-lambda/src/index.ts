import serverless from "serverless-http";
import express, { Request, Router } from "express";
import cors from "cors";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import {
  readDb,
  writeDb,
  uploadFileToS3,
  deleteFileFromS3,
  Booking,
  normalizeBooking,
  UploadTooLargeError,
  isLocalStorage,
  LOCAL_UPLOADS_DIR,
  Database
} from "./s3-db.js";
import {
  pickSubscribedUserIds,
  removeSubscriptionsById,
  sendPushToUsers,
  uniqueUserIds,
} from "./push.js";
import { registerPushRoutes } from "./push-routes.js";
import { registerBookingInteractionRoutes } from "./booking-interactions-routes.js";
import { notificationMessages } from "./notification-messages.js";

const app = express();
const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  // Important: Don't set encoding - multer should preserve binary data as-is
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (isLocalStorage && LOCAL_UPLOADS_DIR) {
  app.use("/uploads", express.static(LOCAL_UPLOADS_DIR));
}

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

function parseRemovePhotoUrls(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultBookingTitle(startDate: string, endDate: string): string {
  return `${startDate} -> ${endDate}`;
}

function resolveBookingTitle(startDate: string, endDate: string, title: string | undefined): string {
  const normalized = (title ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return getDefaultBookingTitle(startDate, endDate);
}

function isPublishedBooking(booking: Booking): boolean {
  return booking.endDate < getTodayKey();
}

async function notifyUsers(db: Database, userIds: string[], payload: { title: string; body: string; url?: string; tag?: string }) {
  const { removedSubscriptionIds } = await sendPushToUsers(db, uniqueUserIds(userIds), payload);
  if (removedSubscriptionIds.length > 0) {
    removeSubscriptionsById(db, removedSubscriptionIds);
    await writeDb(db);
  }
}

async function notifyNewPublicationsIfNeeded(db: Database): Promise<void> {
  const allUserIds = db.users.map((user) => user.id);
  if (allUserIds.length === 0) {
    return;
  }

  const toPublish = db.bookings
    .map(normalizeBooking)
    .filter((booking) => isPublishedBooking(booking) && !booking.publishedNotificationSentAt);

  if (toPublish.length === 0) {
    return;
  }

  for (const booking of toPublish) {
    await notifyUsers(db, allUserIds, notificationMessages.newPublication(booking));

    const target = db.bookings.find((item) => item.id === booking.id);
    if (target) {
      target.publishedNotificationSentAt = new Date().toISOString();
    }
  }

  await writeDb(db);
}

type BookingType = "provisional" | "definitive";

// Routes
router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.get("/users", async (_req, res) => {
  try {
    const db = await readDb();
    res.json(db.users);
  } catch (error) {
    console.error("Error reading users:", error);
    res.status(500).json({ message: "Error reading users" });
  }
});

router.get("/bookings", async (req, res) => {
  try {
    const db = await readDb();
    await notifyNewPublicationsIfNeeded(db);
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

router.get("/bookings/:id", async (req: Request<{ id: string }>, res) => {
  try {
    const db = await readDb();
    const booking = db.bookings.find((item) => item.id === req.params.id);
    if (!booking) {
      return res.status(404).json({ message: "Réservation introuvable" });
    }
    return res.json(normalizeBooking(booking));
  } catch (error) {
    console.error("Error reading booking:", error);
    res.status(500).json({ message: "Error reading booking" });
  }
});

router.get("/photos", async (_req, res) => {
  try {
    const db = await readDb();
    await notifyNewPublicationsIfNeeded(db);
    const photos: any[] = [];

    db.bookings.forEach((booking) => {
      const normalized = normalizeBooking(booking);
      normalized.photoUrls.forEach((url) => {
        photos.push({
          url,
          startDate: normalized.startDate,
          endDate: normalized.endDate,
          userName: normalized.userName,
          type: normalized.type,
          note: normalized.note,
          bookingId: normalized.id
        });
      });
    });

    res.json(photos);
  } catch (error) {
    console.error("Error reading photos:", error);
    res.status(500).json({ message: "Error reading photos" });
  }
});

registerPushRoutes(router);

router.post("/dev/reset", async (_req, res) => {
  try {
    if (!isLocalStorage && process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Route disponible uniquement en dev" });
    }

    const db = await readDb();
    let removedFiles = 0;

    for (const booking of db.bookings) {
      for (const photoUrl of booking.photoUrls) {
        await deleteFileFromS3(photoUrl);
        removedFiles++;
      }
    }

    const removedBookings = db.bookings.length;
    db.bookings = [];
    await writeDb(db);

    return res.json({ removedBookings, removedFiles });
  } catch (error) {
    console.error("Error resetting dev data:", error);
    return res.status(500).json({ message: "Erreur lors de la réinitialisation" });
  }
});

router.post("/dev/seed", async (_req, res) => {
  try {
    if (!isLocalStorage && process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Route disponible uniquement en dev" });
    }

    const db = await readDb();

    // Vider les réservations existantes avant de peupler
    for (const booking of db.bookings) {
      for (const photoUrl of booking.photoUrls) {
        await deleteFileFromS3(photoUrl);
      }
    }
    db.bookings = [];

    function addDays(base: Date, days: number): string {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }

    function dateRange(start: string, end: string): string[] {
      const keys: string[] = [];
      const d = new Date(start + "T00:00:00Z");
      const endD = new Date(end + "T00:00:00Z");
      while (d <= endD) {
        keys.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
      }
      return keys;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    function booking(
      id: string,
      userId: string,
      userName: string,
      type: "provisional" | "definitive",
      startOffset: number,
      endOffset: number,
      note: string,
      createdOffset: number,
      reactions: Record<string, string> = {},
      comments: Booking["comments"] = [],
      publishedOffset?: number
    ): Booking {
      const start = addDays(today, startOffset);
      const end = addDays(today, endOffset);
      const keys = dateRange(start, end);
      return {
        id,
        weekendKey: keys[0],
        startDate: keys[0],
        endDate: keys[keys.length - 1],
        dateKeys: keys,
        userId,
        userName,
        type,
        note,
        photoUrls: [],
        createdAt: addDays(today, createdOffset) + "T10:00:00.000Z",
        reactions,
        comments,
        ...(publishedOffset !== undefined && {
          publishedNotificationSentAt: addDays(today, publishedOffset) + "T09:00:00.000Z"
        })
      };
    }

    const seedBookings: Booking[] = [
      booking(
        "seed-mael-ski", "mael", "Maël/Salma", "definitive",
        -75, -73, "Sortie ski en famille (Chamrousse).", -80,
        { ivan: "⛷️", lena: "❄️" },
        [{ id: "seed-cmt1", userId: "ivan", userName: "Ivan/Isa", text: "Pensez aux chaînes, la météo annonce de la neige.", createdAt: addDays(today, -79) + "T11:04:00.000Z" }],
        -73
      ),
      booking(
        "seed-ivan-plage", "ivan", "Ivan/Isa", "definitive",
        -45, -42, "Week-end plage à Arcachon. Retour lundi.", -50,
        { mael: "🌊", lena: "🏖️" },
        [{ id: "seed-cmt2", userId: "lena", userName: "Lena/Lucas", text: "Les enfants adorent les dunes !", createdAt: addDays(today, -49) + "T18:30:00.000Z" }],
        -42
      ),
      booking(
        "seed-lena-vercors", "lena", "Lena/Lucas", "definitive",
        -20, -19, "Rando dans le Vercors, nuit au refuge.", -25,
        { mael: "🥾", ivan: "🏔️" },
        [],
        -19
      ),
      booking(
        "seed-mael-courses", "mael", "Maël/Salma", "provisional",
        12, 12, "Journée van pour courses + nettoyage.", 8,
        { lena: "🧹" },
        []
      ),
      booking(
        "seed-lena-surf", "lena", "Lena/Lucas", "definitive",
        25, 27, "Week-end surf côte basque. Départ vendredi 18h.", 18,
        { ivan: "🏄", mael: "🔥" },
        []
      ),
      booking(
        "seed-ivan-roadtrip", "ivan", "Ivan/Isa", "provisional",
        45, 47, "Road trip Provence, à confirmer selon dispo.", 35,
        { mael: "🌿" },
        []
      ),
      booking(
        "seed-ivan-vacances", "ivan", "Ivan/Isa", "definitive",
        85, 93, "Vacances été – Tour Bretagne nord.", 60,
        { mael: "🚐", lena: "🌞" },
        [{ id: "seed-cmt3", userId: "lena", userName: "Lena/Lucas", text: "Top, pensez à prendre le barbecue pliant.", createdAt: addDays(today, -59) + "T19:25:00.000Z" }]
      ),
    ];

    db.bookings = seedBookings;
    await writeDb(db);

    return res.json({ addedBookings: seedBookings.length });
  } catch (error) {
    console.error("Error seeding dev data:", error);
    return res.status(500).json({ message: "Erreur lors du peuplement des données" });
  }
});

router.post("/dev/push-test", async (req, res) => {
  try {
    if (!isLocalStorage && process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Route disponible uniquement en dev" });
    }

    const { targetUserId, fromUserId, title, body } = req.body as {
      targetUserId?: string;
      fromUserId?: string;
      title?: string;
      body?: string;
    };

    if (!targetUserId) {
      return res.status(400).json({ message: "targetUserId est requis" });
    }

    const db = await readDb();
    const targetUser = db.users.find((user) => user.id === targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: "Utilisateur cible introuvable" });
    }

    const senderName =
      db.users.find((user) => user.id === fromUserId)?.name ?? "Système";

    const { removedSubscriptionIds, attempted, delivered, failed } = await sendPushToUsers(db, [targetUserId], {
      title: title?.trim() || "🔔 Notification de test",
      body: body?.trim() || `Message envoyé par ${senderName}`,
      url: "/",
      tag: `dev-push-test-${targetUserId}-${Date.now()}`
    });

    if (removedSubscriptionIds.length > 0) {
      removeSubscriptionsById(db, removedSubscriptionIds);
      await writeDb(db);
    }

    if (attempted === 0) {
      return res.status(409).json({
        message: "Aucun appareil abonné pour cet utilisateur. Active d'abord les notifications sur le navigateur cible."
      });
    }

    if (delivered === 0 && failed > 0) {
      return res.status(502).json({
        message:
          "Échec d'envoi push. Vérifie la paire VAPID (publique/privée) et réactive les notifications sur le navigateur.",
        attempted,
        failed
      });
    }

    return res.status(200).json({
      message: `Notification envoyée à ${targetUser.name}`,
      attempted,
      delivered,
      failed
    });
  } catch (error) {
    console.error("Error sending dev push test:", error);
    return res.status(500).json({ message: "Erreur lors de l'envoi de la notification de test" });
  }
});

router.get("/dev/push-subscriptions", async (_req, res) => {
  try {
    if (!isLocalStorage && process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Route disponible uniquement en dev" });
    }

    const db = await readDb();
    return res.json(
      db.pushSubscriptions.map((subscription) => ({
        id: subscription.id,
        userId: subscription.userId,
        endpoint: subscription.endpoint,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt
      }))
    );
  } catch (error) {
    console.error("Error listing push subscriptions:", error);
    return res.status(500).json({ message: "Erreur lors de la lecture des abonnements push" });
  }
});

router.post("/bookings/:type", upload.array("photos", 10), async (req: Request<{ type: BookingType }>, res) => {
  try {
    const type = req.params.type;
    if (type !== "provisional" && type !== "definitive") {
      return res.status(400).json({ message: "Invalid booking type" });
    }

    const { date, startDate, endDate, userId, note, title } = req.body as {
      date?: string;
      startDate?: string;
      endDate?: string;
      userId?: string;
      note?: string;
      title?: string;
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
      const lastDotIndex = file.originalname.lastIndexOf(".");
      const extension = lastDotIndex > -1 ? file.originalname.substring(lastDotIndex) : "";
      const key = `uploads/${Date.now()}-${uuidv4()}${extension}`;
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
      title: resolveBookingTitle(dateKeys[0], dateKeys[dateKeys.length - 1], title),
      note: note ?? "",
      photoUrls,
      createdAt: new Date().toISOString(),
      reactions: {},
      comments: []
    };

    db.bookings.push(booking);
    await writeDb(db);

    const recipients = pickSubscribedUserIds(db).filter((id) => id !== userId);
    await notifyUsers(db, recipients, {
      title: "🗓️ Nouvelle réservation",
      body: `${user.name} a effectué une nouvelle réservation : ${booking.title}`,
      url: "/",
      tag: `booking-created-${booking.id}`
    });

    return res.status(201).json(booking);
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Error creating booking:", error);
    return res.status(500).json({ message: "Error creating booking" });
  }
});

router.put("/bookings/:id", upload.array("photos", 10), async (req: Request<{ id: string }>, res) => {
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
      title?: string;
      type?: BookingType;
      removePhotoUrls?: string;
      requesterUserId?: string;
    };

    const requesterUserId =
      typeof req.query.requesterUserId === "string"
        ? req.query.requesterUserId
        : payload.requesterUserId ?? currentBooking.userId;

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
      const lastDotIndex = file.originalname.lastIndexOf(".");
      const extension = lastDotIndex > -1 ? file.originalname.substring(lastDotIndex) : "";
      const key = `uploads/${Date.now()}-${uuidv4()}${extension}`;
      const url = await uploadFileToS3(file, key);
      addedPhotoUrls.push(url);
    }

    const nextPhotoUrls = [...keptPhotoUrls, ...addedPhotoUrls];

    const updatedBooking: Booking = {
      ...currentBooking,
      type: nextType,
      title: resolveBookingTitle(nextDateKeys[0], nextDateKeys[nextDateKeys.length - 1], payload.title ?? currentBooking.title),
      note: payload.note ?? currentBooking.note,
      startDate: nextDateKeys[0],
      endDate: nextDateKeys[nextDateKeys.length - 1],
      weekendKey: nextDateKeys[0],
      dateKeys: nextDateKeys,
      photoUrls: nextPhotoUrls
    };

    db.bookings[index] = updatedBooking;
    await writeDb(db);

    if (addedPhotoUrls.length > 0 && isPublishedBooking(updatedBooking)) {
      const recipients = db.users.map((user) => user.id).filter((id) => id !== requesterUserId);
      await notifyUsers(db, recipients, notificationMessages.newPhoto(updatedBooking.userName, updatedBooking.title, updatedBooking.id));
    }

    return res.json(updatedBooking);
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error("Error updating booking:", error);
    return res.status(500).json({ message: "Error updating booking" });
  }
});

router.delete("/bookings/:id", async (req: Request<{ id: string }>, res) => {
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

registerBookingInteractionRoutes(router, {
  normalizeBooking,
  notifyUsers
});

// Local mode uses root paths, production mode is proxied through /api.
app.use(router);
app.use('/api', router);

// Export handler wrapped with serverless-http
// Configure serverless-http to handle binary data correctly
// Reference: https://github.com/dougmoscrop/serverless-http#binary-types
// IMPORTANT: multipart/form-data contains binary files, so it must be treated as binary
// to prevent base64 double-encoding corruption of file data
export const handler = serverless(app, {
  binary: ['multipart/form-data'],
});

export default app;
