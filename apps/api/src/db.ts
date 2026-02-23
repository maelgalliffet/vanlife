import fs from "node:fs";
import path from "node:path";
import { DbSchema } from "./types";

const dataDir = path.resolve(process.cwd(), "apps/api/data");
const dbPath = path.join(dataDir, "db.json");

const defaultDb: DbSchema = {
  users: [
    { id: "mael", name: "Maël/Salma" },
    { id: "ivan", name: "Ivan/Isa" },
    { id: "lena", name: "Lena/Lucas" }
  ],
  bookings: []
};

function ensureDbExists(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2), "utf-8");
  }
}

export function readDb(): DbSchema {
  ensureDbExists();
  const raw = fs.readFileSync(dbPath, "utf-8");
  return JSON.parse(raw) as DbSchema;
}

export function writeDb(data: DbSchema): void {
  ensureDbExists();
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
}
