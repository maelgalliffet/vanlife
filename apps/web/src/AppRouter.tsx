import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import App from "./App";
import { DevTools } from "./DevTools";
import { User } from "./types";

type AppRouterProps = {
    apiUrl: string;
};

function Navigation({ apiUrl, users, currentUserId }: { apiUrl: string; users: User[]; currentUserId: string }) {
    const location = useLocation();

    if (location.pathname === "/devtools") {
        return null; // No nav on devtools page
    }

    return (
        <nav style={{ padding: "8px", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "flex-end" }}>
            <Link
                to="/devtools"
                style={{
                    padding: "8px 12px",
                    color: "#0066cc",
                    textDecoration: "none",
                    fontSize: "14px",
                    borderRadius: "4px",
                    backgroundColor: "#f0f0f0"
                }}
            >
                🛠️ Dev Tools
            </Link>
        </nav>
    );
}

export function AppRouter({ apiUrl }: AppRouterProps) {
    const [users, setUsers] = useState<User[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string>("");

    useEffect(() => {
        async function loadUsers() {
            try {
                const response = await fetch(`${apiUrl}/users`);
                if (response.ok) {
                    setUsers((await response.json()) as User[]);
                }
            } catch {
                // Silently fail
            }
        }
        void loadUsers();
        const storedUserId = localStorage.getItem("vanlife-current-user-id");
        if (storedUserId) {
            setCurrentUserId(storedUserId);
        }
    }, [apiUrl]);

    return (
        <Router>
            {import.meta.env.DEV && <Navigation apiUrl={apiUrl} users={users} currentUserId={currentUserId} />}
            <Routes>
                <Route path="/" element={<App />} />
                <Route
                    path="/devtools"
                    element={
                        import.meta.env.DEV ? (
                            <DevTools apiUrl={apiUrl} currentUserId={currentUserId} users={users} />
                        ) : (
                            <div style={{ padding: "20px", textAlign: "center" }}>
                                <p>Cette page n'est pas disponible en production.</p>
                            </div>
                        )
                    }
                />
            </Routes>
        </Router>
    );
}
