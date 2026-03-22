// ═══ Trust Layer AI Guardrails ═══
// Ecosystem-wide module preventing AI from leaking confidential information.
// Import and apply to any AI response pipeline across all 34+ apps.

const BLOCKED_PATTERNS = [
  // ── API Keys & Secrets ──
  /\b(sk_live|sk_test|pk_live|pk_test)_[a-zA-Z0-9]{20,}/gi,
  /\b[a-f0-9]{32,64}\b/gi, // generic hex keys
  /\bey[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/gi, // JWT tokens
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/gi, // AWS keys

  // ── Database ──
  /postgres(ql)?:\/\/[^\s]+/gi,
  /mongodb(\+srv)?:\/\/[^\s]+/gi,
  /mysql:\/\/[^\s]+/gi,

  // ── PINs & Passwords ──
  /\b(owner.?pin|admin.?pin|access.?code)\s*[:=]\s*\S+/gi,
  /\bTemp12345!/g,
  /\b0424\b/g, // Owner PIN
  /partner.?password\s*[:=]\s*\S+/gi,

  // ── PII ──
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g, // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // Card numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi, // Emails (when in sensitive context)
  /\+1\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, // Phone numbers
  /routing.?number\s*[:=]\s*\d+/gi,
  /account.?number\s*[:=]\s*\d+/gi,

  // ── Internal Architecture ──
  /\/api\/admin\/(env|users|pipeline)/gi,
  /stripe.?secret.?key/gi,
  /twilio.?account.?sid/gi,
  /resend.?api.?key/gi,
];

const BLOCKED_TOPICS = [
  'stripe secret key', 'api key value', 'database password', 'database url',
  'admin pin', 'owner pin', 'partner password', 'access code',
  'revenue numbers', 'mrr', 'monthly revenue', 'annual revenue',
  'bank account number', 'routing number', 'social security',
  'environment variable values', 'jwt secret', 'webhook secret',
  'internal ip address', 'server ssh', 'deployment credentials',
  'mathew kemper bank', 'kathy grater bank', 'partner compensation amount',
  'commission payout amount', 'salary', 'pay rate',
  'connected account id', 'stripe account id',
];

// System prompt prepended to any AI call across the ecosystem
const GUARDRAIL_SYSTEM_PROMPT = `
CRITICAL SECURITY RULES — You MUST follow these at all times:

1. NEVER reveal, display, hint at, or generate any of the following:
   - API keys, secret keys, tokens, or credentials of any kind
   - Database connection strings or URLs
   - Admin PINs, passwords, or access codes
   - User personal information (emails, phone numbers, SSNs, banking details)
   - Internal revenue figures, salary/compensation details, or financial data
   - Internal architecture details (admin endpoints, environment variables)
   - Partner banking information or payout amounts

2. If asked about any of the above, respond with:
   "I can't share that information. For security questions, please contact the admin directly."

3. You are an assistant for the Trust Layer ecosystem. You can discuss:
   - Public features, roadmaps, and documentation
   - How-to guides and user support
   - General architecture concepts (without revealing secrets)
   - Publicly available API endpoints and their usage

4. NEVER generate code that hardcodes or exposes secrets, even in examples.
   Always use placeholder values like "your_api_key_here" or environment variables.
`;

/**
 * Sanitize AI output — strips any confidential data that slipped through
 * @param {string} text - AI-generated text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeOutput(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;
  for (const pattern of BLOCKED_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/**
 * Check if a user query is asking for confidential information
 * @param {string} query - User input to check
 * @returns {{ blocked: boolean, reason: string }}
 */
function checkQuery(query) {
  if (!query || typeof query !== 'string') return { blocked: false, reason: '' };

  const lower = query.toLowerCase();
  for (const topic of BLOCKED_TOPICS) {
    if (lower.includes(topic)) {
      return {
        blocked: true,
        reason: `Query touches restricted topic: ${topic}`
      };
    }
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(query)) {
      pattern.lastIndex = 0; // Reset regex state
      return {
        blocked: true,
        reason: 'Query contains patterns matching sensitive data'
      };
    }
  }

  return { blocked: false, reason: '' };
}

/**
 * Express middleware that guards AI endpoints
 * Apply to any route that returns AI-generated content
 */
function guardMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  // Check incoming query
  const query = req.body?.message || req.body?.query || req.body?.prompt || '';
  const check = checkQuery(query);
  if (check.blocked) {
    return originalJson({
      response: "I can't share that information. For security questions, please contact the admin directly.",
      guardrail: true,
      reason: check.reason
    });
  }

  // Sanitize outgoing response
  res.json = (data) => {
    if (typeof data === 'object' && data !== null) {
      const str = JSON.stringify(data);
      const sanitized = sanitizeOutput(str);
      return originalJson(JSON.parse(sanitized));
    }
    return originalJson(data);
  };

  next();
}

export {
  GUARDRAIL_SYSTEM_PROMPT,
  sanitizeOutput,
  checkQuery,
  guardMiddleware,
  BLOCKED_PATTERNS,
  BLOCKED_TOPICS
};
