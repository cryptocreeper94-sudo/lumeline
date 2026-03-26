// ═══════════════════════════════════════════
//  LumeLine Auth Module
//  Twilio SMS OTP + Resend Email OTP + WebAuthn + JWT
//  Part of the Trust Layer Ecosystem
// ═══════════════════════════════════════════

import crypto from 'crypto';
import { Router } from 'express';
import db from './db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const OTP_EXPIRY_MINUTES = 10;
export const SESSION_DAYS = 30;

// ═══ HELPERS ═══

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function createJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (SESSION_DAYS * 86400)
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ═══ SEND OTP ═══

async function sendSmsOTP(phone, code) {
  try {
    const twilio = await import('twilio');
    const client = twilio.default(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `LumeLine verification code: ${code}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    return true;
  } catch (err) {
    console.error('❌ Twilio SMS error:', err.message);
    return false;
  }
}

async function sendEmailOTP(email, code) {
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'LumeLine <noreply@lumeline.bet>',
      to: email,
      subject: `Your LumeLine verification code: ${code}`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;background:#030712;color:#fff;padding:40px;border-radius:16px;max-width:480px;margin:0 auto">
          <div style="font-size:24px;font-weight:900;margin-bottom:24px;background:linear-gradient(135deg,#f0f9ff,#67e8f9);-webkit-background-clip:text;-webkit-text-fill-color:transparent">LumeLine</div>
          <p style="color:rgba(255,255,255,.5);font-size:14px;margin-bottom:24px">Your verification code is:</p>
          <div style="font-size:36px;font-weight:900;color:#67e8f9;letter-spacing:.15em;padding:20px;background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.15);border-radius:14px;text-align:center;margin-bottom:24px">${code}</div>
          <p style="color:rgba(255,255,255,.25);font-size:12px">This code expires in ${OTP_EXPIRY_MINUTES} minutes. If you didn't request this, ignore this email.</p>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.04);font-size:10px;color:rgba(255,255,255,.1)">LumeLine · Trust Layer Ecosystem · DarkWave Studios</div>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error('❌ Resend email error:', err.message);
    return false;
  }
}

// ═══ AUTH MIDDLEWARE ═══

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const payload = verifyJWT(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Check session exists
  const hash = hashToken(token);
  const { rows } = await db.query('SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > NOW()', [hash]);
  if (!rows.length) {
    return res.status(401).json({ error: 'Session expired' });
  }
  // Attach user
  const { rows: users } = await db.query('SELECT * FROM users WHERE id = $1', [payload.uid]);
  if (!users.length) {
    return res.status(401).json({ error: 'User not found' });
  }
  req.user = users[0];
  next();
}

// ═══ PLAN GATING MIDDLEWARE ═══
// Plans: 'game_predictions', 'house_decoder', 'all_access'
// all_access grants access to everything

const PLAN_PRICES = {
  game_predictions: { early: 999, standard: 1999, name: 'Game Predictions' },
  house_decoder:    { early: 1499, standard: 2999, name: 'House Decoder' },
  all_access:       { early: 1999, standard: 3999, name: 'All-Access' }
};

const EARLY_BIRD_LIMIT = 1000; // first 1K subscribers get early bird pricing

export function requirePlan(requiredPlan) {
  return (req, res, next) => {
    const prefs = req.user?.preferences || {};
    const userPlan = prefs.plan;

    // all_access unlocks everything
    if (userPlan === 'all_access') return next();

    // Check if user has the specific plan
    // If they have multiple plans stored as an array, check that too
    const userPlans = Array.isArray(prefs.plans) ? prefs.plans : [userPlan].filter(Boolean);

    if (userPlans.includes(requiredPlan) || userPlans.includes('all_access')) {
      return next();
    }

    const planInfo = PLAN_PRICES[requiredPlan] || PLAN_PRICES.all_access;
    return res.status(403).json({
      error: 'Subscription required',
      required_plan: requiredPlan,
      plan_name: planInfo.name,
      pricing: {
        early_bird: `$${(planInfo.early / 100).toFixed(2)}/mo (first ${EARLY_BIRD_LIMIT} subscribers)`,
        standard: `$${(planInfo.standard / 100).toFixed(2)}/mo`
      },
      upgrade_url: '/api/stripe/checkout',
      plans_available: Object.entries(PLAN_PRICES).map(([key, val]) => ({
        plan: key,
        name: val.name,
        early_bird: `$${(val.early / 100).toFixed(2)}/mo`,
        standard: `$${(val.standard / 100).toFixed(2)}/mo`
      }))
    });
  };
}

export { PLAN_PRICES, EARLY_BIRD_LIMIT };

// ═══ SIGNUP ═══
router.post('/signup', async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email is required' });

    // Check existing
    if (phone) {
      const { rows } = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
      if (rows.length) return res.status(409).json({ error: 'Phone already registered', existing: true });
    }
    if (email) {
      const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (rows.length) return res.status(409).json({ error: 'Email already registered', existing: true });
    }

    // Create user
    const { rows } = await db.query(
      'INSERT INTO users (display_name, phone, email) VALUES ($1, $2, $3) RETURNING *',
      [name, phone || null, email || null]
    );
    const user = rows[0];

    // Generate + send OTP
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);
    const contact = phone || email;
    const type = phone ? 'sms' : 'email';

    await db.query(
      'INSERT INTO otp_codes (contact, code, type, expires_at) VALUES ($1, $2, $3, $4)',
      [contact, code, type, expiresAt]
    );

    let sent;
    if (phone) {
      sent = await sendSmsOTP(phone, code);
    } else {
      sent = await sendEmailOTP(email, code);
    }

    console.log(`📱 OTP sent to ${type === 'sms' ? phone : email}: ${sent ? '✅' : '❌'}`);

    res.status(201).json({
      message: `Verification code sent via ${type}`,
      user_id: user.id,
      contact,
      type,
      sent
    });
  } catch (err) {
    console.error('POST /auth/signup error:', err);
    res.status(500).json({ error: 'Signup failed', message: err.message });
  }
});

// ═══ LOGIN (Send OTP) ═══
router.post('/login', async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email is required' });

    const contact = phone || email;
    const field = phone ? 'phone' : 'email';
    const { rows } = await db.query(`SELECT * FROM users WHERE ${field} = $1`, [contact]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });

    const code = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60000);
    const type = phone ? 'sms' : 'email';

    await db.query(
      'INSERT INTO otp_codes (contact, code, type, expires_at) VALUES ($1, $2, $3, $4)',
      [contact, code, type, expiresAt]
    );

    let sent;
    if (phone) {
      sent = await sendSmsOTP(phone, code);
    } else {
      sent = await sendEmailOTP(email, code);
    }

    res.json({ message: `Verification code sent via ${type}`, contact, type, sent });
  } catch (err) {
    res.status(500).json({ error: 'Login failed', message: err.message });
  }
});

// ═══ VERIFY OTP ═══
router.post('/verify', async (req, res) => {
  try {
    const { contact, code } = req.body;
    if (!contact || !code) return res.status(400).json({ error: 'Contact and code are required' });

    // Find valid OTP
    const { rows: otps } = await db.query(
      'SELECT * FROM otp_codes WHERE contact = $1 AND code = $2 AND NOT used AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
      [contact, code]
    );
    if (!otps.length) return res.status(401).json({ error: 'Invalid or expired code' });

    // Mark used
    await db.query('UPDATE otp_codes SET used = true WHERE id = $1', [otps[0].id]);

    // Find user
    const isPhone = contact.startsWith('+');
    const field = isPhone ? 'phone' : 'email';
    const { rows: users } = await db.query(`SELECT * FROM users WHERE ${field} = $1`, [contact]);
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const user = users[0];

    // Mark verified + update last login
    await db.query('UPDATE users SET verified = true, last_login = NOW() WHERE id = $1', [user.id]);

    // Create JWT + session
    const token = createJWT({ uid: user.id, name: user.display_name });
    const hash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
    await db.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hash, expiresAt]
    );

    console.log(`✅ User verified: ${user.display_name} (${contact})`);

    res.json({
      token,
      user: {
        id: user.id,
        display_name: user.display_name,
        email: user.email,
        phone: user.phone,
        verified: true
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed', message: err.message });
  }
});

// ═══ ME (Get current user) ═══
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Get user picks
    const { rows: picks } = await db.query(
      'SELECT up.*, g.home_team, g.away_team, g.sport, g.start_time FROM user_picks up LEFT JOIN games g ON up.game_id = g.id WHERE up.user_id = $1 ORDER BY up.submitted_at DESC',
      [req.user.id]
    );

    // Stats
    const wins = picks.filter(p => p.result === 'win').length;
    const losses = picks.filter(p => p.result === 'loss').length;
    const total = picks.filter(p => p.result && p.result !== 'pending').length;
    const accuracy = total > 0 ? Math.round((wins / total) * 100) : 0;
    const streak = calculateStreak(picks);

    // Passkeys
    const { rows: passkeys } = await db.query(
      'SELECT id, device_name, created_at FROM passkeys WHERE user_id = $1',
      [req.user.id]
    );

    res.json({
      user: {
        id: req.user.id,
        display_name: req.user.display_name,
        email: req.user.email,
        phone: req.user.phone,
        verified: req.user.verified,
        created_at: req.user.created_at,
        last_login: req.user.last_login,
        preferences: req.user.preferences
      },
      stats: { wins, losses, total, accuracy, streak },
      picks,
      passkeys
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile', message: err.message });
  }
});

// ═══ LOGOUT ═══
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const token = req.headers.authorization.slice(7);
    const hash = hashToken(token);
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ═══ USER PICKS ═══
router.post('/picks', requireAuth, async (req, res) => {
  try {
    const { game_id, pick_side, confidence } = req.body;
    if (!game_id || !pick_side) return res.status(400).json({ error: 'game_id and pick_side required' });

    const { rows } = await db.query(
      'INSERT INTO user_picks (user_id, game_id, pick_side, confidence) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, game_id) DO UPDATE SET pick_side = $3, confidence = $4 RETURNING *',
      [req.user.id, game_id, pick_side, confidence || 50]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit pick', message: err.message });
  }
});

// ═══ UPDATE PROFILE ═══
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { display_name, preferences } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (display_name) { updates.push(`display_name = $${idx++}`); values.push(display_name); }
    if (preferences) { updates.push(`preferences = $${idx++}`); values.push(JSON.stringify(preferences)); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    values.push(req.user.id);
    const { rows } = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// ═══ HELPERS ═══

function calculateStreak(picks) {
  const resolved = picks.filter(p => p.result === 'win' || p.result === 'loss');
  if (!resolved.length) return 0;
  let streak = 0;
  const streakType = resolved[0]?.result;
  for (const pick of resolved) {
    if (pick.result === streakType) streak++;
    else break;
  }
  return streakType === 'win' ? streak : -streak;
}

export default router;
