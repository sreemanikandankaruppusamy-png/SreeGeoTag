const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  createSessionCookie,
  clearSessionCookie,
  getSessionToken
} = require("./auth");
require("dotenv").config({ quiet: true });

const app = express();
const port = Number(process.env.PORT || 3000);
const isVercel = Boolean(process.env.VERCEL);
const sqlitePath = process.env.SQLITE_DB_PATH || (isVercel ? path.join("/tmp", "sreegeo.sqlite") : path.join(__dirname, "data", "sreegeo.sqlite"));
const uploadDir = isVercel ? path.join("/tmp", "uploads") : path.join(__dirname, "uploads");
let db = null;
let databaseReady = false;
let sessions = new Map();
let initDbPromise = null;

function getCurrentUser(request) {
  const token = getSessionToken(request.headers.cookie || "");
  return token ? sessions.get(token) : null;
}

function ensureDatabase(response) {
  if (databaseReady) {
    return true;
  }

  response.status(503).json({ message: "SQLite database is not connected. Restart the server and check SQLITE_DB_PATH." });
  return false;
}

function openDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filePath, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(database);
    });
  });
}

function dbExec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

app.use(express.json({ limit: "15mb" }));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(async (request, response, next) => {
  if (!databaseReady) {
    await initDatabase().catch(() => {});
  }
  next();
});
function sendLoginPage(request, response) {
  if (getCurrentUser(request)) {
    response.redirect("/main.html");
    return;
  }

  response.sendFile(path.join(__dirname, "index.html"));
}

function sendMainPage(request, response) {
  if (!getCurrentUser(request)) {
    response.redirect("/");
    return;
  }

  response.sendFile(path.join(__dirname, "main.html"));
}

app.get("/", sendLoginPage);
app.get("/login", sendLoginPage);
app.get("/index.html", sendLoginPage);
app.get("/main", sendMainPage);
app.get("/main.html", sendMainPage);
app.get("/sw.js", (request, response) => {
  response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  response.setHeader("Content-Type", "application/javascript");
  response.setHeader("Service-Worker-Allowed", "/");
  response.sendFile(path.join(__dirname, "sw.js"));
});

app.use("/uploads", express.static(uploadDir));
app.use(express.static(__dirname));

app.get("/api/health", (request, response) => {
  response.json({ ok: true, database: databaseReady, databaseType: "sqlite" });
});

app.get("/api/auth/me", async (request, response) => {
  const token = getSessionToken(request.headers.cookie || "");

  if (!token || !sessions.has(token)) {
    response.status(401).json({ authenticated: false });
    return;
  }

  response.json({ authenticated: true, user: sessions.get(token) });
});

app.post("/api/auth/register", async (request, response) => {
  if (!ensureDatabase(response)) {
    return;
  }

  const { name, email, password } = request.body || {};

  if (!name || !email || !password) {
    response.status(400).json({ message: "Name, email, and password are required." });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const trimmedName = name.trim();
    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existingUser) {
      response.status(409).json({ message: "An account with that email already exists." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await dbRun(
      "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
      [trimmedName, normalizedEmail, passwordHash, new Date().toISOString()]
    );

    const user = {
      id: String(createdUser.lastID),
      name: trimmedName,
      email: normalizedEmail
    };

    const token = createSessionToken();
    sessions.set(token, user);
    response.setHeader("Set-Cookie", createSessionCookie(token));
    response.status(201).json({ authenticated: true, user });
  } catch (error) {
    console.error("User registration failed:", error);
    response.status(500).json({ message: "Could not create your account." });
  }
});

app.post("/api/auth/login", async (request, response) => {
  if (!ensureDatabase(response)) {
    return;
  }

  const { email, password } = request.body || {};

  if (!email || !password) {
    response.status(400).json({ message: "Email and password are required." });
    return;
  }

  try {
    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (!user) {
      response.status(401).json({ message: "Invalid email or password." });
      return;
    }

    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      response.status(401).json({ message: "Invalid email or password." });
      return;
    }

    const safeUser = {
      id: String(user.id),
      name: user.name,
      email: user.email
    };

    const token = createSessionToken();
    sessions.set(token, safeUser);
    response.setHeader("Set-Cookie", createSessionCookie(token));
    response.json({ authenticated: true, user: safeUser });
  } catch (error) {
    console.error("User login failed:", error);
    response.status(500).json({ message: "Could not sign you in." });
  }
});

app.post("/api/auth/logout", (request, response) => {
  const token = getSessionToken(request.headers.cookie || "");

  if (token) {
    sessions.delete(token);
  }

  response.setHeader("Set-Cookie", clearSessionCookie());
  response.json({ ok: true });
});

app.get("/api/photos", async (request, response) => {
  const token = getSessionToken(request.headers.cookie || "");
  if (!token || !sessions.has(token)) {
    response.status(401).json({ message: "Please sign in to view your gallery." });
    return;
  }

  if (!ensureDatabase(response)) {
    return;
  }

  try {
    const photos = await dbAll(
      "SELECT * FROM photos WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
      [sessions.get(token).id]
    );

    response.json(photos.map(toClientPhoto));
  } catch (error) {
    response.status(500).json({ message: "Could not load photos from SQLite." });
  }
});

app.post("/api/photos", async (request, response) => {
  if (!ensureDatabase(response)) {
    return;
  }

  try {
    const photo = request.body;
    const savedImage = await saveImage(photo.imageUrl);
    const createdAt = photo.createdAt ? new Date(photo.createdAt) : new Date();

    const token = getSessionToken(request.headers.cookie || "");
    const currentUser = token ? sessions.get(token) : null;

    if (!currentUser) {
      response.status(401).json({ message: "Please sign in before saving photos." });
      return;
    }

    const document = {
      owner_id: currentUser.id,
      original_id: photo.id || crypto.randomUUID(),
      image_url: savedImage.publicUrl,
      image_file: savedImage.fileName,
      latitude: Number(photo.latitude),
      longitude: Number(photo.longitude),
      accuracy: Number(photo.accuracy || 0),
      address: photo.address || "Address not available",
      indian_time: photo.indianTime || "",
      captured_at: createdAt.toISOString(),
      created_at: new Date().toISOString()
    };

    if (!Number.isFinite(document.latitude) || !Number.isFinite(document.longitude)) {
      response.status(400).json({ message: "Latitude and longitude are required." });
      return;
    }

    const result = await dbRun(
      `INSERT INTO photos (
        owner_id, original_id, image_url, image_file, latitude, longitude, accuracy,
        address, indian_time, captured_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        document.owner_id,
        document.original_id,
        document.image_url,
        document.image_file,
        document.latitude,
        document.longitude,
        document.accuracy,
        document.address,
        document.indian_time,
        document.captured_at,
        document.created_at
      ]
    );

    response.status(201).json(toClientPhoto({ ...document, id: result.lastID }));
  } catch (error) {
    console.error("SQLite save failed:", error);
    response.status(500).json({ message: "Could not save photo to SQLite." });
  }
});

app.delete("/api/photos/:id", async (request, response) => {
  if (!ensureDatabase(response)) {
    return;
  }

  try {
    const token = getSessionToken(request.headers.cookie || "");
    const currentUser = token ? sessions.get(token) : null;
    if (!currentUser) {
      response.status(401).json({ message: "Please sign in before deleting photos." });
      return;
    }

    const id = request.params.id;
    const photo = /^\d+$/.test(id)
      ? await dbGet("SELECT * FROM photos WHERE id = ?", [Number(id)])
      : await dbGet("SELECT * FROM photos WHERE original_id = ?", [id]);

    if (photo?.owner_id && photo.owner_id !== currentUser.id) {
      response.status(403).json({ message: "You can only delete your own photos." });
      return;
    }

    if (!photo) {
      response.status(404).json({ message: "Photo not found." });
      return;
    }

    await dbRun("DELETE FROM photos WHERE id = ?", [photo.id]);

    if (photo.image_file) {
      const filePath = path.join(uploadDir, photo.image_file);
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== "ENOENT") {
          console.error("Could not delete image file:", error.message);
        }
      });
    }

    response.json({ ok: true });
  } catch (error) {
    console.error("SQLite delete failed:", error);
    response.status(500).json({ message: "Could not delete photo from SQLite." });
  }
});

async function saveImage(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("A photo data URL is required.");
  }

  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!match) {
    throw new Error("Photo must be a base64 image data URL.");
  }

  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.join(uploadDir, fileName);
  const buffer = Buffer.from(match[2], "base64");

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    fileName,
    publicUrl: `/uploads/${fileName}`
  };
}

function toClientPhoto(photo) {
  return {
    id: String(photo.id || photo.original_id || photo.originalId),
    mongoId: photo.id ? String(photo.id) : undefined,
    imageUrl: makeAbsoluteUrl(photo.image_url || photo.imageUrl),
    latitude: photo.latitude,
    longitude: photo.longitude,
    accuracy: photo.accuracy,
    address: photo.address,
    indianTime: photo.indian_time || photo.indianTime,
    createdAt: toIsoString(photo.captured_at || photo.capturedAt || photo.created_at || photo.createdAt),
    source: "sqlite"
  };
}

function toIsoString(value) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function makeAbsoluteUrl(url) {
  if (!url || url.startsWith("http")) return url;
  return `http://localhost:${port}${url}`;
}

async function initDatabase() {
  if (databaseReady && db) return db;

  if (!initDbPromise) {
    initDbPromise = (async () => {
      try {
        await fs.mkdir(uploadDir, { recursive: true }).catch(() => {});
        await fs.mkdir(path.dirname(sqlitePath), { recursive: true }).catch(() => {});

        db = await openDatabase(sqlitePath);
        await dbExec(`
          PRAGMA foreign_keys = ON;

          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL,
            original_id TEXT NOT NULL,
            image_url TEXT NOT NULL,
            image_file TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            accuracy REAL NOT NULL DEFAULT 0,
            address TEXT NOT NULL,
            indian_time TEXT,
            captured_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_photos_owner_created ON photos (owner_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_photos_original_id ON photos (original_id);
        `);
        databaseReady = true;
        console.log(`SQLite connected. Database file: ${sqlitePath}`);
      } catch (error) {
        console.error("SQLite connection warning:", error.message);
      }
    })();
  }

  await initDbPromise;
  return db;
}

initDatabase().catch((error) => {
  console.warn("Initial DB start warning:", error.message);
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;
