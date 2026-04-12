import { useCallback, useEffect, useMemo, useState } from "react";
import { parseApiErrorMessage } from "./http-errors";

type PushStatusResponse = {
  subscribed: boolean;
};

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return buffer;
}

function uint8ArrayToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 1) {
    binary += String.fromCharCode(value[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function fetchPublicKey(apiUrl: string): Promise<string> {
  const response = await fetch(`${apiUrl}/push/public-key`);
  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Push notifications indisponibles"));
  }

  const payload = (await response.json()) as { publicKey?: string };
  if (!payload.publicKey) {
    throw new Error("Clé publique push manquante");
  }

  return payload.publicKey;
}

async function ensureValidBrowserSubscription(
  registration: ServiceWorkerRegistration,
  publicKey: string
): Promise<PushSubscription | null> {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }

  const key = subscription.options.applicationServerKey;
  if (!key) {
    return subscription;
  }

  const currentKey = uint8ArrayToBase64Url(new Uint8Array(key));
  if (currentKey === publicKey) {
    return subscription;
  }

  await subscription.unsubscribe();
  return null;
}

async function fetchPushStatus(apiUrl: string, userId: string, endpoint: string): Promise<PushStatusResponse> {
  const search = new URLSearchParams({ userId, endpoint });
  const response = await fetch(`${apiUrl}/push/status?${search.toString()}`);

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Impossible de vérifier le statut push"));
  }

  return (await response.json()) as PushStatusResponse;
}

async function getPushContext(apiUrl: string): Promise<{
  registration: ServiceWorkerRegistration;
  publicKey: string;
  subscription: PushSubscription | null;
}> {
  const registration = await getServiceWorkerRegistration();
  const publicKey = await fetchPublicKey(apiUrl);
  const subscription = await ensureValidBrowserSubscription(registration, publicKey);

  return { registration, publicKey, subscription };
}

async function subscribeCurrentUser(apiUrl: string, userId: string, subscription: PushSubscription): Promise<void> {
  const response = await fetch(`${apiUrl}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      subscription: subscription.toJSON()
    })
  });

  if (!response.ok) {
    throw new Error(await parseApiErrorMessage(response, "Impossible d'activer les notifications"));
  }
}

export function usePushNotifications(apiUrl: string, currentUserId: string) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState("");

  const isPushSupported = useMemo(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    []
  );

  const syncPushStatus = useCallback(async () => {
    if (!isPushSupported || !currentUserId) {
      setPushEnabled(false);
      setPushError("");
      return;
    }

    try {
      setPushError("");
      const { subscription } = await getPushContext(apiUrl);

      if (!subscription) {
        setPushEnabled(false);
        return;
      }

      const status = await fetchPushStatus(apiUrl, currentUserId, subscription.endpoint);
      setPushEnabled(status.subscribed);
    } catch (error) {
      setPushEnabled(false);
      setPushError(error instanceof Error ? error.message : "Erreur notifications push");
    }
  }, [apiUrl, currentUserId, isPushSupported]);

  useEffect(() => {
    void syncPushStatus();
  }, [syncPushStatus]);

  const togglePushSubscription = useCallback(async () => {
    if (!isPushSupported) {
      setPushError("Navigateur non compatible push");
      return;
    }

    if (!currentUserId) {
      setPushError("Sélectionnez un utilisateur pour activer les notifications");
      return;
    }

    setPushLoading(true);
    setPushError("");

    try {
      const { registration, publicKey, subscription: existingSubscription } = await getPushContext(apiUrl);
      let subscription = existingSubscription;

      if (subscription) {
        const status = await fetchPushStatus(apiUrl, currentUserId, subscription.endpoint);

        if (status.subscribed) {
          const response = await fetch(`${apiUrl}/push/unsubscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUserId, endpoint: subscription.endpoint })
          });

          if (!response.ok) {
            throw new Error(await parseApiErrorMessage(response, "Impossible de désactiver les notifications"));
          }

          const payload = (await response.json().catch(() => ({}))) as { shouldUnsubscribeBrowser?: boolean };
          if (payload.shouldUnsubscribeBrowser) {
            await subscription.unsubscribe();
          }

          setPushEnabled(false);
          return;
        }

        await subscribeCurrentUser(apiUrl, currentUserId, subscription);
        setPushEnabled(true);
        return;
      }

      if (Notification.permission === "denied") {
        throw new Error("Les notifications sont bloquées par le navigateur");
      }

      const permission =
        Notification.permission === "granted" ? Notification.permission : await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Autorisez les notifications pour continuer");
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToArrayBuffer(publicKey)
      });

      await subscribeCurrentUser(apiUrl, currentUserId, subscription);

      setPushEnabled(true);
    } catch (error) {
      setPushError(error instanceof Error ? error.message : "Erreur notifications push");
    } finally {
      setPushLoading(false);
    }
  }, [apiUrl, currentUserId, isPushSupported]);

  return {
    isPushSupported,
    pushEnabled,
    pushLoading,
    pushError,
    togglePushSubscription
  };
}
