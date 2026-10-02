const cameraFeed = document.querySelector("#cameraFeed");
const photoCanvas = document.querySelector("#photoCanvas");
const cameraEmpty = document.querySelector("#cameraEmpty");
const geoPreviewCard = document.querySelector("#geoPreviewCard");
const previewLatitude = document.querySelector("#previewLatitude");
const previewLongitude = document.querySelector("#previewLongitude");
const previewAltitude = document.querySelector("#previewAltitude");
const previewAddress = document.querySelector("#previewAddress");
const previewTime = document.querySelector("#previewTime");
const startCameraBtn = document.querySelector("#startCameraBtn");
const switchCameraBtn = document.querySelector("#switchCameraBtn");
const switchCameraBtnBottom = document.querySelector("#switchCameraBtnBottom");
const captureBtn = document.querySelector("#captureBtn");
const refreshLocationBtn = document.querySelector("#refreshLocationBtn");
const gpsToggleBtn = document.querySelector("#gpsToggleBtn");
const gpsStatusText = document.querySelector("#gpsStatusText");
const refreshGalleryBtn = document.querySelector("#refreshGalleryBtn");
const locationText = document.querySelector("#locationText");
const mapLink = document.querySelector("#mapLink");
const manualLocationForm = document.querySelector("#manualLocationForm");
const manualLatitude = document.querySelector("#manualLatitude");
const manualLongitude = document.querySelector("#manualLongitude");
const galleryGrid = document.querySelector("#galleryGrid");
const emptyGallery = document.querySelector("#emptyGallery");
const databaseStatus = document.querySelector("#databaseStatus");
const toast = document.querySelector("#toast");
const themeToggle = document.querySelector("#themeToggle");
const themeToggleIcon = document.querySelector("#themeToggleIcon");
const tabButtons = document.querySelectorAll(".tab-button");
const views = document.querySelectorAll(".view");

const isDevPort = window.location.port && window.location.port !== "3000" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const apiBaseUrl = isDevPort ? "http://localhost:3000" : window.location.origin;
const localPhotosKey = "geoTagCameraPhotos";
const themeStorageKey = "sreegeoTheme";
const appShell = document.querySelector("#appShell");
if (appShell) {
  appShell.hidden = false;
}

const apiTimeoutMs = 30000;
const ipLocationApiUrl = "https://ipapi.co/json/";
const useIpLocationByDefault = false;
const maxPhotoSize = 1280;
const desiredGpsAccuracyMeters = 25;
const gpsTimeoutMs = 20000;
let currentLocation = null;
let currentFacingMode = null;
let toastTimer = null;
let galleryPhotoCache = null;
let manualLocationEnabled = false;
let isGpsActive = false;
let isGpsLoading = false;

if (databaseStatus) {
  databaseStatus.textContent = "SQLite API";
}
initTheme();

if (tabButtons.length) {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetView = button.dataset.view;

      tabButtons.forEach((tab) => {
        const isActive = tab === button;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-pressed", String(isActive));
      });

      views.forEach((view) => view.classList.toggle("active", view.id === targetView));

      if (targetView === "galleryView") {
        renderGallery();
      } else if (targetView === "cameraView") {
        currentFacingMode = null;
        startCamera();
      }
    });
  });
}

if (startCameraBtn) {
  startCameraBtn.addEventListener("click", startCamera);
}
if (switchCameraBtn) {
  switchCameraBtn.addEventListener("click", switchCamera);
}
if (switchCameraBtnBottom) {
  switchCameraBtnBottom.addEventListener("click", switchCamera);
}
if (captureBtn) {
  captureBtn.addEventListener("click", capturePhoto);
}
if (gpsToggleBtn) {
  gpsToggleBtn.addEventListener("click", () => toggleOrRequestGps());
}
if (refreshLocationBtn) {
  refreshLocationBtn.addEventListener("click", () => toggleOrRequestGps(true));
}
if (refreshGalleryBtn) {
  refreshGalleryBtn.addEventListener("click", renderGallery);
}
if (galleryGrid) {
  galleryGrid.addEventListener("click", handleGalleryClick);
}
if (manualLocationForm) {
  manualLocationForm.addEventListener("submit", applyManualLocation);
}
if (themeToggle) {
  themeToggle.addEventListener("click", toggleTheme);
}

if (cameraFeed) {
  startCamera();
}
renderGallery().catch(() => {});

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Camera is not supported in this browser.");
    return;
  }

  try {
    stopCameraStream();

    const videoConstraints = currentFacingMode
      ? { facingMode: { ideal: currentFacingMode } }
      : true;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false
    });

    cameraFeed.srcObject = stream;
    if (cameraEmpty) cameraEmpty.hidden = true;
    if (captureBtn) captureBtn.disabled = false;
    if (switchCameraBtn) switchCameraBtn.disabled = false;
    if (switchCameraBtnBottom) switchCameraBtnBottom.disabled = false;
    if (startCameraBtn) startCameraBtn.textContent = "Camera On";

    // Set initial GPS button state without forcing GPS automatically
    if (!currentLocation && !isGpsActive) {
      setGpsStatus("off", "Turn on GPS");
    }

    showToast(currentFacingMode ? `${getCameraLabel()} camera started.` : "Camera ready.");
  } catch (error) {
    showToast("Please allow camera permission and try again.");
  }
}

function setGpsStatus(state, label) {
  if (!gpsToggleBtn) return;
  const statusEl = document.querySelector("#gpsStatusText");
  const iconEl = gpsToggleBtn.querySelector(".gps-icon");

  gpsToggleBtn.classList.remove("gps-off", "gps-loading", "gps-active");

  if (state === "loading") {
    gpsToggleBtn.classList.add("gps-loading");
    if (statusEl) statusEl.textContent = label || "Locating GPS...";
    if (iconEl) iconEl.textContent = "⏳";
    isGpsLoading = true;
  } else if (state === "active") {
    gpsToggleBtn.classList.add("gps-active");
    if (statusEl) statusEl.textContent = label || "GPS Active";
    if (iconEl) iconEl.textContent = "🟢";
    isGpsLoading = false;
    isGpsActive = true;
  } else {
    gpsToggleBtn.classList.add("gps-off");
    if (statusEl) statusEl.textContent = label || "Turn on GPS";
    if (iconEl) iconEl.textContent = "📍";
    isGpsLoading = false;
    isGpsActive = false;
  }
}

async function toggleOrRequestGps(isRefresh = false) {
  if (isGpsLoading) return null;

  setGpsStatus("loading", isRefresh ? "Refreshing GPS..." : "Locating GPS...");
  showToast(isRefresh ? "Refreshing precise GPS..." : "Requesting GPS location...");

  try {
    const loc = await updateLocation({ forceFresh: true, waitForAddress: true });
    if (loc) {
      setGpsStatus("active", "GPS Active");
      showToast("GPS Active: Ready to capture!");
      return loc;
    } else {
      setGpsStatus("off", "Turn on GPS");
      return null;
    }
  } catch (error) {
    setGpsStatus("off", "Turn on GPS");
    showToast("Please allow GPS location permission.");
    return null;
  }
}

async function switchCamera() {
  currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
  await startCamera();
}

function stopCameraStream() {
  const stream = cameraFeed.srcObject;
  if (!stream) return;

  stream.getTracks().forEach((track) => track.stop());
  cameraFeed.srcObject = null;
}

async function updateLocation(options = {}) {
  const { forceFresh = false, waitForAddress = false } = options;
  manualLocationEnabled = false;

  if (mapLink) mapLink.hidden = true;

  if (useIpLocationByDefault) {
    if (locationText) locationText.textContent = "Getting your approximate location from IP lookup...";
    try {
      const fallback = await getIpLocation();
      currentLocation = {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        accuracy: fallback.accuracy,
        address: "Finding address...",
        source: fallback.source
      };
      updateLocationUi();

      const address = await findAddress(currentLocation.latitude, currentLocation.longitude);
      currentLocation.address = address;
      updateLocationUi();
      setGpsStatus("active", "GPS Active");
      return currentLocation;
    } catch (error) {
      currentLocation = null;
      if (locationText) locationText.textContent = "Could not determine location from IP lookup.";
      showToast("IP location lookup failed. Try again later.");
      setGpsStatus("off", "Turn on GPS");
      return null;
    }
  }

  if (!navigator.geolocation) {
    if (locationText) locationText.textContent = "Geolocation is not supported in this browser.";
    showToast("GPS is not supported here.");
    setGpsStatus("off", "GPS Unsupported");
    return null;
  }

  if (locationText) locationText.textContent = "Getting your precise GPS location...";
  if (mapLink) mapLink.hidden = true;

  try {
    const position = await getAccuratePosition({ forceFresh });
    currentLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      altitude: position.coords.altitude,
      accuracy: position.coords.accuracy,
      altitudeAccuracy: position.coords.altitudeAccuracy,
      address: "Finding address...",
      source: "Device GPS"
    };
    updateLocationUi();
    setGpsStatus("active", "GPS Active");

    const addressPromise = findAddress(currentLocation.latitude, currentLocation.longitude).then((address) => {
      currentLocation.address = address;
      updateLocationUi();
      return address;
    });

    if (waitForAddress) {
      await addressPromise;
    }

    return currentLocation;
  } catch (error) {
    try {
      const fallback = await getFallbackLocation();
      currentLocation = {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        accuracy: fallback.accuracy,
        address: "Finding address...",
        source: fallback.source
      };
      updateLocationUi();

      currentLocation.address = await findAddress(currentLocation.latitude, currentLocation.longitude);
      updateLocationUi();
      setGpsStatus("active", "GPS Active");
      showToast("GPS approximate: using IP lookup.");
      return currentLocation;
    } catch (fallbackError) {
      currentLocation = null;
      if (locationText) locationText.textContent = getLocationErrorMessage(error);
      showToast("Please allow location permission and turn on GPS.");
      setGpsStatus("off", "Turn on GPS");
      return null;
    }
  }
}

async function getIpLocation() {
  const response = await fetchWithTimeout(ipLocationApiUrl, { headers: { Accept: "application/json" } }, "IP location lookup timed out.");
  if (!response.ok) {
    throw new Error("IP location lookup failed.");
  }

  const data = await response.json();
  const latitude = Number(data.latitude ?? data.lat);
  const longitude = Number(data.longitude ?? data.lon);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("IP location data is invalid.");
  }

  return {
    latitude,
    longitude,
    accuracy: 10000,
    source: "IP location"
  };
}

function getAccuratePosition({ forceFresh = false } = {}) {
  return new Promise((resolve, reject) => {
    let bestPosition = null;
    let watchId = null;
    let didFinish = false;

    const finish = (position, error) => {
      if (didFinish) return;
      didFinish = true;
      clearTimeout(timeoutId);
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (position) {
        resolve(position);
      } else {
        reject(error || new Error("Location unavailable."));
      }
    };

    const timeoutId = setTimeout(() => {
      finish(bestPosition, bestPosition ? null : new Error("GPS timed out."));
    }, gpsTimeoutMs);

    const handlePosition = (position) => {
      if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
        bestPosition = position;
        currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          accuracy: position.coords.accuracy,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          address: currentLocation?.address || "Improving GPS accuracy...",
          source: "Device GPS"
        };
        updateLocationUi();
      }

      if (position.coords.accuracy <= desiredGpsAccuracyMeters) {
        finish(position);
      }
    };

    const handleError = (error) => {
      finish(bestPosition, bestPosition ? null : error);
    };

    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      timeout: gpsTimeoutMs,
      maximumAge: forceFresh ? 0 : 1000
    });
  });
}

function updateLocationUi() {
  if (!currentLocation) return;

  const lat = currentLocation.latitude.toFixed(6);
  const lng = currentLocation.longitude.toFixed(6);
  const accuracy = Math.round(currentLocation.accuracy);
  const altitude = formatAltitude(currentLocation.altitude);
  const address = currentLocation.address || "Address is loading...";
  const source = currentLocation.source || "Device GPS";
  const accuracyText =
    accuracy <= 30
      ? `High accuracy: ${accuracy} meters`
      : `Approx accuracy: ${accuracy} meters. For best result, turn on phone GPS and stand near open sky.`;

  if (locationText) {
    locationText.textContent = `Latitude: ${lat}
Longitude: ${lng}
Altitude: ${altitude}
Indian Time: ${getIndianTime()}
Location: ${address}
Source: ${source}
${accuracyText}`;
  }

  if (mapLink) {
    mapLink.href = getMapUrl(currentLocation.latitude, currentLocation.longitude);
    mapLink.hidden = false;
  }

  updatePreviewOverlay();
}

async function capturePhoto() {
  if (!cameraFeed.videoWidth) {
    showToast("Camera is loading. Please wait a moment.");
    return;
  }

  // If GPS is not active, prompt to acquire it
  if (!currentLocation && !isGpsActive) {
    showToast("Acquiring GPS location for your photo...");
    const loc = await toggleOrRequestGps();
    if (!loc && !currentLocation) {
      showToast("Please tap 'Turn on GPS' and allow location permission to tag photo.");
      return;
    }
  }

  if (!currentLocation) {
    showToast("Please tap 'Turn on GPS' and allow location permission to tag photo.");
    return;
  }

  captureBtn.disabled = true;
  captureBtn.classList.add("shutter-pressed");
  showToast("Saving geo-tagged photo...");

  let photo = null;

  try {
    const blob = await makePhotoBlob();
    const createdAt = new Date();
    const indianTime = getIndianTime(createdAt);
    const localImage = await blobToDataUrl(blob);

    photo = {
      id: crypto.randomUUID(),
      imageUrl: localImage,
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      altitude: currentLocation.altitude,
      accuracy: currentLocation.accuracy,
      altitudeAccuracy: currentLocation.altitudeAccuracy,
      address: currentLocation.address || "Address not available",
      indianTime,
      createdAt: createdAt.toISOString(),
      source: "local"
    };

    const savedPhoto = await savePhotoToSqlite(photo);
    Object.assign(photo, savedPhoto);

    saveLocalPhoto(photo);
    await renderGallery();
    showToast(photo.source === "sqlite" ? "Photo saved to SQLite!" : "Photo saved to gallery!");
  } catch (error) {
    console.error("SQLite save failed:", error);
    databaseStatus.textContent = "SQLite save failed";
    if (photo) {
      saveLocalPhoto(photo);
    }
    await renderGallery().catch((galleryError) => {
      console.error("Gallery refresh failed:", galleryError);
    });
    showToast(getDatabaseErrorMessage(error));
  } finally {
    captureBtn.disabled = false;
    captureBtn.classList.remove("shutter-pressed");
  }
}

async function applyManualLocation(event) {
  event.preventDefault();

  const latitude = Number(manualLatitude.value);
  const longitude = Number(manualLongitude.value);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    showToast("Enter a valid latitude from -90 to 90.");
    manualLatitude.focus();
    return;
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    showToast("Enter a valid longitude from -180 to 180.");
    manualLongitude.focus();
    return;
  }

  manualLocationEnabled = true;
  currentLocation = {
    latitude,
    longitude,
    altitude: null,
    accuracy: 0,
    altitudeAccuracy: null,
    address: "Finding address...",
    source: "Manual GPS"
  };
  updateLocationUi();

  currentLocation.address = await findAddress(latitude, longitude);
  updateLocationUi();
  showToast("Manual GPS location applied.");
}

function makePhotoBlob() {
  const context = photoCanvas.getContext("2d");
  const scale = Math.min(1, maxPhotoSize / Math.max(cameraFeed.videoWidth, cameraFeed.videoHeight));
  photoCanvas.width = Math.round(cameraFeed.videoWidth * scale);
  photoCanvas.height = Math.round(cameraFeed.videoHeight * scale);
  context.drawImage(cameraFeed, 0, 0, photoCanvas.width, photoCanvas.height);

  drawGeotagStamp(context, photoCanvas.width, photoCanvas.height, currentLocation);

  return new Promise((resolve, reject) => {
    photoCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not create photo image."));
      }
    }, "image/jpeg", 0.9);
  });
}

async function renderGallery(forceReload = false) {
  const photos = await loadPhotos(forceReload);

  galleryGrid.innerHTML = "";
  emptyGallery.hidden = photos.length > 0;

  const fragment = document.createDocumentFragment();

  photos.forEach((photo) => {
    const card = document.createElement("article");
    card.className = "photo-card";

    const createdAt = photo.createdAt ? new Date(photo.createdAt) : new Date();
    const lat = Number(photo.latitude).toFixed(5);
    const lng = Number(photo.longitude).toFixed(5);
    const altitude = formatAltitude(photo.altitude);
    const indianTime = photo.indianTime || getIndianTime(createdAt);
    const address = photo.address || "Address not available";
    const accuracy = Math.round(photo.accuracy || 0);

    card.innerHTML = `
      <img src="${photo.imageUrl}" loading="lazy" decoding="async" alt="Geo tagged capture from ${createdAt.toLocaleString()}">
      <div class="photo-info">
        <strong>${indianTime}</strong>
        <p>${escapeHtml(address)}</p>
        <p>Lat ${lat}, Lng ${lng}. Alt ${altitude}. Accuracy ${accuracy}m</p>
        <div class="photo-actions">
          <a href="${getMapUrl(photo.latitude, photo.longitude)}" target="_blank" rel="noreferrer">Map</a>
          <button class="download-button" type="button" data-photo-id="${photo.id}">Download</button>
          <button class="delete-button" type="button" data-photo-id="${photo.id}">Delete</button>
        </div>
      </div>
    `;

    fragment.appendChild(card);
  });

  galleryGrid.appendChild(fragment);
}

async function handleGalleryClick(event) {
  const downloadButton = event.target.closest(".download-button");
  const deleteButton = event.target.closest(".delete-button");
  if (!downloadButton && !deleteButton) return;

  const photos = galleryPhotoCache || await loadPhotos();
  const photoId = downloadButton?.dataset.photoId || deleteButton?.dataset.photoId;
  const photo = photos.find((item) => item.id === photoId);
  if (!photo) {
    showToast("Photo not found.");
    return;
  }

  if (deleteButton) {
    await deletePhoto(photo, deleteButton);
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Saving...";

  try {
    let downloadablePhoto = photo;

    if (photo.source !== "sqlite") {
      downloadablePhoto = await savePhotoToSqlite(photo);
      upsertLocalPhoto(downloadablePhoto);
      await renderGallery();
    } else {
      upsertLocalPhoto(photo);
    }

    downloadImage(downloadablePhoto);
    showToast("Saved to SQLite and downloading.");
  } catch (error) {
    console.error("SQLite download/save failed:", error);
    databaseStatus.textContent = "SQLite save failed";
    showToast(getDatabaseErrorMessage(error));
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Download";
  }
}

async function deletePhoto(photo, deleteButton) {
  const shouldDelete = confirm("Delete this photo from gallery?");
  if (!shouldDelete) return;

  deleteButton.disabled = true;
  deleteButton.textContent = "Deleting...";

  try {
    if (photo.source === "sqlite") {
      const response = await fetchWithTimeout(
        `${apiBaseUrl}/api/photos/${encodeURIComponent(photo.mongoId || photo.id)}`,
        { method: "DELETE", credentials: "include" },
        "SQLite delete timed out."
      );

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.message || "SQLite delete failed.");
      }
    }

    removeLocalPhoto(photo.id);
    galleryPhotoCache = (galleryPhotoCache || []).filter((item) => item.id !== photo.id);
    await renderGallery(true);
    showToast("Photo deleted.");
  } catch (error) {
    console.error("Photo delete failed:", error);
    showToast(`Delete failed: ${error?.message || "try again"}.`);
  } finally {
    deleteButton.disabled = false;
    deleteButton.textContent = "Delete";
  }
}

async function loadPhotos(forceReload = false) {
  const localPhotos = getLocalPhotos();
  if (galleryPhotoCache && !forceReload) {
    return galleryPhotoCache;
  }

  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}/api/photos`, { credentials: "include" }, "SQLite gallery load timed out.");
    if (!response.ok) throw new Error("SQLite gallery load failed.");

    const sqlitePhotos = await response.json();
    databaseStatus.textContent = "SQLite connected";
    galleryPhotoCache = dedupePhotos([...sqlitePhotos, ...localPhotos]);
    return galleryPhotoCache;
  } catch (error) {
    console.error("SQLite gallery load failed:", error);
    databaseStatus.textContent = "SQLite offline";
    showToast("Could not load SQLite gallery. Showing local photos.");
    galleryPhotoCache = localPhotos;
    return localPhotos;
  }
}

function saveLocalPhoto(photo) {
  upsertLocalPhoto(photo);
}

function getLocalPhotos() {
  try {
    return JSON.parse(localStorage.getItem(localPhotosKey)) || [];
  } catch (error) {
    return [];
  }
}

function dedupePhotos(photos) {
  const seen = new Set();
  return photos.filter((photo) => {
    const key = photo.id || `${photo.imageUrl}-${photo.createdAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function savePhotoToSqlite(photo) {
  databaseStatus.textContent = "Saving to SQLite...";
  const response = await fetchWithTimeout(
    `${apiBaseUrl}/api/photos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(photo),
      credentials: "include"
    },
    "SQLite save timed out."
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "SQLite save failed.");
  }

  databaseStatus.textContent = "SQLite saved";
  return response.json();
}

function upsertLocalPhoto(photo) {
  const photos = getLocalPhotos();
  const withoutCurrent = photos.filter((item) => item.id !== photo.id);
  const updated = [photo, ...withoutCurrent].slice(0, 50);
  localStorage.setItem(localPhotosKey, JSON.stringify(updated));

  if (galleryPhotoCache) {
    galleryPhotoCache = [photo, ...galleryPhotoCache.filter((item) => item.id !== photo.id)];
  }
}

function removeLocalPhoto(photoId) {
  const photos = getLocalPhotos().filter((item) => item.id !== photoId && item.mongoId !== photoId);
  localStorage.setItem(localPhotosKey, JSON.stringify(photos));
}

function downloadImage(photo) {
  const link = document.createElement("a");
  link.href = photo.imageUrl;
  link.download = makePhotoFileName(photo);
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function makePhotoFileName(photo) {
  const datePart = (photo.createdAt || new Date().toISOString())
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  return `sreegeo-${datePart}.jpg`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function getMapUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

function getCameraLabel() {
  return currentFacingMode === "user" ? "Front" : "Back";
}

async function findAddress(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", latitude);
  url.searchParams.set("lon", longitude);
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Address lookup failed");

    const data = await response.json();
    return formatAddress(data, latitude, longitude);
  } catch (error) {
    return "Address not available. Check internet connection for street name.";
  }
}

function formatAddress(data, latitude, longitude) {
  const address = data.address || {};
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const locality =
    address.neighbourhood ||
    address.suburb ||
    address.hamlet ||
    address.village ||
    address.town ||
    address.city ||
    address.municipality;
  const district = address.city_district || address.county || address.state_district || address.district;
  const state = address.state;
  const postcode = address.postcode;
  const country = address.country;

  const parts = uniqueAddressParts([
    street,
    locality,
    district,
    state,
    postcode,
    country
  ]);

  if (parts.length) {
    return parts.join(", ");
  }

  if (data.display_name) {
    return data.display_name;
  }

  return `Near ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function uniqueAddressParts(parts) {
  const seen = new Set();

  return parts
    .map((part) => String(part || "").trim())
    .filter((part) => {
      if (!part) return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getIndianTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(date);
}

function updatePreviewOverlay() {
  if (!currentLocation) {
    geoPreviewCard.hidden = true;
    return;
  }

  previewLatitude.textContent = currentLocation.latitude.toFixed(6);
  previewLongitude.textContent = currentLocation.longitude.toFixed(6);
  previewAltitude.textContent = formatAltitude(currentLocation.altitude);
  previewAddress.textContent = currentLocation.address || "Address is loading...";
  previewTime.textContent = getIndianTime();
  geoPreviewCard.hidden = false;
}

function drawGeotagStamp(context, width, height, location) {
  const padding = Math.max(12, Math.round(width * 0.02));
  const cardWidth = width - padding * 2;
  const cardHeight = Math.max(110, Math.round(height * 0.16));
  const cardX = padding;
  const cardY = height - padding - cardHeight; // place at bottom
  const titleSize = Math.max(14, Math.floor(width * 0.022));
  const bodySize = Math.max(13, Math.floor(width * 0.02));
  const smallSize = Math.max(11, Math.floor(width * 0.016));
  const rowGap = Math.max(20, Math.round(cardHeight * 0.16));
  const textX = cardX + padding;
  let textY = cardY + padding + titleSize;

  // pick theme-aware colors from document theme
  const theme = document.body?.dataset?.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const accent = theme === 'dark' ? '#0b63d6' : '#ffb6c1';
  const textColor = theme === 'dark' ? '#e5edf8' : '#07111f';
  const bgColor = theme === 'dark' ? 'rgba(6,18,35,0.48)' : 'rgba(255,255,255,0.14)';

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  context.save();
  // card background
  context.fillStyle = bgColor;
  roundRect(context, cardX, cardY, cardWidth, cardHeight, 14);
  context.fill();

  // subtle accent line on left
  context.fillStyle = accent;
  context.fillRect(cardX + 10, cardY + 12, 6, cardHeight - 24);

  // Text styles
  context.fillStyle = accent;
  context.font = `700 ${titleSize}px Arial`;
  context.fillText('GEO TAG', textX + 22, textY);

  textY += rowGap;
  context.fillStyle = textColor;
  context.font = `700 ${bodySize}px Arial`;
  // two-column layout
  const col1x = textX + 22;
  const col2x = cardX + cardWidth * 0.55;
  context.fillText(`Lat ${location.latitude.toFixed(6)}`, col1x, textY);
  context.fillText(`Lng ${location.longitude.toFixed(6)}`, col2x, textY);

  textY += rowGap;
  context.font = `${bodySize}px Arial`;
  context.fillText(`Alt: ${formatAltitude(location.altitude)}`, col1x, textY);
  context.fillText(`IST: ${getIndianTime()}`, col2x, textY);

  textY += rowGap;
  context.font = `${smallSize}px Arial`;
  context.fillStyle = textColor;
  const placeText = `Place: ${shortenText(location.address || 'Address not available', 90)}`;
  context.fillText(placeText, col1x, textY);
  context.restore();
}

function formatAltitude(altitude) {
  const value = Number(altitude);
  return Number.isFinite(value) ? `${value.toFixed(1)} m` : "Not available";
}

function shortenText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function fetchWithTimeout(url, options = {}, message) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), apiTimeoutMs);

  const token = localStorage.getItem("sreegeo_token");
  const headers = { ...(options.headers || {}) };
  if (token && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    return await fetch(url, {
      ...options,
      headers,
      credentials: options.credentials || "include",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(message);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getDatabaseErrorMessage(error) {
  if (error?.message?.includes("timed out")) {
    return `${error.message} Saved locally. Check your backend and MongoDB connection.`;
  }

  return `MongoDB save failed: ${error?.message || "check backend terminal"}. Saved locally.`;
}

function getLocationErrorMessage(error) {
  if (error?.code === 1) {
    return "Location permission is needed for accurate geo tagged photos.";
  }

  if (error?.code === 2) {
    return "GPS location is unavailable. Turn on device location and try near an open area.";
  }

  if (error?.code === 3 || error?.message?.includes("timed out")) {
    return "GPS timed out. Turn on high accuracy location and try again.";
  }

  return "Could not get your GPS location.";
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function initTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  setTheme(savedTheme || (prefersDark ? "dark" : "light"));
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  setTheme(nextTheme);
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(themeStorageKey, theme);
  themeToggleIcon.textContent = theme === "dark" ? "L" : "D";
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

// --- Progressive Web App (PWA) Mobile App Installation ---
let deferredPrompt = null;
const installAppBtn = document.querySelector("#installAppBtn");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  if (installAppBtn) {
    installAppBtn.hidden = false;
  }
});

if (installAppBtn) {
  installAppBtn.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showToast("To install, tap browser menu (⋮) -> 'Add to Home Screen'");
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      showToast("Installing SreeGeo App...");
      installAppBtn.hidden = true;
    }
    deferredPrompt = null;
  });
}

window.addEventListener("appinstalled", () => {
  if (installAppBtn) installAppBtn.hidden = true;
  showToast("SreeGeo App successfully installed!");
});

// Register Service Worker for offline capability & PWA installability
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("SreeGeo Service Worker registered:", reg.scope);
      })
      .catch((err) => {
        console.warn("Service Worker registration failed:", err);
      });
  });
}

