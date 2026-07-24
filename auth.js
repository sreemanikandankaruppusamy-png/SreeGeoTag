const crypto = require("node:crypto");

const PBKDF2_ITERATIONS = 310000;
const PBKDF2_LENGTH = 32;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

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

function createSessionToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createSessionCookie(token) {
  return `sreegeo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return "sreegeo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
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
  createSessionCookie,
  clearSessionCookie,
  getSessionToken
};
