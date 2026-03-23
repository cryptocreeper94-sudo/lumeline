// ═══════════════════════════════════════════
//  LUME AGENT — OpenAI + ElevenLabs Voice
// ═══════════════════════════════════════════
import express from 'express';
import OpenAI from 'openai';

const router = express.Router();

// ─── OpenAI client ───
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── System prompt — the agent's identity + knowledge ───
const SYSTEM_PROMPT = `You are the LumeLine Assistant — a friendly, knowledgeable sports odds intelligence agent.
You live inside LumeLine (lumeline.bet), a real-time odds tracking and anomaly detection platform built by DarkWave Studios as part of the Trust Layer ecosystem.

KEY FACTS ABOUT LUMELINE:
- Tracks 47+ oddsmakers in real-time across 12+ sportsbooks
- Covers: NBA, NHL, NCAAB (March Madness), MLB, MLS, EPL, La Liga, UFC, Tennis, Golf, Boxing, NASCAR, Cricket, Rugby
- 4 anomaly detectors: Sync Detector, Reverse Steam, Cascade Tracker, House Divergence
- AI Consensus Engine: weighted ensemble model with 71% accuracy
- Source Scoring: every bookmaker/tipster rated on accuracy, consistency, and closing line value
- Featured Partner: King Capper (Sharp Tier) — win rate ~71%, known for NFL/NBA sharp plays
- Pricing: Pro at $9.99/mo (Early Bird pricing), includes unlimited games, SMS alerts, full integrity scores
- Free tier shows first 3 games per sport
- Built on the Trust Layer ecosystem by DarkWave Studios

YOUR PERSONALITY:
- Friendly, casual but professional — like a smart friend who knows sports betting
- Use sports metaphors occasionally
- Keep answers concise (2-4 sentences max unless asked for details)
- For game-specific questions, reference the consensus confidence % and integrity scores
- Never give explicit gambling advice or guarantees — you provide data transparency
- If asked something you don't know, say so honestly and redirect to relevant LumeLine features
- You can discuss general sports news, matchups, and odds concepts

VOICE MODE NOTES:
- When responding for voice, keep answers even shorter (1-2 sentences)
- Be conversational, not robotic
- Use natural speech patterns`;

// ─── POST /api/agent/chat ───
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [], voice = false } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.json({ reply: "I'm still getting set up — my AI brain isn't connected yet. Check back soon!" });
    }

    // Build conversation history
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (voice ? '\n\nIMPORTANT: This is a VOICE response. Keep it SHORT (1-2 sentences max). Be conversational.' : '') },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: voice ? 100 : 300,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "Hmm, I didn't quite catch that. Try asking again!";
    res.json({ reply });
  } catch (err) {
    console.error('Agent chat error:', err.message);
    res.json({ reply: "Something went wrong on my end. Give me a sec and try again!" });
  }
});

// ─── POST /api/agent/voice ───
router.post('/voice', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Voice not configured' });
    }

    // Use a default voice or configured one
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // "Adam" — friendly male

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', err);
      return res.status(502).json({ error: 'Voice synthesis failed' });
    }

    // Stream audio back to client
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-cache');
    const reader = response.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      return pump();
    };
    await pump();
  } catch (err) {
    console.error('Agent voice error:', err.message);
    res.status(500).json({ error: 'Voice synthesis error' });
  }
});

export default router;
