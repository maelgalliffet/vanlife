import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
    resetDevData as resetDevDataRequest,
    seedDevData as seedDevDataRequest,
    sendDevPushTest as sendDevPushTestRequest,
    fetchDevPushSubscriptions,
    DevPushSubscriptionView
} from "./api-client";
import { User } from "./types";

type DevToolsProps = {
    apiUrl: string;
    currentUserId: string;
    users: User[];
};

export function DevTools({ apiUrl, currentUserId, users }: DevToolsProps) {
    const navigate = useNavigate();
    const [isResetting, setIsResetting] = useState(false);
    const [isSeeding, setIsSeeding] = useState(false);
    const [devMessage, setDevMessage] = useState<string>("");
    const [devTargetUserId, setDevTargetUserId] = useState<string>(currentUserId);
    const [devPushTitle, setDevPushTitle] = useState<string>("🔔 Notification de test");
    const [devPushBody, setDevPushBody] = useState<string>("Ceci est un test de notification push");
    const [isSendingDevPush, setIsSendingDevPush] = useState(false);
    const [pushSubscriptionsView, setPushSubscriptionsView] = useState<DevPushSubscriptionView[]>([]);
    const [isLoadingPushSubscriptions, setIsLoadingPushSubscriptions] = useState(false);
    const [hasLoadedPushSubscriptions, setHasLoadedPushSubscriptions] = useState(false);

    const targetPushSubscriptionsCount = pushSubscriptionsView.filter(
        (subscription) => subscription.userId === devTargetUserId
    ).length;

    useEffect(() => {
        if (devTargetUserId && users.some((user) => user.id === devTargetUserId)) {
            return;
        }
        const fallback = users.length > 0 ? users[0].id : currentUserId;
        setDevTargetUserId(fallback);
    }, [users, currentUserId, devTargetUserId]);

    async function resetDevData() {
        if (!confirm("Êtes-vous vraiment sûr ? Cela supprimer toutes les réservations et photos.")) {
            return;
        }
        setIsResetting(true);
        setDevMessage("");
        try {
            const result = await resetDevDataRequest(apiUrl);
            setDevMessage(`🗑️ Réinitialisé : ${result.removedBookings} réservations et ${result.removedFiles} fichiers supprimés`);
        } catch (error) {
            setDevMessage(`❌ ${error instanceof Error ? error.message : "Erreur lors de la réinitialisation"}`);
        } finally {
            setIsResetting(false);
        }
    }

    async function seedDevData() {
        if (!confirm("Êtes-vous vraiment sûr ? Cela va créer des réservations de test.")) {
            return;
        }
        setIsSeeding(true);
        setDevMessage("");
        try {
            const result = await seedDevDataRequest(apiUrl);
            setDevMessage(`🌱 Peuplement : ${result.addedBookings} réservations créées`);
        } catch (error) {
            setDevMessage(`❌ ${error instanceof Error ? error.message : "Erreur lors du peuplement"}`);
        } finally {
            setIsSeeding(false);
        }
    }

    async function sendDevPushTest() {
        setIsSendingDevPush(true);
        setDevMessage("");
        try {
            const message = await sendDevPushTestRequest(apiUrl, {
                targetUserId: devTargetUserId,
                title: devPushTitle,
                body: devPushBody
            });
            setDevMessage(`✅ ${message}`);
        } catch (error) {
            setDevMessage(`❌ ${error instanceof Error ? error.message : "Erreur lors de l'envoi"}`);
        } finally {
            setIsSendingDevPush(false);
        }
    }

    const loadPushSubscriptions = useCallback(async () => {
        setIsLoadingPushSubscriptions(true);
        try {
            const subscriptions = await fetchDevPushSubscriptions(apiUrl);
            setPushSubscriptionsView(subscriptions);
            setHasLoadedPushSubscriptions(true);
        } catch (error) {
            setDevMessage(`❌ ${error instanceof Error ? error.message : "Erreur lors de la lecture des abonnements"}`);
        } finally {
            setIsLoadingPushSubscriptions(false);
        }
    }, [apiUrl]);

    return (
        <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", backgroundColor: "#f5f5f5", padding: "16px", borderRadius: "8px" }}>
                <h1 style={{ margin: 0, backgroundColor: "#2196F3", color: "white", padding: "8px 12px", borderRadius: "4px" }}>🛠️ Outils de développement</h1>
                <button
                    type="button"
                    onClick={() => navigate("/")}
                    style={{
                        padding: "10px 20px",
                        backgroundColor: "#4CAF50",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "16px",
                        fontWeight: "bold",
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.2)",
                        transition: "background-color 0.3s"
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#45a049")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#4CAF50")}
                >
                    ← Retour
                </button>
            </div>

            <section style={{ marginBottom: "24px", backgroundColor: "#fff3cd", padding: "16px", borderRadius: "8px", border: "1px solid #ffc107" }}>
                <h2 style={{ margin: "0 0 16px 0", backgroundColor: "#FF9800", color: "white", padding: "8px 12px", borderRadius: "4px", display: "inline-block" }}>Gestion de la base de données</h2>
                <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
                    <button
                        type="button"
                        className="danger-button"
                        onClick={() => void resetDevData()}
                        disabled={isResetting || isSeeding}
                        style={{ padding: "8px 16px", cursor: "pointer" }}
                    >
                        {isResetting ? "Réinitialisation..." : "🗑️ Vider la base"}
                    </button>
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void seedDevData()}
                        disabled={isSeeding || isResetting}
                        style={{ padding: "8px 16px", cursor: "pointer" }}
                    >
                        {isSeeding ? "Peuplement..." : "🌱 Peupler la base"}
                    </button>
                </div>
            </section>

            <section style={{ marginBottom: "24px", backgroundColor: "#e8f5e9", padding: "16px", borderRadius: "8px", border: "1px solid #4CAF50" }}>
                <h2 style={{ margin: "0 0 16px 0", backgroundColor: "#4CAF50", color: "white", padding: "8px 12px", borderRadius: "4px", display: "inline-block" }}>Test des notifications push</h2>
                <label style={{ display: "block", marginBottom: "12px" }}>
                    <span style={{ backgroundColor: "#4CAF50", color: "white", padding: "4px 8px", borderRadius: "4px", fontSize: "14px" }}>Utilisateur cible (push test)</span>
                    <select
                        value={devTargetUserId}
                        onChange={(event) => setDevTargetUserId(event.target.value)}
                        style={{ display: "block", marginTop: "4px", width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #4CAF50" }}
                    >
                        {users.map((user) => (
                            <option key={user.id} value={user.id}>
                                {user.name}
                            </option>
                        ))}
                    </select>
                </label>

                <p style={{ fontSize: "14px", color: "#333", backgroundColor: "#ffffff", padding: "8px 12px", borderRadius: "4px", border: "1px solid #4CAF50" }}>
                    {!hasLoadedPushSubscriptions && "Statut cible: inconnu (clique sur \"Lister les abonnements push\")"}
                    {hasLoadedPushSubscriptions &&
                        targetPushSubscriptionsCount > 0 &&
                        `Statut cible: ✅ abonné (${targetPushSubscriptionsCount})`}
                    {hasLoadedPushSubscriptions && targetPushSubscriptionsCount === 0 && "Statut cible: ❌ non abonné"}
                </p>

                <label style={{ display: "block", marginBottom: "12px" }}>
                    <span style={{ backgroundColor: "#4CAF50", color: "white", padding: "4px 8px", borderRadius: "4px", fontSize: "14px" }}>Titre notification</span>
                    <input
                        value={devPushTitle}
                        onChange={(event) => setDevPushTitle(event.target.value)}
                        style={{ display: "block", marginTop: "4px", width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #4CAF50" }}
                    />
                </label>

                <label style={{ display: "block", marginBottom: "12px" }}>
                    <span style={{ backgroundColor: "#4CAF50", color: "white", padding: "4px 8px", borderRadius: "4px", fontSize: "14px" }}>Message notification</span>
                    <input
                        value={devPushBody}
                        onChange={(event) => setDevPushBody(event.target.value)}
                        style={{ display: "block", marginTop: "4px", width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #4CAF50" }}
                    />
                </label>

                <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                    <button
                        type="button"
                        onClick={() => void sendDevPushTest()}
                        disabled={isSendingDevPush || !devTargetUserId}
                        style={{
                            padding: "10px 16px",
                            cursor: "pointer",
                            backgroundColor: "#2196F3",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            fontWeight: "bold"
                        }}
                    >
                        {isSendingDevPush ? "Envoi..." : "📤 Envoyer une notif test"}
                    </button>
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void loadPushSubscriptions()}
                        disabled={isLoadingPushSubscriptions}
                        style={{
                            padding: "10px 16px",
                            cursor: "pointer",
                            backgroundColor: "#9C27B0",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            fontWeight: "bold"
                        }}
                    >
                        {isLoadingPushSubscriptions ? "Chargement..." : "📋 Lister les abonnements"}
                    </button>
                </div>

                {pushSubscriptionsView.length > 0 && (
                    <div style={{ backgroundColor: "#f5f5f5", padding: "12px", borderRadius: "4px", marginBottom: "12px", border: "1px solid #ddd" }}>
                        <p style={{ fontWeight: "bold", marginBottom: "8px", backgroundColor: "#9C27B0", color: "white", padding: "4px 8px", borderRadius: "4px", display: "inline-block" }}>📋 Abonnements enregistrés:</p>
                        {pushSubscriptionsView.map((subscription) => (
                            <p key={subscription.id} style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", backgroundColor: "#ffffff", padding: "8px", margin: "4px 0", borderRadius: "4px", border: "1px solid #ddd" }}>
                                <strong>{subscription.userId}</strong> · {subscription.endpoint.slice(0, 60)}...
                            </p>
                        ))}
                    </div>
                )}

                {devMessage && (
                    <div
                        style={{
                            padding: "12px",
                            backgroundColor: devMessage.includes("✅") ? "#e6ffe6" : "#ffe6e6",
                            color: devMessage.includes("✅") ? "#00aa00" : "#aa0000",
                            borderRadius: "4px",
                            marginTop: "12px",
                            border: `1px solid ${devMessage.includes("✅") ? "#00cc00" : "#cc0000"}`,
                            fontWeight: "bold"
                        }}
                    >
                        {devMessage}
                    </div>
                )}
            </section>
        </div>
    );
}