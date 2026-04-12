import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouter } from "./AppRouter";
import "./styles.css";

const getApiUrl = () => {
  // Si on est en dev (Vite dev server)
  if (import.meta.env.DEV) {
    return "http://localhost:4000";
  }
  // En production, utiliser CloudFront /prod/api proxy (même domaine = pas de CORS)
  return import.meta.env.VITE_API_URL || "/prod/api";
};

const API_URL = getApiUrl();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouter apiUrl={API_URL} />
  </React.StrictMode>
);
