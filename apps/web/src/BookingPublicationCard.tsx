import { ReactNode } from "react";
import { Booking } from "./types";

function formatStay(startDate: string, endDate: string): string {
    return startDate === endDate ? startDate : `${startDate} → ${endDate}`;
}

type BookingPublicationCardProps = {
    booking: Booking;
    userThemeClass: (name: string) => string;
    onPhotoClick: (urls: string[], index: number) => void;
    renderComments: (booking: Booking) => ReactNode;
    renderActions?: (booking: Booking) => ReactNode;
    className?: string;
};

export function BookingPublicationCard({
    booking,
    userThemeClass,
    onPhotoClick,
    renderComments,
    renderActions,
    className = ""
}: BookingPublicationCardProps) {
    return (
        <article className={`post-card ${userThemeClass(booking.userName)} ${className}`.trim()}>
            <header className="post-header">
                <p className="post-title">
                    <strong>{booking.title}</strong>
                </p>
            </header>

            <p className="post-meta">
                <strong>{booking.userName}</strong> · {formatStay(booking.startDate, booking.endDate)}
            </p>

            <p className="post-note">{booking.note || "Aucune note"}</p>

            {booking.photoUrls.length > 0 && (
                <div className="post-photos">
                    {booking.photoUrls.map((url, index) => (
                        <button key={url} className="post-photo-btn" onClick={() => onPhotoClick(booking.photoUrls, index)} aria-label="Voir en grand">
                            <img src={url} alt={`Photo ${booking.userName}`} loading="lazy" />
                        </button>
                    ))}
                </div>
            )}

            {renderComments(booking)}
            {renderActions ? renderActions(booking) : null}
        </article>
    );
}