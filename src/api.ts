/**
 * API base URL helper.
 * In development: relative /api/* paths are proxied by Vite to localhost:3001.
 * In production: VITE_API_URL must point to the deployed signal service.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
