import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Single source of truth for resolving all backend media URLs (Images, PDFs, Proofs).
 * Controlled entirely via ONE environment variable: NEXT_PUBLIC_API_BASE_URL.
 * 
 * - In Production: Set NEXT_PUBLIC_API_BASE_URL in .env / Vercel (e.g. https://api.closete.com/api/v1).
 *   No code changes are ever required!
 * - In Local / Dev: Automatically resolves localhost vs tunnels seamlessly.
 */
export function resolveMediaUrl(url?: string): string {
  if (!url || typeof url !== "string" || !url.trim()) return "";
  const trimmed = url.trim();

  // 1. Single source of truth for API base from environment
  const envBase =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, "") ||
    "http://localhost:5000";

  // 2. In local browser dev with ngrok configured, route localhost directly to avoid tunnel limits
  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const apiBase =
    isLocalhost && envBase.includes("ngrok") ? "http://localhost:5000" : envBase;

  // 3. Resolve path to absolute backend URL
  let resolved = trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    if (trimmed.includes("/uploads/")) {
      const uploadPath = trimmed.substring(trimmed.indexOf("/uploads/"));
      resolved = `${apiBase}${uploadPath}`;
    }
  } else if (trimmed.startsWith("/uploads/")) {
    resolved = `${apiBase}${trimmed}`;
  } else if (trimmed.startsWith("/")) {
    resolved = `${apiBase}${trimmed}`;
  } else {
    resolved = `${apiBase}/uploads/${trimmed}`;
  }

  // 4. If using an ngrok tunnel URL during development, auto-append the skip parameter
  if (
    resolved.includes("ngrok") &&
    !resolved.includes("ngrok-skip-browser-warning")
  ) {
    const separator = resolved.includes("?") ? "&" : "?";
    return `${resolved}${separator}ngrok-skip-browser-warning=true`;
  }

  return resolved;
}

// Aliases for clear semantic usage across components
export const formatImageUrl = resolveMediaUrl;
export const formatFileUrl = resolveMediaUrl;