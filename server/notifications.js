/**
 * LumeLine — Twilio SMS Notifications
 * Sends alerts for high-confidence consensus and anomaly detection.
 */

import dotenv from 'dotenv';
dotenv.config();

let twilioClient = null;
let twilioPhone = null;
export let twilioEnabled = false;

export function initTwilio() {
  const sid = process.env.TWILIO_SID || process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH || process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE || process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !auth || !phone) {
    console.log('⚠️  Twilio not configured — SMS alerts disabled');
    twilioEnabled = false;
    return false;
  }

  try {
    // Dynamic import for optional dependency
    import('twilio').then(({ default: twilio }) => {
      twilioClient = twilio(sid, auth);
      twilioPhone = phone;
      twilioEnabled = true;
      console.log(`📲 Twilio SMS initialized: ${phone}`);
    }).catch(() => {
      twilioEnabled = false;
      console.log('⚠️  twilio package not installed — SMS alerts disabled');
    });
    return true;
  } catch (err) {
    twilioEnabled = false;
    console.log('⚠️  Twilio init failed:', err.message);
    return false;
  }
}

async function sendSMS(to, body) {
  if (!twilioEnabled) return { success: false, error: 'Twilio not configured' };
  try {
    const msg = await twilioClient.messages.create({ body, from: twilioPhone, to });
    console.log(`📤 SMS sent to ${to}: ${msg.sid}`);
    return { success: true, messageId: msg.sid };
  } catch (err) {
    console.error(`❌ SMS failed to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

export async function sendConsensusAlert(phone, game, consensus) {
  const lean = consensus.house_lean ? '🏠 House Lean Active' : '✅ Clean';
  const body = `🎯 LumeLine Alert\n` +
    `${game.away_team} @ ${game.home_team}\n` +
    `Home: ${consensus.home_likelihood}% | Away: ${consensus.away_likelihood}%\n` +
    `Confidence: ${consensus.confidence}% | Integrity: ${consensus.integrity}/100\n` +
    `${lean}\n` +
    `${consensus.reasoning || ''}`;
  return sendSMS(phone, body);
}

export async function sendAnomalyAlert(phone, game, anomaly) {
  const icons = { critical: '🚨', high: '⚠️', medium: '📋', low: 'ℹ️' };
  const body = `${icons[anomaly.severity] || '📋'} LumeLine Anomaly\n` +
    `${game.away_team} @ ${game.home_team}\n` +
    `Signal: ${anomaly.signal_type.replace('_', ' ')}\n` +
    `Severity: ${anomaly.severity.toUpperCase()}\n` +
    `${anomaly.description}`;
  return sendSMS(phone, body);
}

export async function sendDailySummary(phone, stats) {
  const body = `📊 LumeLine Daily Brief\n` +
    `Games: ${stats.gameCount} active\n` +
    `Top Source: ${stats.topSource} (${stats.topAccuracy}%)\n` +
    `Anomalies: ${stats.anomalyCount} detected\n` +
    `High Confidence Picks: ${stats.highConfCount}`;
  return sendSMS(phone, body);
}

export function getTwilioStatus() {
  return {
    configured: !!twilioClient,
    phoneNumber: twilioPhone
  };
}
