import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Single source of truth for resolving all backend media URLs (Images, PDFs, Proofs).
 * Seamlessly handles:
 * - Public HTTPS URLs (ngrok, S3, CloudFront, Cloudinary) without rewriting or breaking them
 * - Local uploads vs Remote Vercel deployment
 * - ngrok-skip-browser-warning parameter to ensure <img> tags load without interstitial blocking
 */
export function resolveMediaUrl(url?: string): string {
  if (!url || typeof url !== "string" || !url.trim()) return "";
  const trimmed = url.trim();

  // 1. If it's already an absolute URL (http:// or https://)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const isUrlLocalhost =
      trimmed.includes("://localhost") || trimmed.includes("://127.0.0.1");

    // If it's ALREADY a valid remote URL (e.g. https://...ngrok-free.dev or S3/CloudFront)
    // NEVER overwrite or downgrade it to localhost!
    if (!isUrlLocalhost) {
      if (
        trimmed.includes("ngrok") &&
        !trimmed.includes("ngrok-skip-browser-warning")
      ) {
        const sep = trimmed.includes("?") ? "&" : "?";
        return `${trimmed}${sep}ngrok-skip-browser-warning=true`;
      }
      return trimmed;
    }
  }

  // 2. Base URL resolution for relative paths or localhost paths
  const isBrowserLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const envBase =
    process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/v1\/?$/, "") ||
    (isBrowserLocalhost
      ? "http://localhost:5000"
      : "https://democracy-embassy-fiber.ngrok-free.dev");

  const apiBase = isBrowserLocalhost ? "http://localhost:5000" : envBase;

  let resolved = trimmed;

  // If it was stored as localhost in the DB, but the admin is viewing remotely on Vercel:
  if (
    trimmed.startsWith("http://localhost:") ||
    trimmed.startsWith("http://127.0.0.1:") ||
    trimmed.startsWith("https://localhost:")
  ) {
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

  // Auto-append ngrok skip parameter for any ngrok URL so images are not blocked
  if (
    resolved.includes("ngrok") &&
    !resolved.includes("ngrok-skip-browser-warning")
  ) {
    const sep = resolved.includes("?") ? "&" : "?";
    return `${resolved}${sep}ngrok-skip-browser-warning=true`;
  }

  return resolved;
}

// Aliases for clear semantic usage across components
export const formatImageUrl = resolveMediaUrl;
export const formatFileUrl = resolveMediaUrl;