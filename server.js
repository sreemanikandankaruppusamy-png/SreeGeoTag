const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  createSessionCookie,
  clearSessionCookie,
  getSessionToken
} = require("./auth");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || "sreegeo";
const uploadDir = path.join(__dirname, "uploads");

if (!mongoUri) {
  console.warn("MONGODB_URI is missing. Create .env from .env.example and add your MongoDB connection string.");
}

const client = mongoUri ? new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 }) : null;
let photosCollection = null;
let usersCollection = null;
let sessions = new Map();

function getCurrentUser(request) {
  const token = getSessionToken(request.headers.cookie || "");
  return token ? sessions.get(token) : null;
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

app.use("/uploads", express.static(uploadDir));
app.use(express.static(__dirname));

app.get("/api/health", (request, response) => {
  response.json({ ok: true, database: Boolean(photosCollection) });
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
  if (!usersCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
    return;
  }

  const { name, email, password } = request.body || {};

  if (!name || !email || !password) {
    response.status(400).json({ message: "Name, email, and password are required." });
    return;
  }

  try {
    const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      response.status(409).json({ message: "An account with that email already exists." });
      return;
    }

    const passwordHash = await hashPassword(password);
    const createdUser = await usersCollection.insertOne({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date()
    });

    const user = {
      id: String(createdUser.insertedId),
      name: name.trim(),
      email: email.toLowerCase().trim()
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
  if (!usersCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
    return;
  }

  const { email, password } = request.body || {};

  if (!email || !password) {
    response.status(400).json({ message: "Email and password are required." });
    return;
  }

  try {
    const user = await usersCollection.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      response.status(401).json({ message: "Invalid email or password." });
      return;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      response.status(401).json({ message: "Invalid email or password." });
      return;
    }

    const safeUser = {
      id: String(user._id),
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

  if (!photosCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
    return;
  }

  try {
    const photos = await photosCollection
      .find({ ownerId: sessions.get(token).id }, { projection: { imageFile: 0 } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    response.json(photos.map(toClientPhoto));
  } catch (error) {
    response.status(500).json({ message: "Could not load photos from MongoDB." });
  }
});

app.post("/api/photos", async (request, response) => {
  if (!photosCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
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
      ownerId: currentUser.id,
      originalId: photo.id || crypto.randomUUID(),
      imageUrl: savedImage.publicUrl,
      imageFile: savedImage.fileName,
      latitude: Number(photo.latitude),
      longitude: Number(photo.longitude),
      accuracy: Number(photo.accuracy || 0),
      address: photo.address || "Address not available",
      indianTime: photo.indianTime || "",
      capturedAt: createdAt,
      createdAt: new Date(),
      source: "mongodb"
    };

    if (!Number.isFinite(document.latitude) || !Number.isFinite(document.longitude)) {
      response.status(400).json({ message: "Latitude and longitude are required." });
      return;
    }

    const result = await photosCollection.insertOne(document);
    response.status(201).json(toClientPhoto({ ...document, _id: result.insertedId }));
  } catch (error) {
    console.error("MongoDB save failed:", error);
    response.status(500).json({ message: "Could not save photo to MongoDB." });
  }
});

app.delete("/api/photos/:id", async (request, response) => {
  if (!photosCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
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
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { originalId: id };
    const photo = await photosCollection.findOne(query);

    if (photo?.ownerId && photo.ownerId !== currentUser.id) {
      response.status(403).json({ message: "You can only delete your own photos." });
      return;
    }

    if (!photo) {
      response.status(404).json({ message: "Photo not found." });
      return;
    }

    await photosCollection.deleteOne({ _id: photo._id });

    if (photo.imageFile) {
      const filePath = path.join(uploadDir, photo.imageFile);
      await fs.unlink(filePath).catch((error) => {
        if (error.code !== "ENOENT") {
          console.error("Could not delete image file:", error.message);
        }
      });
    }

    response.json({ ok: true });
  } catch (error) {
    console.error("MongoDB delete failed:", error);
    response.status(500).json({ message: "Could not delete photo from MongoDB." });
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
    id: String(photo._id || photo.originalId),
    mongoId: photo._id ? String(photo._id) : undefined,
    imageUrl: makeAbsoluteUrl(photo.imageUrl),
    latitude: photo.latitude,
    longitude: photo.longitude,
    accuracy: photo.accuracy,
    address: photo.address,
    indianTime: photo.indianTime,
    createdAt: photo.capturedAt?.toISOString?.() || photo.createdAt?.toISOString?.() || new Date().toISOString(),
    source: "mongodb"
  };
}

function makeAbsoluteUrl(url) {
  if (!url || url.startsWith("http")) return url;
  return `http://localhost:${port}${url}`;
}

async function startServer() {
  await fs.mkdir(uploadDir, { recursive: true });

  app.listen(port, () => {
    console.log(`SreeGeo server running at http://localhost:${port}`);
  });

  if (client) {
    try {
      await client.connect();
      photosCollection = client.db(databaseName).collection("geoPhotos");
      usersCollection = client.db(databaseName).collection("users");
      await photosCollection.createIndex({ createdAt: -1 });
      await photosCollection.createIndex({ ownerId: 1 });
      await usersCollection.createIndex({ email: 1 }, { unique: true });
      console.log(`MongoDB connected. Database: ${databaseName}`);
    } catch (error) {
      console.error("MongoDB connection failed. Website will still run, but database saves will fail until .env is fixed.");
      console.error(error.message);
    }
  }
}

startServer().catch((error) => {
  console.error("Could not start server:", error);
  process.exit(1);
});
