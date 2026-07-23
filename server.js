const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
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
app.use("/uploads", express.static(uploadDir));
app.use(express.static(__dirname));

app.get("/api/health", (request, response) => {
  response.json({ ok: true, database: Boolean(photosCollection) });
});

app.get("/api/photos", async (request, response) => {
  if (!photosCollection) {
    response.status(503).json({ message: "MongoDB is not connected. Add MONGODB_URI in .env and restart the server." });
    return;
  }

  try {
    const photos = await photosCollection
      .find({}, { projection: { imageFile: 0 } })
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

    const document = {
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
    const id = request.params.id;
    const query = ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { originalId: id };
    const photo = await photosCollection.findOne(query);

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
      await photosCollection.createIndex({ createdAt: -1 });
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
