import type { Booking } from "./s3-db.js";

export const notificationMessages = {
    newPublication: (booking: Booking) => ({
        title: "📣 Réservation publiée",
        body: `${booking.userName} · ${booking.startDate}${booking.startDate === booking.endDate ? "" : ` → ${booking.endDate}`}`,
        url: `/bookings/${booking.id}`,
        tag: `publication-new-${booking.id}` as string
    }),

    newComment: (commenterName: string, bookingTitle: string | undefined, bookingId: string) => ({
        title: "💬 Nouveau commentaire",
        body: `${commenterName} a commenté votre réservation : ${bookingTitle ?? ""}`,
        url: `/bookings/${bookingId}`,
        tag: `publication-comment-${bookingId}`
    }),

    newPhoto: (uploaderName: string | undefined, bookingTitle: string | undefined, bookingId: string) => ({
        title: "🖼️ Nouvelle photo",
        body: `${uploaderName ?? ""} a rajouté une nouvelle photo : ${bookingTitle ?? ""}`,
        url: `/bookings/${bookingId}`,
        tag: `publication-photo-${bookingId}`
    })
};
