import { API_BASE_URL } from "./client";

/**
 * Where this server's own route handlers (login, refresh, logout) reach the API.
 *
 * The browser has to use the public address, but this code runs on the same machine as the API.
 * Going out through the public address sends every session refresh to Cloudflare and back; set
 * API_INTERNAL_URL (for example http://127.0.0.1:9015) to talk to the API directly. Unset, it
 * behaves exactly as before.
 */
export const SERVER_API_URL = (process.env.API_INTERNAL_URL ?? "").replace(/\/+$/, "") || API_BASE_URL;
