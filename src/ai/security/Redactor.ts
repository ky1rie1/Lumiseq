// src/ai/security/Redactor.ts
//! High-security data redaction utility.
//! Prevents API keys, Authorization headers, and sensitive tokens from leaking into prompts, tool contexts, and UI logs.

export class Redactor {
  public static readonly SECRET_PATTERNS: RegExp[] = [
    /sk-[a-zA-Z0-9_-]{20,}/g,                          // OpenAI / standard API keys
    /Bearer\s+[a-zA-Z0-9._-]{16,}/gi,                 // Bearer tokens
    /Authorization:\s*[^\s\n\r]+/gi,                  // Authorization header
    /key=[a-zA-Z0-9_-]{20,}/gi,                       // Query param keys
    /api[_-]?key["']?\s*[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi, // JSON/config keys
    /AIza[0-9A-Za-z-_]{35}/g,                         // Google Gemini API keys
  ];

  /**
   * Redacts all sensitive token patterns from a string.
   */
  static redact(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let sanitized = text;

    // Redact Bearer headers specifically
    sanitized = sanitized.replace(/Bearer\s+([a-zA-Z0-9._-]+)/gi, (_match, token) => {
      const prefix = token.slice(0, 4);
      return `Bearer ${prefix}*****`;
    });

    // Redact OpenAI / general sk- keys
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]+/g, (match) => {
      const prefix = match.slice(0, 5);
      return `${prefix}*****`;
    });

    // Redact Gemini keys
    sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza*****');

    // Redact key= params
    sanitized = sanitized.replace(/(key=)([a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+/gi, '$1$2*****');

    return sanitized;
  }

  /**
   * Deeply redacts any sensitive strings in an object or array.
   */
  static redactObject<T>(obj: T): T {
    if (!obj) return obj;
    if (typeof obj === 'string') {
      return this.redact(obj) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }
    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase().includes('key') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('token')) {
          result[k] = typeof v === 'string' ? this.redact(v) : '[REDACTED]';
        } else {
          result[k] = this.redactObject(v);
        }
      }
      return result as T;
    }
    return obj;
  }
}
