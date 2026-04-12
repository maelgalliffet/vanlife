import webpush from "web-push";
import { createECDH } from "node:crypto";
import { Database, PushSubscriptionRecord } from "./s3-db.js";

const DEV_VAPID_PUBLIC_KEY =
    "BA8Got6xEWx0D9-HPNDM2pgTwqq3LEsxOFJTQwOLyxuZ5DtyPCWhisTIg1Mk4uhZoiVRqSV_le0NUYHU_QryJDY";
const DEV_VAPID_PRIVATE_KEY = "xG4Y9xEcWmXHXVqsgzVqnP72nT4AvPPgNqgDKB6D_w0";

function base64UrlToBuffer(value: string): Buffer {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4)) % 4), "base64");
}

function bufferToBase64Url(value: Buffer): string {
    return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function derivePublicVapidKey(privateKey: string): string {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(base64UrlToBuffer(privateKey));
    return bufferToBase64Url(ecdh.getPublicKey(undefined, "uncompressed"));
}

const vapidPublicKey = process.env.PUSH_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.PUSH_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY;
const isLocalDev = process.env.LOCAL_DEV === "true";

function resolveVapidKeys(): { publicKey?: string; privateKey?: string } {
    if (vapidPublicKey && vapidPrivateKey) {
        return { publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
    }

    if (!vapidPublicKey && vapidPrivateKey) {
        return { publicKey: derivePublicVapidKey(vapidPrivateKey), privateKey: vapidPrivateKey };
    }

    if (isLocalDev) {
        if (vapidPublicKey && !vapidPrivateKey) {
            console.warn("[PUSH] Public VAPID key provided without private key in LOCAL_DEV; using bundled dev key pair");
        }
        return { publicKey: DEV_VAPID_PUBLIC_KEY, privateKey: DEV_VAPID_PRIVATE_KEY };
    }

    return { publicKey: vapidPublicKey ?? undefined, privateKey: vapidPrivateKey ?? undefined };
}

const { publicKey: resolvedPublicKey, privateKey: resolvedPrivateKey } = resolveVapidKeys();

const hasValidVapidPair =
    Boolean(resolvedPublicKey && resolvedPrivateKey) && derivePublicVapidKey(resolvedPrivateKey!) === resolvedPublicKey;

const notificationsEnabled = Boolean(resolvedPublicKey && resolvedPrivateKey) && hasValidVapidPair;

if (resolvedPublicKey && resolvedPrivateKey && !hasValidVapidPair) {
    console.error("[PUSH] Invalid VAPID configuration: public key does not match private key");
}

if (notificationsEnabled) {
    webpush.setVapidDetails(
        process.env.PUSH_VAPID_SUBJECT || "mailto:dev@vanlife.local",
        resolvedPublicKey!,
        resolvedPrivateKey!
    );
}

export function isPushConfigured(): boolean {
    return notificationsEnabled;
}

export function getPublicVapidKey(): string | null {
    return resolvedPublicKey ?? null;
}

export type PushPayload = {
    title: string;
    body: string;
    url?: string;
    tag?: string;
};

function isWindowsPushEndpoint(endpoint: string): boolean {
    return endpoint.includes("notify.windows.com");
}

export async function sendPushToUsers(
    db: Database,
    userIds: string[],
    payload: PushPayload,
    options?: { excludedEndpoints?: string[]; excludedUserEndpoints?: Map<string, string> }
): Promise<{ removedSubscriptionIds: string[]; attempted: number; delivered: number; failed: number }> {
    if (!notificationsEnabled || userIds.length === 0) {
        return { removedSubscriptionIds: [], attempted: 0, delivered: 0, failed: 0 };
    }

    const targetUserIds = new Set(userIds);
    const excludedEndpoints = new Set(options?.excludedEndpoints ?? []);
    const excludedUserEndpoints = options?.excludedUserEndpoints ?? new Map();
    const records = db.pushSubscriptions.filter(
        (subscription) => {
            if (!targetUserIds.has(subscription.userId)) {
                return false;
            }
            // Exclude if endpoint is in the global excludedEndpoints list
            if (excludedEndpoints.has(subscription.endpoint)) {
                return false;
            }
            // Exclude if this specific (userId, endpoint) pair is excluded
            if (excludedUserEndpoints.get(subscription.userId) === subscription.endpoint) {
                return false;
            }
            return true;
        }
    );

    const removedSubscriptionIds: string[] = [];
    let delivered = 0;
    let failed = 0;

    await Promise.all(
        records.map(async (record) => {
            try {
                await webpush.sendNotification(record.subscription as any, JSON.stringify(payload));
                delivered += 1;
            } catch (error: any) {
                failed += 1;
                const statusCode = Number(error?.statusCode ?? 0);
                const responseBody = error?.body || error?.response?.body || "";
                const isWnsUnauthorized = statusCode === 401 && isWindowsPushEndpoint(record.endpoint);
                const isStaleSubscription = statusCode === 400 || statusCode === 404 || statusCode === 410 || isWnsUnauthorized;

                if (isStaleSubscription) {
                    removedSubscriptionIds.push(record.id);
                    console.warn("[PUSH] Removing stale subscription", {
                        userId: record.userId,
                        endpoint: record.endpoint,
                        statusCode,
                        responseBody
                    });
                    return;
                }

                console.error("[PUSH] Failed to send notification", {
                    userId: record.userId,
                    endpoint: record.endpoint,
                    statusCode,
                    responseBody,
                    error: error?.message || error
                });
            }
        })
    );

    return { removedSubscriptionIds, attempted: records.length, delivered, failed };
}

export function uniqueUserIds(items: Array<string | undefined | null>): string[] {
    return [...new Set(items.filter((item): item is string => Boolean(item)))];
}

export function findSubscriptionByEndpoint(db: Database, endpoint: string): PushSubscriptionRecord | null {
    return db.pushSubscriptions.find((subscription) => subscription.endpoint === endpoint) ?? null;
}

export function findSubscriptionByUserAndEndpoint(
    db: Database,
    userId: string,
    endpoint: string
): PushSubscriptionRecord | null {
    return (
        db.pushSubscriptions.find(
            (subscription) => subscription.userId === userId && subscription.endpoint === endpoint
        ) ?? null
    );
}

export function hasOtherUsersForEndpoint(db: Database, userId: string, endpoint: string): boolean {
    return db.pushSubscriptions.some(
        (subscription) => subscription.endpoint === endpoint && subscription.userId !== userId
    );
}

export function removeSubscriptionsById(db: Database, ids: string[]) {
    if (ids.length === 0) return;
    const target = new Set(ids);
    db.pushSubscriptions = db.pushSubscriptions.filter((subscription) => !target.has(subscription.id));
}

export function pickSubscribedUserIds(db: Database): string[] {
    return uniqueUserIds(db.pushSubscriptions.map((subscription) => subscription.userId));
}

export function upsertSubscription(
    db: Database,
    userId: string,
    subscription: PushSubscriptionRecord["subscription"]
): PushSubscriptionRecord {
    const now = new Date().toISOString();
    const existing = db.pushSubscriptions.find(
        (record) => record.userId === userId && record.endpoint === subscription.endpoint
    );

    if (existing) {
        existing.userId = userId;
        existing.endpoint = subscription.endpoint;
        existing.subscription = subscription;
        existing.updatedAt = now;
        return existing;
    }

    const record: PushSubscriptionRecord = {
        id: crypto.randomUUID(),
        userId,
        endpoint: subscription.endpoint,
        subscription,
        createdAt: now,
        updatedAt: now
    };

    db.pushSubscriptions.push(record);
    return record;
}

export function removeSubscription(db: Database, userId: string, endpoint: string): boolean {
    const before = db.pushSubscriptions.length;
    db.pushSubscriptions = db.pushSubscriptions.filter(
        (subscription) => !(subscription.userId === userId && subscription.endpoint === endpoint)
    );
    return db.pushSubscriptions.length < before;
}
