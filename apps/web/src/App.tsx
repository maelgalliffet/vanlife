import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Booking, BookingType, PhotoItem, User } from "./types";
import { BookingPublicationCard } from "./BookingPublicationCard";
import { usePushNotifications } from "./usePushNotifications";
import {
  addBookingComment,
  ApiClientError,
  deleteBooking as deleteBookingRequest,
  deleteBookingComment,
  DevPushSubscriptionView,
  fetchBookingsAndPhotos,
  fetchDevPushSubscriptions,
  fetchUsers,
  resetDevData as resetDevDataRequest,
  seedDevData as seedDevDataRequest,
  sendDevPushTest as sendDevPushTestRequest,
  updateBookingComment
} from "./api-client";

// Construire l'API URL de manière dynamique à l'exécution
// En production, utiliser VITE_API_URL variable d'environnement
// En développement, utiliser localhost:4000
const getApiUrl = () => {
  // Si on est en dev (Vite dev server)
  if (import.meta.env.DEV) {
    return "http://localhost:4000";
  }
  // En production, utiliser CloudFront /prod/api proxy (même domaine = pas de CORS)
  return import.meta.env.VITE_API_URL || "/prod/api";
};

const API_URL = getApiUrl();
const STORAGE_KEY = "vanlife-current-user-id";
const IS_DEV = import.meta.env.DEV;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function renameFileToJpeg(name: string): string {
  const lastDot = name.lastIndexOf(".");
  const base = lastDot > -1 ? name.slice(0, lastDot) : name;
  return `${base}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Impossible de compresser l'image"));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function compressImageForUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Canvas non disponible pour compresser l'image");
  }

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

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
        }

        if (blob.size <= MAX_UPLOAD_BYTES) {
          return new File([blob], renameFileToJpeg(file.name), { type: "image/jpeg" });
        }
      }
    }

    if (bestBlob && bestBlob.size <= MAX_UPLOAD_BYTES) {
      return new File([bestBlob], renameFileToJpeg(file.name), { type: "image/jpeg" });
    }

    throw new Error("Impossible de compresser l'image à 10MB maximum");
  } finally {
    bitmap.close();
  }
}

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

function defaultBookingTitle(startDate: string, endDate: string): string {
  return `${startDate} -> ${endDate}`;
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
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [devMessage, setDevMessage] = useState<string>("");
  const [devTargetUserId, setDevTargetUserId] = useState<string>("");
  const [devPushTitle, setDevPushTitle] = useState<string>("🔔 Notification de test");
  const [devPushBody, setDevPushBody] = useState<string>("Ceci est un test de notification push");
  const [isSendingDevPush, setIsSendingDevPush] = useState(false);
  const [pushSubscriptionsView, setPushSubscriptionsView] = useState<DevPushSubscriptionView[]>([]);
  const [isLoadingPushSubscriptions, setIsLoadingPushSubscriptions] = useState(false);
  const [hasLoadedPushSubscriptions, setHasLoadedPushSubscriptions] = useState(false);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editType, setEditType] = useState<BookingType>("provisional");
  const [editTitle, setEditTitle] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [isDeletingBooking, setIsDeletingBooking] = useState(false);
  const [editError, setEditError] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");
  const [commentError, setCommentError] = useState<string>("");
  const [isDeletingComment, setIsDeletingComment] = useState(false);
  const [showBookingPopup, setShowBookingPopup] = useState(false);
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const lightboxTouchStartX = useRef(0);
  const [collapsedSections, setCollapsedSections] = useState({
    calendar: false,
    devTools: false,
    upcomingBookings: false,
    pastBookings: false,
    album: false
  });

  const {
    isPushSupported,
    pushEnabled,
    pushLoading,
    pushError,
    togglePushSubscription
  } = usePushNotifications(API_URL, currentUserId);

  useEffect(() => {
    void loadUsers();
    void refreshData();
  }, []);

  async function loadUsers() {
    const payload = await fetchUsers(API_URL);
    setUsers(payload);
    if (!currentUserId && payload.length > 0) {
      setChosenIdentity(payload[0].id);
    }
  }

  async function refreshData() {
    const payload = await fetchBookingsAndPhotos(API_URL);
    setBookings(payload.bookings);
    setPhotos(payload.photos);
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

  const targetPushSubscriptionsCount = useMemo(
    () => pushSubscriptionsView.filter((subscription) => subscription.userId === devTargetUserId).length,
    [pushSubscriptionsView, devTargetUserId]
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
    formData.append("title", title);
    formData.append("note", note);

    if (files) {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setError("Un des fichiers n'est pas une image");
          setIsSubmitting(false);
          return;
        }

        if (file.size > 50 * 1024 * 1024) {
          setError("Un des fichiers est trop volumineux (max 50MB)");
          setIsSubmitting(false);
          return;
        }

        try {
          const processedFile = await compressImageForUpload(file);
          formData.append("photos", processedFile);
        } catch {
          setError(`Impossible de compresser ${file.name} sous 10MB`);
          setIsSubmitting(false);
          return;
        }
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

    setTitle("");
    setNote("");
    setFiles(null);
    setFilePreviews([]);
    setRangeStart(null);
    setRangeEnd(null);
    setShowBookingPopup(false);
    // Reset the file input element
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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

  function handleNewFiles(fileList: FileList | null) {
    setFiles(fileList);

    // Generate previews
    if (fileList) {
      const previews: string[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const reader = new FileReader();
        reader.onload = (e) => {
          previews.push(e.target?.result as string);
          if (previews.length === fileList.length) {
            setFilePreviews(previews);
          }
        };
        reader.readAsDataURL(file);
      }
    } else {
      setFilePreviews([]);
    }
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

    try {
      const payload = await resetDevDataRequest(API_URL);
      setRangeStart(null);
      setRangeEnd(null);
      setActiveBooking(null);
      await refreshData();
      setDevMessage(`Réinitialisation effectuée: ${payload.removedBookings} réservations, ${payload.removedFiles} photos supprimées.`);
    } catch (error) {
      setDevMessage(error instanceof ApiClientError ? error.message : "Impossible de réinitialiser les données.");
    } finally {
      setIsResetting(false);
    }
  }

  async function seedDevData() {
    setIsSeeding(true);
    setDevMessage("");

    try {
      const payload = await seedDevDataRequest(API_URL);
      setRangeStart(null);
      setRangeEnd(null);
      setActiveBooking(null);
      await refreshData();
      setDevMessage(`Base peuplée : ${payload.addedBookings} réservations ajoutées.`);
    } catch (error) {
      setDevMessage(error instanceof ApiClientError ? error.message : "Impossible de peupler les données.");
    } finally {
      setIsSeeding(false);
    }
  }

  useEffect(() => {
    if (!users.length) {
      return;
    }

    if (devTargetUserId && users.some((user) => user.id === devTargetUserId)) {
      return;
    }

    const fallback = users.find((user) => user.id === currentUserId)?.id ?? users[0].id;
    setDevTargetUserId(fallback);
  }, [users, currentUserId, devTargetUserId]);

  async function sendDevPushTest() {
    if (!devTargetUserId) {
      setDevMessage("Sélectionne un utilisateur cible pour le test");
      return;
    }

    setIsSendingDevPush(true);
    setDevMessage("");

    try {
      const subscriptions = await fetchDevPushSubscriptions(API_URL);
      setPushSubscriptionsView(subscriptions);
      setHasLoadedPushSubscriptions(true);

      const targetHasSubscription = subscriptions.some((subscription) => subscription.userId === devTargetUserId);
      if (!targetHasSubscription) {
        const subscribedUserIds = [...new Set(subscriptions.map((subscription) => subscription.userId))];
        const subscribedUserNames = users
          .filter((user) => subscribedUserIds.includes(user.id))
          .map((user) => user.name);

        setDevMessage(
          subscribedUserNames.length > 0
            ? `Aucun appareil abonné pour la cible. Utilisateurs abonnés: ${subscribedUserNames.join(", ")}`
            : "Aucun appareil abonné. Active d'abord les notifications sur le navigateur cible."
        );
        return;
      }

      const message = await sendDevPushTestRequest(API_URL, {
        targetUserId: devTargetUserId,
        fromUserId: currentUserId || undefined,
        title: devPushTitle,
        body: devPushBody
      });
      setDevMessage(message);
    } catch (error) {
      setDevMessage(error instanceof ApiClientError ? error.message : "Erreur réseau lors de l'envoi de la notification de test");
    } finally {
      setIsSendingDevPush(false);
    }
  }

  async function loadPushSubscriptions() {
    setIsLoadingPushSubscriptions(true);
    setDevMessage("");

    try {
      const payload = await fetchDevPushSubscriptions(API_URL);
      setPushSubscriptionsView(payload);
      setHasLoadedPushSubscriptions(true);
      setDevMessage(`Abonnements push actifs: ${payload.length}`);
    } catch (error) {
      setDevMessage(error instanceof ApiClientError ? error.message : "Erreur réseau lors de la lecture des abonnements push");
    } finally {
      setIsLoadingPushSubscriptions(false);
    }
  }

  useEffect(() => {
    if (!activeBooking) {
      setEditError("");
      return;
    }

    setEditStartDate(activeBooking.startDate);
    setEditEndDate(activeBooking.endDate);
    setEditType(activeBooking.type);
    setEditTitle(activeBooking.title);
    setEditNote(activeBooking.note);
    setEditPhotoUrls(activeBooking.photoUrls);
    setEditError("");
  }, [activeBooking]);

  function openBookingEditor(booking: Booking) {
    setActiveBooking(booking);
  }

  function openLightbox(urls: string[], index: number) {
    setLightboxPhotos(urls);
    setLightboxIndex(index);
  }

  function closeLightbox() {
    setLightboxPhotos([]);
  }

  function lightboxPrev() {
    setLightboxIndex((i) => (i - 1 + lightboxPhotos.length) % lightboxPhotos.length);
  }

  function lightboxNext() {
    setLightboxIndex((i) => (i + 1) % lightboxPhotos.length);
  }

  useEffect(() => {
    if (lightboxPhotos.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => (i - 1 + lightboxPhotos.length) % lightboxPhotos.length);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => (i + 1) % lightboxPhotos.length);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightboxPhotos]);

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
    setTitle(defaultBookingTitle(toDateKey(rangeStart), toDateKey(rangeEnd)));
  }

  async function updateBooking(
    removePhotoUrls: string[],
    newPhotos: File[] = [],
    failureMessage = "Impossible de modifier la réservation"
  ): Promise<Booking | null> {
    if (!activeBooking) {
      return null;
    }

    if (!currentUserId || activeBooking.userId !== currentUserId) {
      setEditError("Seul le créateur peut modifier cette réservation");
      return null;
    }

    if (!editStartDate || !editEndDate) {
      setEditError("Renseigne une date de début et de fin");
      return null;
    }

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
      if (!file.type.startsWith("image/")) {
        setEditError("Un des fichiers n'est pas une image");
        setIsSavingEdit(false);
        return null;
      }

      if (file.size > 50 * 1024 * 1024) {
        setEditError("Un des fichiers est trop volumineux (max 50MB)");
        setIsSavingEdit(false);
        return null;
      }

      try {
        const processedFile = await compressImageForUpload(file);
        formData.append("photos", processedFile);
      } catch {
        setEditError(`Impossible de compresser ${file.name} sous 10MB`);
        setIsSavingEdit(false);
        return null;
      }
    }

    const response = await fetch(`${API_URL}/bookings/${activeBooking.id}`, {
      method: "PUT",
      body: formData
    });

    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      setEditError(payload.message ?? failureMessage);
      setIsSavingEdit(false);
      return null;
    }

    const updatedBooking = (await response.json()) as Booking;
    // Reset the edit file input element
    if (editFileInputRef.current) {
      editFileInputRef.current.value = "";
    }
    await refreshData();
    setActiveBooking(updatedBooking);
    setEditPhotoUrls(updatedBooking.photoUrls);
    setIsSavingEdit(false);
    return updatedBooking;
  }

  async function saveBookingEdits() {
    if (!activeBooking) {
      return;
    }

    const removePhotoUrls = activeBooking.photoUrls.filter((url) => !editPhotoUrls.includes(url));
    const result = await updateBooking(removePhotoUrls);
    if (result) {
      setActiveBooking(null);
    }
  }

  async function handleEditPhotoSelection(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    await updateBooking([], Array.from(fileList), "Impossible d'ajouter les photos");
  }

  async function removeExistingPhoto(url: string) {
    const updatedBooking = await updateBooking([url], [], "Impossible de supprimer la photo");
    if (!updatedBooking) {
      return;
    }

    setEditPhotoUrls(updatedBooking.photoUrls);
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

    try {
      await deleteBookingRequest(API_URL, activeBooking.id, currentUserId);
      await refreshData();
      setActiveBooking(null);
    } catch (error) {
      setEditError(error instanceof ApiClientError ? error.message : "Impossible de supprimer la réservation");
    } finally {
      setIsDeletingBooking(false);
    }
  }

  async function deleteBookingFromList(booking: Booking) {
    if (!currentUserId || booking.userId !== currentUserId) {
      return;
    }

    const confirmed = window.confirm("Supprimer cette réservation et ses photos ?");
    if (!confirmed) {
      return;
    }

    try {
      await deleteBookingRequest(API_URL, booking.id, currentUserId);
      await refreshData();
    } catch {
      return;
    }
  }

  async function addComment(bookingId: string) {
    if (!currentUserId) {
      return;
    }

    const draft = (commentDrafts[bookingId] ?? "").trim();
    if (!draft) {
      return;
    }

    try {
      await addBookingComment(API_URL, bookingId, currentUserId, draft);
    } catch {
      return;
    }

    setCommentDrafts((current) => ({ ...current, [bookingId]: "" }));
    await refreshData();
  }

  async function deleteComment(bookingId: string, commentId: string) {
    if (!currentUserId) {
      return;
    }

    if (!confirm("Êtes-vous sûr de vouloir supprimer ce commentaire ?")) {
      return;
    }

    setIsDeletingComment(true);
    setCommentError("");

    try {
      await deleteBookingComment(API_URL, bookingId, commentId, currentUserId);
      await refreshData();
    } catch (error) {
      setCommentError(error instanceof ApiClientError ? error.message : "Impossible de supprimer le commentaire");
    } finally {
      setIsDeletingComment(false);
    }
  }

  async function updateComment(bookingId: string, commentId: string) {
    if (!currentUserId) {
      return;
    }

    const text = editingCommentText.trim();
    if (!text) {
      setCommentError("Le commentaire ne peut pas être vide");
      return;
    }

    setCommentError("");

    try {
      await updateBookingComment(API_URL, bookingId, commentId, currentUserId, text);
    } catch (error) {
      setCommentError(error instanceof ApiClientError ? error.message : "Impossible de modifier le commentaire");
      return;
    }

    setEditingCommentId(null);
    setEditingCommentText("");
    await refreshData();
  }

  function startEditingComment(text: string) {
    setEditingCommentText(text);
  }

  function toggleSection(section: keyof typeof collapsedSections) {
    setCollapsedSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }

  function renderComments(booking: Booking) {
    const comments = booking.comments ?? [];

    return (
      <div className="post-comments">
        <strong>Commentaires</strong>
        {comments.length === 0 && <p>Aucun commentaire.</p>}
        {comments.map((comment) => (
          <div key={comment.id} className="comment-item">
            {editingCommentId === comment.id ? (
              <div className="comment-edit-form">
                <textarea
                  rows={2}
                  value={editingCommentText}
                  onChange={(event) => setEditingCommentText(event.target.value)}
                />
                {commentError && <p className="error">{commentError}</p>}
                <button type="button" onClick={() => void updateComment(booking.id, comment.id)}>
                  Enregistrer
                </button>
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
                          startEditingComment(comment.text);
                          setCommentError("");
                        }}
                        title="Modifier"
                      >
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteComment(booking.id, comment.id)}
                        disabled={isDeletingComment}
                        title="Supprimer"
                      >
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
      </div>
    );
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
        <h1>Vanlife Galliffet Family !</h1>
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
          {isPushSupported ? (
            <button type="button" onClick={() => void togglePushSubscription()} disabled={!currentUserId || pushLoading}>
              {pushLoading ? "..." : pushEnabled ? "🔕 Couper les notifications" : "🔔 Activer les notifications"}
            </button>
          ) : (
            <span>Navigateur non compatible push</span>
          )}
        </div>
        {pushError && <p className="error">{pushError}</p>}
      </header>

      <main className="layout">
        <section className={`card calendar-card ${collapsedSections.calendar ? "is-collapsed" : ""}`}>
          <div className="section-header">
            <h2>Calendrier</h2>
            <button
              type="button"
              className="section-toggle"
              onClick={() => toggleSection("calendar")}
              aria-expanded={!collapsedSections.calendar}
            >
              {collapsedSections.calendar ? "Déplier" : "Réduire"}
            </button>
          </div>
          {!collapsedSections.calendar && (
            <>
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
                        <span
                          key={`${key}-${booking.id}`}
                          className={`day-booking-chip ${booking.type} ${userThemeClass(booking.userName)}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setActiveBooking(booking);
                          }}
                        >
                          {booking.userName}
                        </span>
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
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
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
            </>
          )}
        </section>

        <div className="side-column">
          {IS_DEV && (
            <section className={`card dev-tools ${collapsedSections.devTools ? "is-collapsed" : ""}`}>
              <div className="section-header">
                <h2>Outils dev</h2>
                <button
                  type="button"
                  className="section-toggle"
                  onClick={() => toggleSection("devTools")}
                  aria-expanded={!collapsedSections.devTools}
                >
                  {collapsedSections.devTools ? "Déplier" : "Réduire"}
                </button>
              </div>
              {!collapsedSections.devTools && (
                <>
                  <button type="button" className="danger-button" onClick={resetDevData} disabled={isResetting || isSeeding}>
                    {isResetting ? "Réinitialisation..." : "Vider la base"}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => void seedDevData()} disabled={isSeeding || isResetting}>
                    {isSeeding ? "Peuplement..." : "Peupler la base"}
                  </button>
                  <label>
                    Utilisateur cible (push test)
                    <select value={devTargetUserId} onChange={(event) => setDevTargetUserId(event.target.value)}>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="dev-message">
                    {!hasLoadedPushSubscriptions && "Statut cible: inconnu (clique "}
                    {!hasLoadedPushSubscriptions && <strong>"Lister les abonnements push"</strong>}
                    {!hasLoadedPushSubscriptions && ")"}
                    {hasLoadedPushSubscriptions &&
                      targetPushSubscriptionsCount > 0 &&
                      `Statut cible: ✅ abonné (${targetPushSubscriptionsCount})`}
                    {hasLoadedPushSubscriptions && targetPushSubscriptionsCount === 0 && "Statut cible: ❌ non abonné"}
                  </p>
                  <label>
                    Titre notification
                    <input value={devPushTitle} onChange={(event) => setDevPushTitle(event.target.value)} />
                  </label>
                  <label>
                    Message notification
                    <input value={devPushBody} onChange={(event) => setDevPushBody(event.target.value)} />
                  </label>
                  <button type="button" onClick={() => void sendDevPushTest()} disabled={isSendingDevPush || !devTargetUserId}>
                    {isSendingDevPush ? "Envoi..." : "Envoyer une notif test"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void loadPushSubscriptions()}
                    disabled={isLoadingPushSubscriptions}
                  >
                    {isLoadingPushSubscriptions ? "Chargement..." : "Lister les abonnements push"}
                  </button>
                  {pushSubscriptionsView.length > 0 && (
                    <div>
                      {pushSubscriptionsView.map((subscription) => (
                        <p key={subscription.id} className="dev-message">
                          {subscription.userId} · {subscription.endpoint.slice(0, 60)}...
                        </p>
                      ))}
                    </div>
                  )}
                  {devMessage && <p className="dev-message">{devMessage}</p>}
                </>
              )}
            </section>
          )}

          <section className={`card ${collapsedSections.upcomingBookings ? "is-collapsed" : ""}`}>
            <div className="section-header">
              <h2>Réservations à venir <span className="section-count">{upcomingBookings.length}</span></h2>
              <button
                type="button"
                className="section-toggle"
                onClick={() => toggleSection("upcomingBookings")}
                aria-expanded={!collapsedSections.upcomingBookings}
              >
                {collapsedSections.upcomingBookings ? "Déplier" : "Réduire"}
              </button>
            </div>
            {!collapsedSections.upcomingBookings && (
              <>
                {upcomingBookings.length === 0 && <p>Aucune réservation à venir.</p>}
                {upcomingBookings.map((booking) => (
                  <article key={booking.id} className={`booking ${booking.type} ${userThemeClass(booking.userName)}`}>
                    <p>
                      <strong>{booking.title}</strong>
                    </p>
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
                    {renderComments(booking)}
                  </article>
                ))}
              </>
            )}
          </section>
        </div>
      </main>

      <section className={`card past-feed ${collapsedSections.pastBookings ? "is-collapsed" : ""}`}>
        <div className="section-header">
          <h2>Réservations passées <span className="section-count">{pastBookings.length}</span></h2>
          <button
            type="button"
            className="section-toggle"
            onClick={() => toggleSection("pastBookings")}
            aria-expanded={!collapsedSections.pastBookings}
          >
            {collapsedSections.pastBookings ? "Déplier" : "Réduire"}
          </button>
        </div>
        {!collapsedSections.pastBookings && (
          <>
            {pastBookings.length === 0 && <p>Aucune réservation passée.</p>}
            {pastBookings.map((booking) => (
              <BookingPublicationCard
                key={booking.id}
                booking={booking}
                userThemeClass={userThemeClass}
                onPhotoClick={openLightbox}
                renderComments={renderComments}
                renderActions={(value) =>
                  currentUserId === value.userId ? (
                    <div className="edit-actions">
                      <button type="button" onClick={() => openBookingEditor(value)}>
                        Modifier
                      </button>
                      <button
                        type="button"
                        className="danger-button post-delete-btn"
                        onClick={() => void deleteBookingFromList(value)}
                      >
                        Supprimer cette réservation
                      </button>
                    </div>
                  ) : null
                }
              />
            ))}
          </>
        )}
      </section>

      <section className={`card album ${collapsedSections.album ? "is-collapsed" : ""}`}>
        <div className="section-header">
          <h2>Album des photos du van <span className="section-count">{photos.length}</span></h2>
          <button
            type="button"
            className="section-toggle"
            onClick={() => toggleSection("album")}
            aria-expanded={!collapsedSections.album}
          >
            {collapsedSections.album ? "Déplier" : "Réduire"}
          </button>
        </div>
        {!collapsedSections.album &&
          (photos.length === 0 ? (
            <p>Aucune photo pour le moment.</p>
          ) : (
            <div className="photo-grid">
              {photos.map((photo, i) => (
                <figure key={`${photo.bookingId}-${photo.url}`} className="photo-grid-item" onClick={() => openLightbox(photos.map((p) => p.url), i)}>
                  <img src={photo.url} alt={`Van - ${photo.userName}`} loading="lazy" />
                  <figcaption>
                    <strong>{photo.userName}</strong> · {formatStay(photo.startDate, photo.endDate)}
                  </figcaption>
                </figure>
              ))}
            </div>
          ))}
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
                Titre
                <input
                  type="text"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
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
                          onClick={() => void removeExistingPhoto(url)}
                          disabled={isSavingEdit}
                        >
                          {isSavingEdit ? "Suppression..." : "Supprimer"}
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
                    ref={editFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => void handleEditPhotoSelection(event.target.files)}
                    disabled={isSavingEdit}
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
                Titre
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>

              <label>
                Infos / objet
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
              </label>

              <label>
                Photos
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => handleNewFiles(event.target.files)}
                />
              </label>

              {filePreviews.length > 0 && (
                <div className="photo-edit-grid">
                  {filePreviews.map((preview, idx) => (
                    <div key={idx} className="photo-edit-item">
                      <img src={preview} alt={`Aperçu ${idx + 1}`} />
                      <span style={{ fontSize: '12px', color: '#999' }}>À envoyer</span>
                    </div>
                  ))}
                </div>
              )}

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

      {lightboxPhotos.length > 0 && (
        <div
          className="lightbox-overlay"
          onClick={closeLightbox}
          onTouchStart={(e) => { lightboxTouchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const diff = lightboxTouchStartX.current - e.changedTouches[0].clientX;
            if (Math.abs(diff) > 50) diff > 0 ? lightboxNext() : lightboxPrev();
          }}
        >
          <button className="lightbox-close" onClick={closeLightbox} aria-label="Fermer">✕</button>
          {lightboxPhotos.length > 1 && (
            <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); lightboxPrev(); }} aria-label="Photo précédente">‹</button>
          )}
          <img
            className="lightbox-img"
            src={lightboxPhotos[lightboxIndex]}
            alt="Photo en grand"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxPhotos.length > 1 && (
            <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); lightboxNext(); }} aria-label="Photo suivante">›</button>
          )}
          {lightboxPhotos.length > 1 && (
            <div className="lightbox-counter" onClick={(e) => e.stopPropagation()}>{lightboxIndex + 1} / {lightboxPhotos.length}</div>
          )}
        </div>
      )}
    </div>
  );
}
