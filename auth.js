const crypto = require("node:crypto");

const PBKDF2_ITERATIONS = 310000;
const PBKDF2_LENGTH = 32;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || "sreegeo-camera-secret-key-2026";

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_LENGTH, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(`pbkdf2_sha256$${salt}$${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    if (!storedHash || typeof storedHash !== "string") {
      resolve(false);
      return;
    }

    const parts = storedHash.split("$");
    const algorithm = parts[0];
    const salt = parts[1];
    const expectedHash = parts[2];

    if (algorithm !== "pbkdf2_sha256" || !salt || !expectedHash) {
      resolve(false);
      return;
    }

    crypto.pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_LENGTH, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey.toString("hex") === expectedHash);
    });
  });
}

function createSessionToken(user = {}) {
  const payload = Buffer.from(
    JSON.stringify({
      id: String(user.id || ""),
      name: String(user.name || "User"),
      email: String(user.email || "")
    })
  ).toString("base64url");

  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const raw = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createSessionCookie(token, isSecure = false) {
  const secureFlag = isSecure ? "; Secure" : "";
  return `sreegeo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secureFlag}`;
}

function clearSessionCookie(isSecure = false) {
  const secureFlag = isSecure ? "; Secure" : "";
  return `sreegeo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`;
}

function getSessionToken(cookieHeader) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((value) => value.trim());
  const sessionCookie = cookies.find((value) => value.startsWith("sreegeo_session="));

  if (!sessionCookie) {
    return null;
  }

  return sessionCookie.split("=")[1] || null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  createSessionCookie,
  clearSessionCookie,
  getSessionToken
};
