import { useEffect, useRef, useState } from "react";
import { Booking, BookingType, User } from "./types";
import { BookingPublicationCard } from "./BookingPublicationCard";
import {
    addBookingComment,
    ApiClientError,
    deleteBooking as deleteBookingRequest,
    deleteBookingComment,
    fetchBooking,
    fetchUsers,
    updateBookingComment,
} from "./api-client";

const getApiUrl = () => {
    if (import.meta.env.DEV) return "http://localhost:4000";
    return import.meta.env.VITE_API_URL || "/prod/api";
};

const API_URL = getApiUrl();
const STORAGE_KEY = "vanlife-current-user-id";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function userThemeClass(name: string): string {
    const normalized = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    if (normalized.includes("mael") && normalized.includes("salma")) return "user-theme-mael-salma";
    if (normalized.includes("lena") && normalized.includes("lucas")) return "user-theme-lena-lucas";
    if (normalized.includes("ivan") && normalized.includes("isa")) return "user-theme-ivan-isa";
    return "";
}

function renameFileToJpeg(name: string): string {
    const lastDot = name.lastIndexOf(".");
    const base = lastDot > -1 ? name.slice(0, lastDot) : name;
    return `${base}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error("Impossible de compresser l'image")); return; }
            resolve(blob);
        }, type, quality);
    });
}

async function compressImageForUpload(file: File): Promise<File> {
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); throw new Error("Canvas non disponible pour compresser l'image"); }

    const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.33, 0.25];
    const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34, 0.26];
    let bestBlob: Blob | null = null;

    try {
        for (const scale of scales) {
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.width = width;
            canvas.height = height;
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            context.drawImage(bitmap, 0, 0, width, height);
            for (const quality of qualities) {
                const blob = await canvasToBlob(canvas, "image/jpeg", quality);
                if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
                if (blob.size <= MAX_UPLOAD_BYTES) return new File([blob], renameFileToJpeg(file.name), { type: "image/jpeg" });
            }
        }
        if (bestBlob && bestBlob.size <= MAX_UPLOAD_BYTES) return new File([bestBlob], renameFileToJpeg(file.name), { type: "image/jpeg" });
        throw new Error("Impossible de compresser l'image à 10MB maximum");
    } finally {
        bitmap.close();
    }
}

export default function BookingDetailPage({ bookingId }: { bookingId: string }) {
    const [booking, setBooking] = useState<Booking | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? "");
    const [loadingBooking, setLoadingBooking] = useState(true);
    const [bookingError, setBookingError] = useState("");

    // Lightbox
    const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState(0);
    const lightboxTouchStartX = useRef(0);

    // Comments
    const [commentDraft, setCommentDraft] = useState("");
    const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
    const [editingCommentText, setEditingCommentText] = useState("");
    const [commentError, setCommentError] = useState("");
    const [isDeletingComment, setIsDeletingComment] = useState(false);

    // Edit modal
    const [showEditModal, setShowEditModal] = useState(false);
    const [editStartDate, setEditStartDate] = useState("");
    const [editEndDate, setEditEndDate] = useState("");
    const [editType, setEditType] = useState<BookingType>("provisional");
    const [editTitle, setEditTitle] = useState("");
    const [editNote, setEditNote] = useState("");
    const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [editError, setEditError] = useState("");
    const editFileInputRef = useRef<HTMLInputElement>(null);
    const [isDeletingBooking, setIsDeletingBooking] = useState(false);

    async function reload() {
        const updated = await fetchBooking(API_URL, bookingId);
        setBooking(updated);
        setEditPhotoUrls(updated.photoUrls);
    }

    useEffect(() => {
        async function load() {
            try {
                const [fetchedBooking, fetchedUsers] = await Promise.all([
                    fetchBooking(API_URL, bookingId),
                    fetchUsers(API_URL),
                ]);
                setBooking(fetchedBooking);
                setUsers(fetchedUsers);
            } catch (err) {
                setBookingError(err instanceof ApiClientError ? err.message : "Impossible de charger la réservation");
            } finally {
                setLoadingBooking(false);
            }
        }
        void load();
    }, [bookingId]);

    useEffect(() => {
        if (!booking || !showEditModal) return;
        setEditStartDate(booking.startDate);
        setEditEndDate(booking.endDate);
        setEditType(booking.type);
        setEditTitle(booking.title);
        setEditNote(booking.note);
        setEditPhotoUrls(booking.photoUrls);
        setEditError("");
    }, [booking, showEditModal]);

    useEffect(() => {
        if (lightboxPhotos.length === 0) return;
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setLightboxPhotos([]);
            if (e.key === "ArrowLeft") setLightboxIndex((i) => (i - 1 + lightboxPhotos.length) % lightboxPhotos.length);
            if (e.key === "ArrowRight") setLightboxIndex((i) => (i + 1) % lightboxPhotos.length);
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [lightboxPhotos]);

    function setActiveUser(userId: string) {
        setCurrentUserId(userId);
        localStorage.setItem(STORAGE_KEY, userId);
    }

    // --- Comments ---

    async function addComment() {
        if (!currentUserId || !booking) return;
        const draft = commentDraft.trim();
        if (!draft) return;
        try {
            await addBookingComment(API_URL, booking.id, currentUserId, draft);
            setCommentDraft("");
            await reload();
        } catch {
            return;
        }
    }

    async function deleteComment(commentId: string) {
        if (!currentUserId || !booking) return;
        if (!confirm("Êtes-vous sûr de vouloir supprimer ce commentaire ?")) return;
        setIsDeletingComment(true);
        setCommentError("");
        try {
            await deleteBookingComment(API_URL, booking.id, commentId, currentUserId);
            await reload();
        } catch (error) {
            setCommentError(error instanceof ApiClientError ? error.message : "Impossible de supprimer le commentaire");
        } finally {
            setIsDeletingComment(false);
        }
    }

    async function updateComment(commentId: string) {
        if (!currentUserId || !booking) return;
        const text = editingCommentText.trim();
        if (!text) { setCommentError("Le commentaire ne peut pas être vide"); return; }
        setCommentError("");
        try {
            await updateBookingComment(API_URL, booking.id, commentId, currentUserId, text);
            setEditingCommentId(null);
            setEditingCommentText("");
            await reload();
        } catch (error) {
            setCommentError(error instanceof ApiClientError ? error.message : "Impossible de modifier le commentaire");
        }
    }

    // --- Edit booking ---

    async function saveEdit(removePhotoUrls: string[], newPhotos: File[] = []): Promise<Booking | null> {
        if (!booking || !currentUserId) return null;
        if (!editStartDate || !editEndDate) { setEditError("Renseigne une date de début et de fin"); return null; }
        setIsSavingEdit(true);
        setEditError("");

        const formData = new FormData();
        formData.append("startDate", editStartDate);
        formData.append("endDate", editEndDate);
        formData.append("type", editType);
        formData.append("title", editTitle);
        formData.append("note", editNote);
        formData.append("removePhotoUrls", JSON.stringify(removePhotoUrls));
        formData.append("requesterUserId", currentUserId);

        for (const file of newPhotos) {
            if (!file.type.startsWith("image/")) { setEditError("Un des fichiers n'est pas une image"); setIsSavingEdit(false); return null; }
            if (file.size > 50 * 1024 * 1024) { setEditError("Un des fichiers est trop volumineux (max 50MB)"); setIsSavingEdit(false); return null; }
            try {
                formData.append("photos", await compressImageForUpload(file));
            } catch {
                setEditError(`Impossible de compresser ${file.name} sous 10MB`);
                setIsSavingEdit(false);
                return null;
            }
        }

        const response = await fetch(`${API_URL}/bookings/${booking.id}`, { method: "PUT", body: formData });
        if (!response.ok) {
            const payload = (await response.json()) as { message?: string };
            setEditError(payload.message ?? "Impossible de modifier la réservation");
            setIsSavingEdit(false);
            return null;
        }

        const updated = (await response.json()) as Booking;
        if (editFileInputRef.current) editFileInputRef.current.value = "";
        setBooking(updated);
        setEditPhotoUrls(updated.photoUrls);
        setIsSavingEdit(false);
        return updated;
    }

    async function handleSaveEdits() {
        if (!booking) return;
        const removePhotoUrls = booking.photoUrls.filter((url) => !editPhotoUrls.includes(url));
        const result = await saveEdit(removePhotoUrls);
        if (result) setShowEditModal(false);
    }

    async function handleEditPhotoSelection(fileList: FileList | null) {
        if (!fileList || fileList.length === 0) return;
        await saveEdit([], Array.from(fileList));
    }

    async function removeExistingPhoto(url: string) {
        await saveEdit([url], []);
    }

    async function handleDeleteBooking() {
        if (!booking || !currentUserId) return;
        if (!confirm("Supprimer cette réservation et ses photos ?")) return;
        setIsDeletingBooking(true);
        try {
            await deleteBookingRequest(API_URL, booking.id, currentUserId);
            window.location.href = "/";
        } catch (error) {
            setEditError(error instanceof ApiClientError ? error.message : "Impossible de supprimer la réservation");
            setIsDeletingBooking(false);
        }
    }

    function renderComments(value: Booking) {
        const comments = value.comments ?? [];

        return (
            <div className="post-comments">
                <strong>Commentaires</strong>
                {comments.length === 0 && <p>Aucun commentaire.</p>}
                {comments.map((comment) => (
                    <div key={comment.id} className="comment-item">
                        {editingCommentId === comment.id ? (
                            <div className="comment-edit-form">
                                <textarea rows={2} value={editingCommentText} onChange={(e) => setEditingCommentText(e.target.value)} />
                                {commentError && <p className="error">{commentError}</p>}
                                <button type="button" onClick={() => void updateComment(comment.id)}>Enregistrer</button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingCommentId(null);
                                        setEditingCommentText("");
                                        setCommentError("");
                                    }}
                                >
                                    Annuler
                                </button>
                            </div>
                        ) : (
                            <>
                                <p>
                                    <strong>{comment.userName}</strong> · {new Date(comment.createdAt).toLocaleDateString("fr-FR")}
                                    {comment.updatedAt && <span> (modifié)</span>}
                                    {currentUserId === comment.userId && (
                                        <span className="comment-actions">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingCommentId(comment.id);
                                                    setEditingCommentText(comment.text);
                                                    setCommentError("");
                                                }}
                                                title="Modifier"
                                            >
                                                Modifier
                                            </button>
                                            <button type="button" onClick={() => void deleteComment(comment.id)} disabled={isDeletingComment} title="Supprimer">
                                                Supprimer
                                            </button>
                                        </span>
                                    )}
                                </p>
                                <p>{comment.text}</p>
                            </>
                        )}
                    </div>
                ))}

                {currentUserId && (
                    <div className="comment-form">
                        <textarea rows={2} placeholder="Ajouter un commentaire" value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} />
                        <button type="button" onClick={() => void addComment()}>Publier</button>
                    </div>
                )}
            </div>
        );
    }

    // --- Render ---

    const isOwner = !!currentUserId && booking?.userId === currentUserId;

    if (loadingBooking) {
        return (
            <div className="page">
                <p>Chargement…</p>
            </div>
        );
    }

    if (bookingError || !booking) {
        return (
            <div className="page">
                <a href="/" className="back-link">Retour</a>
                <p className="error">{bookingError || "Réservation introuvable"}</p>
            </div>
        );
    }

    return (
        <div className="page">
            <header>
                <a href="/" className="back-link">Retour</a>
                <h1>Vanlife Galliffet Family !</h1>
                <div className="current-user-row">
                    <span>Connecté en tant que :</span>
                    <select
                        value={currentUserId}
                        onChange={(e) => setActiveUser(e.target.value)}
                        disabled={users.length === 0}
                    >
                        {!currentUserId && <option value="">Non défini</option>}
                        {users.map((user) => (
                            <option key={user.id} value={user.id}>{user.name}</option>
                        ))}
                    </select>
                </div>
            </header>

            <main>
                <BookingPublicationCard
                    booking={booking}
                    userThemeClass={userThemeClass}
                    onPhotoClick={(urls, index) => {
                        setLightboxPhotos(urls);
                        setLightboxIndex(index);
                    }}
                    renderComments={renderComments}
                    renderActions={() =>
                        isOwner ? (
                            <div className="edit-actions">
                                <button type="button" onClick={() => setShowEditModal(true)}>Modifier</button>
                                <button type="button" className="danger-button post-delete-btn" onClick={() => void handleDeleteBooking()} disabled={isDeletingBooking}>
                                    {isDeletingBooking ? "Suppression…" : "Supprimer cette réservation"}
                                </button>
                            </div>
                        ) : null
                    }
                    className="booking-detail-card"
                />
            </main>

            {/* Edit modal */}
            {showEditModal && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Modifier la réservation</h2>

                        <div className="form">
                            <label>Début<input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} /></label>
                            <label>Fin<input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} /></label>
                            <label>Titre<input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></label>
                            <label>
                                Type
                                <select value={editType} onChange={(e) => setEditType(e.target.value as BookingType)}>
                                    <option value="provisional">Provisoire</option>
                                    <option value="definitive">Définitive</option>
                                </select>
                            </label>
                            <label>Texte<textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={3} /></label>

                            <div>
                                <strong>Photos actuelles</strong>
                                {editPhotoUrls.length === 0 && <p>Aucune photo</p>}
                                <div className="photo-edit-grid">
                                    {editPhotoUrls.map((url) => (
                                        <div key={url} className="photo-edit-item">
                                            <img src={url} alt="Photo réservation" />
                                            <button type="button" className="danger-button" onClick={() => void removeExistingPhoto(url)} disabled={isSavingEdit}>
                                                {isSavingEdit ? "Suppression…" : "Supprimer"}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <label>
                                Ajouter des images
                                <input ref={editFileInputRef} type="file" accept="image/*" multiple onChange={(e) => void handleEditPhotoSelection(e.target.files)} disabled={isSavingEdit} />
                            </label>

                            {editError && <p className="error">{editError}</p>}

                            <div className="edit-actions">
                                <button type="button" onClick={() => void handleSaveEdits()} disabled={isSavingEdit}>
                                    {isSavingEdit ? "Enregistrement…" : "Enregistrer"}
                                </button>
                                <button type="button" onClick={() => setShowEditModal(false)}>Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Lightbox */}
            {lightboxPhotos.length > 0 && (
                <div
                    className="lightbox-overlay"
                    onClick={() => setLightboxPhotos([])}
                    onTouchStart={(e) => { lightboxTouchStartX.current = e.touches[0].clientX; }}
                    onTouchEnd={(e) => {
                        const diff = lightboxTouchStartX.current - e.changedTouches[0].clientX;
                        if (Math.abs(diff) > 50) {
                            if (diff > 0) setLightboxIndex((i) => (i + 1) % lightboxPhotos.length);
                            else setLightboxIndex((i) => (i - 1 + lightboxPhotos.length) % lightboxPhotos.length);
                        }
                    }}
                >
                    <button className="lightbox-close" onClick={() => setLightboxPhotos([])} aria-label="Fermer">✕</button>
                    {lightboxPhotos.length > 1 && (
                        <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i - 1 + lightboxPhotos.length) % lightboxPhotos.length); }} aria-label="Photo précédente">‹</button>
                    )}
                    <img className="lightbox-img" src={lightboxPhotos[lightboxIndex]} alt="Photo en grand" onClick={(e) => e.stopPropagation()} />
                    {lightboxPhotos.length > 1 && (
                        <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i + 1) % lightboxPhotos.length); }} aria-label="Photo suivante">›</button>
                    )}
                    {lightboxPhotos.length > 1 && (
                        <div className="lightbox-counter" onClick={(e) => e.stopPropagation()}>{lightboxIndex + 1} / {lightboxPhotos.length}</div>
                    )}
                </div>
            )}
        </div>
    );
}
