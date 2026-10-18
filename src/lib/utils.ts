import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Single source of truth for resolving all backend media URLs (Images, PDFs, Proofs).
 * - S3 / CloudFront / CDN: loaded directly with full caching
 * - ngrok URLs: routed via /api/media proxy to completely eliminate ngrok interstitial browser blocks
 * - Local uploads vs Vercel deployment: automatically resolves correct domain
 */
export function resolveMediaUrl(url?: string): string {
  if (!url || typeof url !== "string" || !url.trim()) return "";
  const trimmed = url.trim();

  // 1. If it's already an absolute URL (http:// or https://)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const isUrlLocalhost =
      trimmed.includes("://localhost") || trimmed.includes("://127.0.0.1");

    // S3, CloudFront, Cloudinary, Firebase, or external CDN (not ngrok, not localhost)
    if (!isUrlLocalhost && !trimmed.includes("ngrok")) {
      return trimmed;
    }

    // ngrok tunnel URL: route through media proxy so browser <img> tags load without interstitial warning
    if (trimmed.includes("ngrok")) {
      const cleanUrl = trimmed.split("?")[0];
      return `/api/media?url=${encodeURIComponent(cleanUrl)}`;
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

  // If it was stored as localhost in the DB, but admin is viewing remotely on Vercel:
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

  // If resolved URL is on ngrok, route through proxy
  if (resolved.includes("ngrok")) {
    const cleanUrl = resolved.split("?")[0];
    return `/api/media?url=${encodeURIComponent(cleanUrl)}`;
  }

  return resolved;
}

// Aliases for clear semantic usage across components
export const formatImageUrl = resolveMediaUrl;
export const formatFileUrl = resolveMediaUrl;