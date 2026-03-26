import crypto from 'crypto';
import db from './db.js';
import { createJWT, hashToken, SESSION_DAYS } from './auth.js';
const DWTL_BASE = process.env.TRUST_LAYER_URL || 'https://dwtl.io';
const APP_SLUG = 'lumeline';
const REQUEST_TIMEOUT_MS = 5000;

const CIRCUIT_BREAKER = {
  failures: 0, threshold: 3, cooldownMs: 60_000, lastFailureAt: 0,
  get isOpen() {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailureAt > this.cooldownMs) { this.failures = 0; return false; }
    return true;
  },
  recordFailure() { this.failures++; this.lastFailureAt = Date.now(); console.warn(`[TL SSO] ${APP_SLUG}: circuit breaker #${this.failures}/${this.threshold}`); },
  recordSuccess() { this.failures = 0; }
};

export function registerTrustLayerSSO(app) {
  app.post("/api/auth/trust-layer/login", async (req, res) => {
    try {
      const { sso_token, auth_token } = req.body;
      const token = sso_token || auth_token;
      if (!token) return res.status(400).json({ success: false, error: "SSO token is required" });
      if (CIRCUIT_BREAKER.isOpen) return res.status(503).json({ success: false, error: "Trust Layer temporarily unavailable", degraded: true });

      let ecosystemUser = null;
      let isTimeout = false;

      try {
        const r = await fetch(`${DWTL_BASE}/api/auth/exchange-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hubSessionToken: token }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (r.ok) { ecosystemUser = await r.json(); CIRCUIT_BREAKER.recordSuccess(); }
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') isTimeout = true;
        CIRCUIT_BREAKER.recordFailure();
      }

      if (!ecosystemUser && token.length >= 48) {
        try {
          const r = await fetch(`${DWTL_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (r.ok) {
            const d = await r.json();
            ecosystemUser = d.user || d;
            CIRCUIT_BREAKER.recordSuccess();
          }
        } catch (err) {
          if (err.name === 'TimeoutError' || err.name === 'AbortError') isTimeout = true;
          CIRCUIT_BREAKER.recordFailure();
        }
      }

      if (!ecosystemUser?.email) {
        if (isTimeout) return res.status(503).json({ success: false, error: "Trust Layer timed out", degraded: true });
        return res.status(401).json({ success: false, error: "Invalid or expired SSO token" });
      }

      // Ensure user exists locally
      let localUser = null;
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [ecosystemUser.email]);
      
      if (rows.length) {
        localUser = rows[0];
        // Ensure verified is true for SSO
        if (!localUser.verified) {
          await db.query('UPDATE users SET verified = true WHERE id = $1', [localUser.id]);
        }
      } else {
        const { rows: newRows } = await db.query(
          'INSERT INTO users (display_name, email, verified) VALUES ($1, $2, true) RETURNING *',
          [ecosystemUser.displayName || ecosystemUser.firstName || ecosystemUser.username || ecosystemUser.email.split('@')[0], ecosystemUser.email]
        );
        localUser = newRows[0];
      }

      // Generate actual JWT & Persist Session
      const jwtToken = createJWT({ uid: localUser.id, name: localUser.display_name });
      const hash = hashToken(jwtToken);
      const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
      
      await db.query(
        'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [localUser.id, hash, expiresAt]
      );

      res.json({
        success: true,
        user: {
          id: localUser.id,
          email: localUser.email,
          username: ecosystemUser.username || localUser.email.split("@")[0],
          displayName: localUser.display_name,
          uniqueHash: ecosystemUser.uniqueHash || null,
        },
        sessionToken: jwtToken,
        trustLayerId: ecosystemUser.uniqueHash || ecosystemUser.userId || null,
        ssoLinked: true,
      });
      console.log(`[TL SSO] ${APP_SLUG}: Verified ${ecosystemUser.email}`);
    } catch (e) {
      console.error(`[TL SSO] ${APP_SLUG}:`, e?.message);
      res.status(500).json({ success: false, error: "SSO login failed" });
    }
  });

  app.get("/api/auth/trust-layer/login-url", (req, res) => {
    const cb = req.query.callback || "/";
    res.json({
      url: `${DWTL_BASE}/login?app=${APP_SLUG}&redirect=${encodeURIComponent(cb)}`,
      provider: "Trust Layer",
      baseUrl: DWTL_BASE,
    });
  });

  app.get("/api/auth/trust-layer/status", (_req, res) => {
    res.json({ sso: true, provider: "Trust Layer", app: APP_SLUG, dwtlBase: DWTL_BASE, circuitBreakerOpen: CIRCUIT_BREAKER.isOpen });
  });

  app.get("/api/auth/trust-layer/health", async (_req, res) => {
    if (CIRCUIT_BREAKER.isOpen) return res.status(503).json({ healthy: false, reason: "Circuit breaker open" });
    try {
      const r = await fetch(`${DWTL_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { CIRCUIT_BREAKER.recordSuccess(); return res.json({ healthy: true }); }
      CIRCUIT_BREAKER.recordFailure(); res.status(503).json({ healthy: false, reason: "Status " + r.status });
    } catch (err) { CIRCUIT_BREAKER.recordFailure(); res.status(503).json({ healthy: false, reason: err?.message }); }
  });

  console.log(`[TL SSO] ${APP_SLUG}: SSO endpoints registered (circuit breaker enabled)`);
}
