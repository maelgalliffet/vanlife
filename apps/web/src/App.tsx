import { FormEvent, useEffect, useMemo, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Booking, BookingType, PhotoItem, User } from "./types";

// Construire l'API URL de manière dynamique à l'exécution
// En production, utiliser VITE_API_URL variable d'environnement
// En développement, utiliser localhost:4000
const getApiUrl = () => {
  // Si on est en dev (Vite dev server)
  if (import.meta.env.DEV) {
    return "http://localhost:4000";
  }
  // En production, utiliser l'URL définie à la build time (VITE_API_URL)
  // Par défaut: API Gateway Lambda
  return import.meta.env.VITE_API_URL || "https://l9tfi28yik.execute-api.eu-west-3.amazonaws.com/prod";
};

const API_URL = getApiUrl();
const STORAGE_KEY = "vanlife-current-user-id";
const IS_DEV = import.meta.env.DEV;

function toDateKey(input: Date): string {
  const localDate = new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
  return localDate.toISOString().slice(0, 10);
}

function getDateKeysBetween(start: Date, end: Date): string[] {
  const startDate = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
  const endDate = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()));
  if (endDate.getTime() < startDate.getTime()) {
    return [];
  }

  const keys: string[] = [];
  const current = new Date(startDate);
  while (current.getTime() <= endDate.getTime()) {
    keys.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return keys;
}

function formatStay(startDate: string, endDate: string): string {
  return startDate === endDate ? startDate : `${startDate} → ${endDate}`;
}

function getEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function getFrenchHolidayName(input: Date): string | null {
  const year = input.getFullYear();
  const key = toDateKey(input);

  const easter = getEasterDate(year);

  const holidays = new Map<string, string>([
    [`${year}-01-01`, "Jour de l'An"],
    [toDateKey(addDays(easter, 1)), "Lundi de Pâques"],
    [`${year}-05-01`, "Fête du Travail"],
    [`${year}-05-08`, "Victoire 1945"],
    [toDateKey(addDays(easter, 39)), "Ascension"],
    [toDateKey(addDays(easter, 50)), "Lundi de Pentecôte"],
    [`${year}-07-14`, "Fête nationale"],
    [`${year}-08-15`, "Assomption"],
    [`${year}-11-01`, "Toussaint"],
    [`${year}-11-11`, "Armistice"],
    [`${year}-12-25`, "Noël"]
  ]);

  return holidays.get(key) ?? null;
}

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [chosenIdentity, setChosenIdentity] = useState<string>("");
  const [reservationType, setReservationType] = useState<BookingType>("provisional");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [devMessage, setDevMessage] = useState<string>("");
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editType, setEditType] = useState<BookingType>("provisional");
  const [editNote, setEditNote] = useState("");
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
  const [editNewFiles, setEditNewFiles] = useState<FileList | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingBooking, setIsDeletingBooking] = useState(false);
  const [editError, setEditError] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [showBookingPopup, setShowBookingPopup] = useState(false);

  useEffect(() => {
    void loadUsers();
    void refreshData();
  }, []);

  async function loadUsers() {
    const response = await fetch(`${API_URL}/users`);
    const payload = (await response.json()) as User[];
    setUsers(payload);
    if (!currentUserId && payload.length > 0) {
      setChosenIdentity(payload[0].id);
    }
  }

  async function refreshData() {
    const [bookingsResponse, photosResponse] = await Promise.all([
      fetch(`${API_URL}/bookings`),
      fetch(`${API_URL}/photos`)
    ]);

    setBookings((await bookingsResponse.json()) as Booking[]);
    setPhotos((await photosResponse.json()) as PhotoItem[]);
  }

  const selectedRange = useMemo(() => {
    if (!rangeStart) {
      return null;
    }

    return {
      start: rangeStart,
      end: rangeEnd ?? rangeStart
    };
  }, [rangeEnd, rangeStart]);

  const hasCompleteRange = Boolean(rangeStart && rangeEnd);

  const selectedDateKeys = useMemo(
    () => (selectedRange ? getDateKeysBetween(selectedRange.start, selectedRange.end) : []),
    [selectedRange]
  );

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const upcomingBookings = useMemo(
    () =>
      [...bookings]
        .filter((booking) => booking.endDate >= todayKey)
        .sort((left, right) => left.startDate.localeCompare(right.startDate)),
    [bookings, todayKey]
  );
  const pastBookings = useMemo(
    () =>
      [...bookings]
        .filter((booking) => booking.endDate < todayKey)
        .sort((left, right) => right.endDate.localeCompare(left.endDate)),
    [bookings, todayKey]
  );

  async function submitBooking(event: FormEvent) {
    event.preventDefault();
    if (!currentUserId) {
      setError("Sélectionne ton identité d'abord");
      return;
    }

    if (!rangeStart || !rangeEnd) {
      setError("Sélectionne une plage complète (début puis fin)");
      return;
    }

    setIsSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("startDate", toDateKey(rangeStart));
    formData.append("endDate", toDateKey(rangeEnd));
    formData.append("userId", currentUserId);
    formData.append("note", note);

    if (files) {
      for (const file of Array.from(files)) {
        formData.append("photos", file);
      }
    }

    const response = await fetch(`${API_URL}/bookings/${reservationType}`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setError(payload.message ?? "Erreur lors de la réservation");
      setIsSubmitting(false);
      return;
    }

    setNote("");
    setFiles(null);
    setRangeStart(null);
    setRangeEnd(null);
    setShowBookingPopup(false);
    await refreshData();
    setIsSubmitting(false);
  }

  function confirmIdentity() {
    const selected = chosenIdentity || users[0]?.id;
    if (!selected) {
      return;
    }

    setActiveUser(selected);
  }

  function setActiveUser(userId: string) {
    setCurrentUserId(userId);
    localStorage.setItem(STORAGE_KEY, userId);
  }

  function userName(userId: string): string {
    return users.find((user) => user.id === userId)?.name ?? "Inconnu";
  }

  function userThemeClass(name: string): string {
    const normalized = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes("mael") && normalized.includes("salma")) {
      return "user-theme-mael-salma";
    }

    if (normalized.includes("lena") && normalized.includes("lucas")) {
      return "user-theme-lena-lucas";
    }

    if (normalized.includes("ivan") && normalized.includes("isa")) {
      return "user-theme-ivan-isa";
    }

    return "";
  }

  function handleDayClick(day: Date) {
    if (!rangeStart || rangeEnd) {
      setRangeStart(day);
      setRangeEnd(null);
      return;
    }

    if (day.getTime() < rangeStart.getTime()) {
      setRangeStart(day);
      setRangeEnd(null);
      return;
    }

    setRangeEnd(day);
  }

  function clearSelection() {
    setRangeStart(null);
    setRangeEnd(null);
    setError("");
  }

  async function resetDevData() {
    const confirmed = window.confirm(
      "Réinitialiser les données de dev ? Cela supprime toutes les réservations et les photos uploadées."
    );

    if (!confirmed) {
      return;
    }

    setIsResetting(true);
    setDevMessage("");

    const response = await fetch(`${API_URL}/dev/reset`, { method: "POST" });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setDevMessage(payload.message ?? "Impossible de réinitialiser les données.");
      setIsResetting(false);
      return;
    }

    const payload = (await response.json()) as { removedBookings: number; removedFiles: number };
    setRangeStart(null);
    setRangeEnd(null);
    setActiveBooking(null);
    await refreshData();
    setDevMessage(`Réinitialisation effectuée: ${payload.removedBookings} réservations, ${payload.removedFiles} photos supprimées.`);
    setIsResetting(false);
  }

  useEffect(() => {
    if (!activeBooking) {
      setEditError("");
      return;
    }

    setEditStartDate(activeBooking.startDate);
    setEditEndDate(activeBooking.endDate);
    setEditType(activeBooking.type);
    setEditNote(activeBooking.note);
    setEditPhotoUrls(activeBooking.photoUrls);
    setEditNewFiles(null);
    setEditError("");
  }, [activeBooking]);

  function openBookingEditor(booking: Booking) {
    setActiveBooking(booking);
  }

  function openBookingCreationPopup() {
    if (!currentUserId) {
      setError("Sélectionne ton identité d'abord");
      return;
    }

    if (!rangeStart || !rangeEnd) {
      setError("Sélectionne une plage complète (début puis fin)");
      return;
    }

    setShowBookingPopup(true);
  }

  async function saveBookingEdits() {
    if (!activeBooking) {
      return;
    }

    if (!currentUserId || activeBooking.userId !== currentUserId) {
      setEditError("Seul le créateur peut modifier cette réservation");
      return;
    }

    if (!editStartDate || !editEndDate) {
      setEditError("Renseigne une date de début et de fin");
      return;
    }

    setIsSavingEdit(true);
    setEditError("");

    const removePhotoUrls = activeBooking.photoUrls.filter((url) => !editPhotoUrls.includes(url));

    const formData = new FormData();
    formData.append("startDate", editStartDate);
    formData.append("endDate", editEndDate);
    formData.append("type", editType);
    formData.append("note", editNote);
    formData.append("removePhotoUrls", JSON.stringify(removePhotoUrls));

    if (editNewFiles) {
      for (const file of Array.from(editNewFiles)) {
        formData.append("photos", file);
      }
    }

    const response = await fetch(`${API_URL}/bookings/${activeBooking.id}`, {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setEditError(payload.message ?? "Impossible de modifier la réservation");
      setIsSavingEdit(false);
      return;
    }

    const updatedBooking = (await response.json()) as Booking;
    await refreshData();
    setActiveBooking(updatedBooking);
    setIsSavingEdit(false);
  }

  async function deleteBooking() {
    if (!activeBooking) {
      return;
    }

    if (!currentUserId || activeBooking.userId !== currentUserId) {
      setEditError("Seul le créateur peut supprimer cette réservation");
      return;
    }

    const confirmed = window.confirm("Supprimer cette réservation et ses photos ?");
    if (!confirmed) {
      return;
    }

    setIsDeletingBooking(true);
    setEditError("");

    const response = await fetch(
      `${API_URL}/bookings/${activeBooking.id}?requesterUserId=${encodeURIComponent(currentUserId)}`,
      {
        method: "DELETE"
      }
    );

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setEditError(payload.message ?? "Impossible de supprimer la réservation");
      setIsDeletingBooking(false);
      return;
    }

    await refreshData();
    setActiveBooking(null);
    setIsDeletingBooking(false);
  }

  async function deleteBookingFromList(booking: Booking) {
    if (!currentUserId || booking.userId !== currentUserId) {
      return;
    }

    const confirmed = window.confirm("Supprimer cette réservation et ses photos ?");
    if (!confirmed) {
      return;
    }

    const response = await fetch(
      `${API_URL}/bookings/${booking.id}?requesterUserId=${encodeURIComponent(currentUserId)}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      return;
    }

    await refreshData();
  }

  async function addComment(bookingId: string) {
    if (!currentUserId) {
      return;
    }

    const draft = (commentDrafts[bookingId] ?? "").trim();
    if (!draft) {
      return;
    }

    const response = await fetch(`${API_URL}/bookings/${bookingId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ userId: currentUserId, text: draft })
    });

    if (!response.ok) {
      return;
    }

    setCommentDrafts((current) => ({ ...current, [bookingId]: "" }));
    await refreshData();
  }

  const bookingsByDate = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      for (const dateKey of booking.dateKeys) {
        const current = map.get(dateKey) ?? [];
        current.push(booking);
        map.set(dateKey, current);
      }
    }
    return map;
  }, [bookings]);

  return (
    <div className="page">
      {!currentUserId && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Qui êtes-vous ?</h2>
            <p>Sélectionnez votre nom pour continuer.</p>
            <select value={chosenIdentity} onChange={(event) => setChosenIdentity(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <button onClick={confirmIdentity} type="button">
              Continuer
            </button>
          </div>
        </div>
      )}

      <header>
        <h1>Réservation week-end van</h1>
        <div className="current-user-row">
          <span>Connecté en tant que:</span>
          <select
            value={currentUserId}
            onChange={(event) => setActiveUser(event.target.value)}
            disabled={users.length === 0}
          >
            {!currentUserId && <option value="">Non défini</option>}
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="layout">
        <section className="card calendar-card">
          <h2>Calendrier</h2>
          <Calendar
            locale="fr-FR"
            showNeighboringMonth
            showFixedNumberOfWeeks
            onClickDay={handleDayClick}
            value={
              rangeStart
                ? rangeEnd
                  ? [rangeStart, rangeEnd]
                  : rangeStart
                : null
            }
            tileClassName={({ date, view }) => {
              if (view !== "month") {
                return undefined;
              }

              if (!selectedRange) {
                const baseClasses: string[] = [];
                const dayOfWeek = date.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                  baseClasses.push("weekend-day");
                }
                if (getFrenchHolidayName(date)) {
                  baseClasses.push("holiday-day");
                }
                return baseClasses.length > 0 ? baseClasses.join(" ") : undefined;
              }

              const dayKey = toDateKey(date);
              const startKey = toDateKey(selectedRange.start);
              const endKey = toDateKey(selectedRange.end);
              const classes: string[] = [];

              const dayOfWeek = date.getDay();
              if (dayOfWeek === 0 || dayOfWeek === 6) {
                classes.push("weekend-day");
              }

              const holidayName = getFrenchHolidayName(date);
              if (holidayName) {
                classes.push("holiday-day");
              }

              if (dayKey === startKey && dayKey === endKey) {
                classes.push("custom-range-single");
              }
              if (dayKey === startKey && dayKey !== endKey) {
                classes.push("custom-range-start");
              }
              if (dayKey === endKey && dayKey !== startKey) {
                classes.push("custom-range-end");
              }
              if (dayKey > startKey && dayKey < endKey) {
                classes.push("custom-range-middle");
              }

              return classes.length > 0 ? classes.join(" ") : undefined;
            }}
            tileContent={({ date }) => {
              const key = toDateKey(date);
              const dayBookings = bookingsByDate.get(key) ?? [];
              const holidayName = getFrenchHolidayName(date);

              if (dayBookings.length === 0 && !holidayName) {
                return null;
              }

              if (dayBookings.length === 0) {
                return <div className="tile-indicators holiday-only">{holidayName && <span className="holiday-name">{holidayName}</span>}</div>;
              }

              return (
                <div className="tile-indicators">
                  {holidayName && <span className="holiday-name">{holidayName}</span>}
                  {dayBookings.slice(0, 2).map((booking) => (
                    <button
                      key={`${key}-${booking.id}`}
                      type="button"
                      className={`day-booking-chip ${booking.type} ${userThemeClass(booking.userName)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setActiveBooking(booking);
                      }}
                    >
                      {booking.userName}
                    </button>
                  ))}
                  {dayBookings.length > 2 && <span className="badge provisional">+{dayBookings.length - 2}</span>}
                </div>
              );
            }}
          />
          <p className="calendar-hint">
            {!rangeStart && "Sélection: clique une date de début puis une date de fin"}
            {rangeStart && !rangeEnd && `Début sélectionné: ${toDateKey(rangeStart)} · clique la date de fin`}
            {rangeStart && rangeEnd && `Dates sélectionnées: ${formatStay(toDateKey(rangeStart), toDateKey(rangeEnd))}`}
          </p>
          {rangeStart && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              {hasCompleteRange && (
                <button type="button" onClick={openBookingCreationPopup}>
                  Réserver un séjour
                </button>
              )}
              <button type="button" className="secondary-button" onClick={clearSelection}>
                Annuler la sélection
              </button>
            </div>
          )}
        </section>

        <div className="side-column">
          {IS_DEV && (
            <section className="card dev-tools">
              <h2>Outils dev</h2>
              <button type="button" className="danger-button" onClick={resetDevData} disabled={isResetting}>
                {isResetting ? "Réinitialisation..." : "Réinitialiser"}
              </button>
              {devMessage && <p className="dev-message">{devMessage}</p>}
            </section>
          )}

          <section className="card">
            <h2>Réservations à venir</h2>
            {upcomingBookings.length === 0 && <p>Aucune réservation à venir.</p>}
            {upcomingBookings.map((booking) => (
              <article key={booking.id} className={`booking ${booking.type} ${userThemeClass(booking.userName)}`}>
                <p>
                  <strong>{booking.userName}</strong> · {booking.type === "definitive" ? "Définitive" : "Provisoire"}
                </p>
                <p>{formatStay(booking.startDate, booking.endDate)}</p>
                <p>{booking.note || "Aucune note"}</p>
                {currentUserId === booking.userId && (
                  <div className="edit-actions">
                    <button type="button" onClick={() => openBookingEditor(booking)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => void deleteBookingFromList(booking)}
                    >
                      Supprimer cette réservation
                    </button>
                  </div>
                )}
              </article>
            ))}
          </section>
        </div>
      </main>

      <section className="card past-feed">
        <h2>Réservations passées</h2>
        {pastBookings.length === 0 && <p>Aucune réservation passée.</p>}
        {pastBookings.map((booking) => {
          const comments = booking.comments ?? [];

          return (
            <article key={booking.id} className={`post-card ${userThemeClass(booking.userName)}`}>
              <header className="post-header">
                <p>
                  <strong>{booking.userName}</strong> · {formatStay(booking.startDate, booking.endDate)}
                </p>
                <span>{booking.type === "definitive" ? "Définitive" : "Provisoire"}</span>
              </header>

              <p>{booking.note || "Aucune note"}</p>

              {booking.photoUrls.length > 0 && (
                <div className="post-photos">
                  {booking.photoUrls.map((url) => (
                    <img key={url} src={url} alt={`Photo ${booking.userName}`} loading="lazy" />
                  ))}
                </div>
              )}

              <div className="post-comments">
                <strong>Commentaires</strong>
                {comments.length === 0 && <p>Aucun commentaire.</p>}
                {comments.map((comment) => (
                  <p key={comment.id} className="comment-item">
                    <strong>{comment.userName}</strong> · {new Date(comment.createdAt).toLocaleDateString("fr-FR")}<br />
                    {comment.text}
                  </p>
                ))}

                <div className="comment-form">
                  <textarea
                    rows={2}
                    placeholder="Ajouter un commentaire"
                    value={commentDrafts[booking.id] ?? ""}
                    onChange={(event) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [booking.id]: event.target.value
                      }))
                    }
                  />
                  <button type="button" onClick={() => void addComment(booking.id)}>
                    Publier
                  </button>
                </div>

                {currentUserId === booking.userId && (
                  <div className="edit-actions">
                    <button type="button" onClick={() => openBookingEditor(booking)}>
                      Modifier
                    </button>
                    <button
                      type="button"
                      className="danger-button post-delete-btn"
                      onClick={() => void deleteBookingFromList(booking)}
                    >
                      Supprimer cette réservation
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="card album">
        <h2>Album des photos du van</h2>
        {photos.length === 0 ? (
          <p>Aucune photo pour le moment.</p>
        ) : (
          <div className="photo-grid">
            {photos.map((photo) => (
              <figure key={`${photo.bookingId}-${photo.url}`}>
                <img src={photo.url} alt={`Van - ${photo.userName}`} loading="lazy" />
                <figcaption>
                  <strong>{photo.userName}</strong> · {formatStay(photo.startDate, photo.endDate)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      {activeBooking && (
        <div className="modal-overlay" onClick={() => setActiveBooking(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Modifier la réservation</h2>

            {currentUserId !== activeBooking.userId && (
              <p className="error" style={{ marginBottom: '16px' }}>
                ⚠️ Cette réservation appartient à {activeBooking.userName}. Seul le créateur peut la modifier.
              </p>
            )}

            <div className="form">
              <label>
                Début
                <input 
                  type="date" 
                  value={editStartDate} 
                  onChange={(event) => setEditStartDate(event.target.value)} 
                  disabled={currentUserId !== activeBooking.userId}
                />
              </label>

              <label>
                Fin
                <input 
                  type="date" 
                  value={editEndDate} 
                  onChange={(event) => setEditEndDate(event.target.value)}
                  disabled={currentUserId !== activeBooking.userId}
                />
              </label>

              <label>
                Type
                <select 
                  value={editType} 
                  onChange={(event) => setEditType(event.target.value as BookingType)}
                  disabled={currentUserId !== activeBooking.userId}
                >
                  <option value="provisional">Provisoire</option>
                  <option value="definitive">Définitive</option>
                </select>
              </label>

              <label>
                Texte
                <textarea 
                  value={editNote} 
                  onChange={(event) => setEditNote(event.target.value)} 
                  rows={3}
                  disabled={currentUserId !== activeBooking.userId}
                />
              </label>

              <div>
                <strong>Photos actuelles</strong>
                {editPhotoUrls.length === 0 && <p>Aucune photo</p>}
                <div className="photo-edit-grid">
                  {editPhotoUrls.map((url) => (
                    <div key={url} className="photo-edit-item">
                      <img src={url} alt="Photo réservation" />
                      {currentUserId === activeBooking.userId && (
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => setEditPhotoUrls((current) => current.filter((item) => item !== url))}
                        >
                          Retirer
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {currentUserId === activeBooking.userId && (
                <label>
                  Ajouter des images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => setEditNewFiles(event.target.files)}
                  />
                </label>
              )}

              {editError && <p className="error">{editError}</p>}

              {currentUserId === activeBooking.userId && (
                <div className="edit-actions">
                  <button type="button" onClick={saveBookingEdits} disabled={isSavingEdit}>
                    {isSavingEdit ? "Enregistrement..." : "Enregistrer"}
                  </button>
                  <button type="button" onClick={() => setActiveBooking(null)}>
                    Annuler
                  </button>
                </div>
              )}
            </div>

            <button type="button" onClick={() => setActiveBooking(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {showBookingPopup && (
        <div className="modal-overlay" onClick={() => setShowBookingPopup(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Réserver un séjour</h2>
            <p style={{ marginBottom: '16px' }}>
              Du <strong>{rangeStart ? toDateKey(rangeStart) : ''}</strong> au <strong>{rangeEnd ? toDateKey(rangeEnd) : ''}</strong>
            </p>

            <form onSubmit={submitBooking} className="form">
              <label>
                Type de réservation
                <select value={reservationType} onChange={(event) => setReservationType(event.target.value as BookingType)}>
                  <option value="provisional">Provisoire</option>
                  <option value="definitive">Définitive</option>
                </select>
              </label>

              <label>
                Infos / objet
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
              </label>

              <label>
                Photos
                <input type="file" accept="image/*" multiple onChange={(event) => setFiles(event.target.files)} />
              </label>

              {error && <p className="error">{error}</p>}

              <div className="edit-actions">
                <button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Envoi..." : "Confirmer"}
                </button>
                <button type="button" onClick={() => setShowBookingPopup(false)}>
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
