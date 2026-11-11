/**
 * Memoize for one server request: React's `cache`. In a server component
 * render it shares one call between the student layout and the page, which
 * React renders in the same request. Its own module so the M1 measurement
 * (src/lib/readiness/dashboard-query-count.test.tsx) can stand in a memo that
 * works under its renderer, where React's non-server build passes through.
 */
export { cache as perRequest } from "react";
