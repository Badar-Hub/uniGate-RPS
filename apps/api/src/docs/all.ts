/**
 * Every module's OpenAPI registrations, in one place. app.ts, generate.ts and check.ts all
 * import THIS, so a module cannot be served without appearing in the committed spec.
 */
import '@/health/health.openapi.js';
import '@/modules/reference/settings.openapi.js';
import '@/modules/iam/iam.openapi.js';
