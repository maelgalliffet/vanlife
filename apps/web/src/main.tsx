import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import BookingDetailPage from "./BookingDetailPage";
import "./styles.css";

const bookingMatch = window.location.pathname.match(/^\/bookings\/([^/]+)$/);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {bookingMatch ? <BookingDetailPage bookingId={bookingMatch[1]} /> : <App />}
  </React.StrictMode>
);
