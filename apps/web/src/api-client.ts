import { Booking, PhotoItem, User } from "./types";
import { expectOk, parseApiErrorMessage } from "./http-errors";

export class ApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiClientError";
  }
}

type DevPushSubscriptionView = {
  id: string;
  userId: string;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
};

async function expectApiClientOk(response: Response, fallbackMessage: string): Promise<void> {
  await expectOk(response, fallbackMessage, (message) => new ApiClientError(message));
}

export async function fetchUsers(apiUrl: string): Promise<User[]> {
  const response = await fetch(`${apiUrl}/users`);
  await expectApiClientOk(response, "Erreur lors du chargement des utilisateurs");
  return (await response.json()) as User[];
}

export async function fetchBookingsAndPhotos(apiUrl: string): Promise<{ bookings: Booking[]; photos: PhotoItem[] }> {
  const [bookingsResponse, photosResponse] = await Promise.all([fetch(`${apiUrl}/bookings`), fetch(`${apiUrl}/photos`)]);

  await expectApiClientOk(bookingsResponse, "Erreur lors du chargement des réservations");
  await expectApiClientOk(photosResponse, "Erreur lors du chargement des photos");

  return {
    bookings: (await bookingsResponse.json()) as Booking[],
    photos: (await photosResponse.json()) as PhotoItem[]
  };
}

export async function fetchBooking(apiUrl: string, bookingId: string): Promise<Booking> {
  const response = await fetch(`${apiUrl}/bookings/${bookingId}`);
  await expectApiClientOk(response, "Réservation introuvable");
  return (await response.json()) as Booking;
}

export async function resetDevData(apiUrl: string): Promise<{ removedBookings: number; removedFiles: number }> {
  const response = await fetch(`${apiUrl}/dev/reset`, { method: "POST" });
  await expectApiClientOk(response, "Impossible de réinitialiser les données.");
  return (await response.json()) as { removedBookings: number; removedFiles: number };
}

export async function seedDevData(apiUrl: string): Promise<{ addedBookings: number }> {
  const response = await fetch(`${apiUrl}/dev/seed`, { method: "POST" });
  await expectApiClientOk(response, "Impossible de peupler les données.");
  return (await response.json()) as { addedBookings: number };
}

export async function sendDevPushTest(
  apiUrl: string,
  payload: { targetUserId: string; fromUserId?: string; title: string; body: string }
): Promise<string> {
  const response = await fetch(`${apiUrl}/dev/push-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new ApiClientError(await parseApiErrorMessage(response, "Erreur lors de l'envoi de la notification de test"));
  }

  const parsed = (await response.json().catch(() => ({}))) as { message?: string };
  return parsed.message ?? "Notification de test envoyée";
}

export async function fetchDevPushSubscriptions(apiUrl: string): Promise<DevPushSubscriptionView[]> {
  const response = await fetch(`${apiUrl}/dev/push-subscriptions`);
  if (!response.ok) {
    throw new ApiClientError(await parseApiErrorMessage(response, "Erreur de lecture des abonnements push"));
  }

  const payload = (await response.json().catch(() => [])) as DevPushSubscriptionView[];
  if (!Array.isArray(payload)) {
    throw new ApiClientError("Erreur de lecture des abonnements push");
  }

  return payload;
}

export async function deleteBooking(apiUrl: string, bookingId: string, requesterUserId: string): Promise<void> {
  const response = await fetch(`${apiUrl}/bookings/${bookingId}?requesterUserId=${encodeURIComponent(requesterUserId)}`, {
    method: "DELETE"
  });

  await expectApiClientOk(response, "Impossible de supprimer la réservation");
}

export async function addBookingComment(apiUrl: string, bookingId: string, userId: string, text: string): Promise<void> {
  const response = await fetch(`${apiUrl}/bookings/${bookingId}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ userId, text })
  });

  await expectApiClientOk(response, "Impossible d'ajouter le commentaire");
}

export async function updateBookingComment(
  apiUrl: string,
  bookingId: string,
  commentId: string,
  requesterUserId: string,
  text: string
): Promise<void> {
  const response = await fetch(
    `${apiUrl}/bookings/${bookingId}/comments/${commentId}?requesterUserId=${encodeURIComponent(requesterUserId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text })
    }
  );

  await expectApiClientOk(response, "Impossible de modifier le commentaire");
}

export async function deleteBookingComment(
  apiUrl: string,
  bookingId: string,
  commentId: string,
  requesterUserId: string
): Promise<void> {
  const response = await fetch(
    `${apiUrl}/bookings/${bookingId}/comments/${commentId}?requesterUserId=${encodeURIComponent(requesterUserId)}`,
    {
      method: "DELETE"
    }
  );

  await expectApiClientOk(response, "Impossible de supprimer le commentaire");
}

export type { DevPushSubscriptionView };
