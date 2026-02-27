export type BookingType = "provisional" | "definitive";

export interface BookingComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface User {
  id: string;
  name: string;
}

export interface Booking {
  id: string;
  weekendKey?: string;
  startDate: string;
  endDate: string;
  dateKeys: string[];
  userId: string;
  userName: string;
  type: BookingType;
  note: string;
  photoUrls: string[];
  reactions?: Record<string, string[]>;
  comments?: BookingComment[];
  createdAt: string;
}

export interface PhotoItem {
  url: string;
  startDate: string;
  endDate: string;
  userName: string;
  type: BookingType;
  note: string;
  bookingId: string;
}
