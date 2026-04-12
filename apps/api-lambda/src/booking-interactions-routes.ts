import { Request, Response, Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { Booking, readDb, writeDb } from "./s3-db.js";
import { uniqueUserIds } from "./push.js";
import { notificationMessages } from "./notification-messages.js";

type NotifyPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type RegisterBookingInteractionRoutesDeps = {
  normalizeBooking: (booking: Booking) => Booking;
  notifyUsers: (db: Awaited<ReturnType<typeof readDb>>, userIds: string[], payload: NotifyPayload) => Promise<void>;
};

type DatabaseState = Awaited<ReturnType<typeof readDb>>;

function getRequesterUserId(req: Request): string {
  if (typeof req.query.requesterUserId === "string") {
    return req.query.requesterUserId;
  }

  const bodyRequester = (req.body as { requesterUserId?: string } | undefined)?.requesterUserId;
  return bodyRequester ?? "";
}

function normalizeCommentText(value: string | undefined): string {
  return (value ?? "").trim();
}

function findBookingOrReplyNotFound(db: DatabaseState, bookingId: string, res: Response): Booking | null {
  const booking = db.bookings.find((item) => item.id === bookingId);
  if (!booking) {
    res.status(404).json({ message: "Réservation introuvable" });
    return null;
  }

  return booking;
}

async function persistNormalizedBooking(db: DatabaseState, booking: Booking, normalized: Booking): Promise<void> {
  Object.assign(booking, normalized);
  await writeDb(db);
}

export function registerBookingInteractionRoutes(router: Router, deps: RegisterBookingInteractionRoutesDeps): void {
  const { normalizeBooking, notifyUsers } = deps;

  router.post("/bookings/:id/reactions", async (req: Request<{ id: string }>, res) => {
    try {
      const bookingId = req.params.id;
      const { userId, emoji } = req.body as { userId?: string; emoji?: string };

      if (!userId || !emoji) {
        return res.status(400).json({ message: "userId and emoji are required" });
      }

      const db = await readDb();
      const booking = findBookingOrReplyNotFound(db, bookingId, res);
      if (!booking) return;

      const normalized = normalizeBooking(booking);
      normalized.reactions[userId] = emoji;

      await persistNormalizedBooking(db, booking, normalized);

      return res.json(normalized);
    } catch (error) {
      console.error("Error adding reaction:", error);
      return res.status(500).json({ message: "Error adding reaction" });
    }
  });

  router.delete("/bookings/:id/reactions/:userId", async (req: Request<{ id: string; userId: string }>, res) => {
    try {
      const { id: bookingId, userId } = req.params;

      const db = await readDb();
      const booking = findBookingOrReplyNotFound(db, bookingId, res);
      if (!booking) return;

      const normalized = normalizeBooking(booking);
      delete normalized.reactions[userId];

      await persistNormalizedBooking(db, booking, normalized);

      return res.json(normalized);
    } catch (error) {
      console.error("Error removing reaction:", error);
      return res.status(500).json({ message: "Error removing reaction" });
    }
  });

  router.post("/bookings/:id/comments", async (req: Request<{ id: string }>, res) => {
    try {
      const bookingId = req.params.id;
      const { userId, text } = req.body as { userId?: string; text?: string };
      const normalizedText = normalizeCommentText(text);

      if (!userId || !normalizedText) {
        return res.status(400).json({ message: "userId and text are required" });
      }

      const db = await readDb();
      const booking = findBookingOrReplyNotFound(db, bookingId, res);
      if (!booking) return;

      const user = db.users.find((item) => item.id === userId);
      if (!user) {
        return res.status(404).json({ message: "Unknown user" });
      }

      const normalized = normalizeBooking(booking);
      const comment = {
        id: uuidv4(),
        userId,
        userName: user.name,
        text: normalizedText,
        createdAt: new Date().toISOString()
      };

      normalized.comments.push(comment);

      await persistNormalizedBooking(db, booking, normalized);

      const priorCommenterIds = normalized.comments.map((item) => item.userId);
      const recipients = uniqueUserIds([normalized.userId, ...priorCommenterIds]).filter((id) => id !== userId);
      await notifyUsers(db, recipients, notificationMessages.newComment(user.name, normalized.title, normalized.id));

      return res.status(201).json(comment);
    } catch (error) {
      console.error("Error adding comment:", error);
      return res.status(500).json({ message: "Error adding comment" });
    }
  });

  router.patch("/bookings/:bookingId/comments/:commentId", async (req: Request<{ bookingId: string; commentId: string }>, res) => {
    try {
      const { bookingId, commentId } = req.params;
      const { userId, text } = req.body as { userId?: string; text?: string };
      const requesterUserId = getRequesterUserId(req) || userId || "";
      const normalizedText = normalizeCommentText(text);

      if (!requesterUserId || !normalizedText) {
        return res.status(400).json({ message: "requesterUserId and text are required" });
      }

      const db = await readDb();
      const booking = findBookingOrReplyNotFound(db, bookingId, res);
      if (!booking) return;

      const normalized = normalizeBooking(booking);
      const comment = normalized.comments.find((item) => item.id === commentId);

      if (!comment) {
        return res.status(404).json({ message: "Comment not found" });
      }

      if (comment.userId !== requesterUserId) {
        return res.status(403).json({ message: "Vous ne pouvez modifier que vos propres commentaires" });
      }

      comment.text = normalizedText;
      comment.updatedAt = new Date().toISOString();

      await persistNormalizedBooking(db, booking, normalized);

      return res.status(200).json(comment);
    } catch (error) {
      console.error("Error updating comment:", error);
      return res.status(500).json({ message: "Error updating comment" });
    }
  });

  router.delete("/bookings/:bookingId/comments/:commentId", async (req: Request<{ bookingId: string; commentId: string }>, res) => {
    try {
      const { bookingId, commentId } = req.params;
      const requesterUserId = getRequesterUserId(req);

      if (!requesterUserId) {
        return res.status(400).json({ message: "requesterUserId is required" });
      }

      const db = await readDb();
      const booking = findBookingOrReplyNotFound(db, bookingId, res);
      if (!booking) return;

      const normalized = normalizeBooking(booking);
      const commentIndex = normalized.comments.findIndex((item) => item.id === commentId);

      if (commentIndex === -1) {
        return res.status(404).json({ message: "Comment not found" });
      }

      const comment = normalized.comments[commentIndex];
      if (comment.userId !== requesterUserId) {
        return res.status(403).json({ message: "Vous ne pouvez supprimer que vos propres commentaires" });
      }

      normalized.comments.splice(commentIndex, 1);

      await persistNormalizedBooking(db, booking, normalized);

      return res.status(204).send();
    } catch (error) {
      console.error("Error deleting comment:", error);
      return res.status(500).json({ message: "Error deleting comment" });
    }
  });
}
