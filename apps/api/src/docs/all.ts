/**
 * Every module's OpenAPI registrations, in one place. app.ts, generate.ts and check.ts all
 * import THIS, so a module cannot be served without appearing in the committed spec.
 */
import '@/health/health.openapi.js';
import '@/modules/reference/settings.openapi.js';
import '@/modules/iam/iam.openapi.js';
import '@/modules/documents/documents.openapi.js';
import '@/modules/profiles/profiles.openapi.js';
import '@/modules/fleet/fleet.openapi.js';
import '@/modules/demand/demand.openapi.js';
import '@/modules/bidding/bidding.openapi.js';
import '@/modules/bookings/bookings.openapi.js';
import '@/modules/payments/payments.openapi.js';
import '@/modules/trips/trips.openapi.js';
import '@/modules/finance/finance.openapi.js';
