import { Router } from "express";
import { readDb, writeDb } from "./s3-db.js";
import {
  findSubscriptionByUserAndEndpoint,
  hasOtherUsersForEndpoint,
  getPublicVapidKey,
  isPushConfigured,
  removeSubscription,
  upsertSubscription
} from "./push.js";

type PushSubscriptionInput = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function parseSubscribePayload(body: unknown): { userId: string; subscription: PushSubscriptionInput } | null {
  const payload = body as {
    userId?: string;
    subscription?: {
      endpoint?: string;
      expirationTime?: number | null;
      keys?: {
        p256dh?: string;
        auth?: string;
      };
    };
  };

  if (
    !payload?.userId ||
    !payload.subscription?.endpoint ||
    !payload.subscription.keys?.p256dh ||
    !payload.subscription.keys?.auth
  ) {
    return null;
  }

  return {
    userId: payload.userId,
    subscription: {
      endpoint: payload.subscription.endpoint,
      expirationTime: payload.subscription.expirationTime ?? null,
      keys: {
        p256dh: payload.subscription.keys.p256dh,
        auth: payload.subscription.keys.auth
      }
    }
  };
}

function parseUnsubscribePayload(body: unknown): { userId: string; endpoint: string } | null {
  const payload = body as { userId?: string; endpoint?: string };
  if (!payload?.userId || !payload.endpoint) {
    return null;
  }

  return {
    userId: payload.userId,
    endpoint: payload.endpoint
  };
}

export function registerPushRoutes(router: Router): void {
  router.get("/push/public-key", (_req, res) => {
    if (!isPushConfigured()) {
      return res.status(503).json({ message: "Push notifications are not configured" });
    }

    return res.json({ publicKey: getPublicVapidKey() });
  });

  router.get("/push/status", async (req, res) => {
    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId : "";
      const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : "";

      if (!userId || !endpoint) {
        return res.status(400).json({ message: "userId and endpoint are required" });
      }

      const db = await readDb();
      const subscription = findSubscriptionByUserAndEndpoint(db, userId, endpoint);

      return res.json({
        subscribed: Boolean(subscription),
        subscribedUserId: subscription?.userId ?? null
      });
    } catch (error) {
      console.error("Error reading push status:", error);
      return res.status(500).json({ message: "Error reading push status" });
    }
  });

  router.post("/push/subscribe", async (req, res) => {
    try {
      const parsedPayload = parseSubscribePayload(req.body);
      if (!parsedPayload) {
        return res.status(400).json({ message: "userId and a valid push subscription are required" });
      }

      const db = await readDb();
      const userExists = db.users.some((user) => user.id === parsedPayload.userId);
      if (!userExists) {
        return res.status(404).json({ message: "Unknown user" });
      }

      upsertSubscription(db, parsedPayload.userId, parsedPayload.subscription);

      await writeDb(db);
      return res.status(204).send();
    } catch (error) {
      console.error("Error subscribing to push:", error);
      return res.status(500).json({ message: "Error subscribing to push" });
    }
  });

  router.post("/push/unsubscribe", async (req, res) => {
    try {
      const parsedPayload = parseUnsubscribePayload(req.body);
      if (!parsedPayload) {
        return res.status(400).json({ message: "userId and endpoint are required" });
      }

      const db = await readDb();
      const othersRemain = hasOtherUsersForEndpoint(db, parsedPayload.userId, parsedPayload.endpoint);
      removeSubscription(db, parsedPayload.userId, parsedPayload.endpoint);
      await writeDb(db);
      return res.json({ shouldUnsubscribeBrowser: !othersRemain });
    } catch (error) {
      console.error("Error unsubscribing from push:", error);
      return res.status(500).json({ message: "Error unsubscribing from push" });
    }
  });
}
