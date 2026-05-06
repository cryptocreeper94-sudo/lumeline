/**
 * Firebase Admin SDK — Ecosystem Shared Pattern
 * Verifies Firebase ID tokens on the server.
 * 
 * REQUIRED: Set FIREBASE_SERVICE_ACCOUNT env var (JSON string) on your
 * hosting provider. Without it, verifyIdToken() WILL FAIL on non-GCP
 * hosts (Render, Heroku, Railway, etc.) because there are no Application
 * Default Credentials available.
 * 
 * Generate a service account key from:
 * Firebase Console → darkwave-auth → Project Settings → Service Accounts
 * 
 * DarkWave Studios LLC — Copyright 2026
 */

import admin from "firebase-admin";

let initialized = false;
let initMode = "none";

function initFirebaseAdmin(): admin.app.App {
  if (initialized) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const projectId = process.env.FIREBASE_PROJECT_ID || "darkwave-auth";

  if (serviceAccountJson) {
    try {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initMode = "service-account";
      console.log("[Firebase Admin] ✅ Initialized with service account credential");
    } catch (err: any) {
      console.error("[Firebase Admin] ❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:", err.message);
      console.error("[Firebase Admin] Falling back to projectId-only — token verification WILL FAIL on non-GCP hosts");
      admin.initializeApp({ projectId });
      initMode = "project-id-fallback";
    }
  } else {
    // WARNING: This mode does NOT support verifyIdToken() on non-GCP hosts!
    admin.initializeApp({ projectId });
    initMode = "project-id-only";
    console.warn("[Firebase Admin] ⚠️  No FIREBASE_SERVICE_ACCOUNT env var found.");
    console.warn("[Firebase Admin] ⚠️  Initialized with projectId only — verifyIdToken() WILL FAIL on Render/Heroku.");
    console.warn("[Firebase Admin] ⚠️  Set FIREBASE_SERVICE_ACCOUNT to fix OAuth login.");
  }

  initialized = true;
  return admin.app();
}

// Initialize on import
initFirebaseAdmin();

/**
 * Verify a Firebase ID token and return the decoded claims.
 * Returns null if the token is invalid.
 */
export async function verifyFirebaseToken(
  idToken: string
): Promise<admin.auth.DecodedIdToken | null> {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (err: any) {
    console.error(`[Firebase Admin] Token verification failed (init mode: ${initMode}):`, err.code || err.message);
    if (initMode !== "service-account") {
      console.error("[Firebase Admin] ⚠️  This is likely because FIREBASE_SERVICE_ACCOUNT is not set. See firebase-admin.ts header for instructions.");
    }
    return null;
  }
}

export { initMode };
export default admin;
