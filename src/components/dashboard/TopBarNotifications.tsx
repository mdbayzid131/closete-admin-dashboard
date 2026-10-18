"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  Package,
  AlertCircle,
  FileText,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { adminApi, getAuthToken } from "@/lib/api";
import { requestWebPushToken, onForegroundMessage } from "@/lib/firebase";
import { getSocket } from "@/lib/socket";

export type AlertItem = {
  id: string;
  backendId?: string;
  type: "review" | "order" | "issue" | "system";
  title: string;
  description: string;
  time: string;
  link: string;
  read: boolean;
};

// Module-level deduplication to prevent multiple simultaneous API calls across mobile/desktop mounts
let cachedAlerts: AlertItem[] | null = null;
let lastCacheTime = 0;
let inFlightAlertsPromise: Promise<AlertItem[]> | null = null;
const recentDesktopNotifications = new Map<string, number>();

export default function TopBarNotifications() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load read IDs from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("closete_read_alerts");
      if (stored) {
        setReadIds(new Set(JSON.parse(stored)));
      }
    } catch {}

    if (typeof window !== "undefined" && "Notification" in window) {
      setPushPermission(Notification.permission);
    } else {
      setPushPermission("unsupported");
    }
  }, []);

  const loadAlerts = async (force = false) => {
    const now = Date.now();
    if (!force && cachedAlerts && now - lastCacheTime < 4000) {
      setAlerts(cachedAlerts);
      return;
    }

    if (inFlightAlertsPromise) {
      try {
        const res = await inFlightAlertsPromise;
        setAlerts(res);
      } catch {}
      return;
    }

    inFlightAlertsPromise = (async () => {
      const collectedAlerts: AlertItem[] = [];

      try {
        const notifRes = await adminApi.getNotifications();
        const list = Array.isArray(notifRes.data)
          ? notifRes.data
          : Array.isArray(notifRes.data?.result)
            ? notifRes.data.result
            : [];

        list.forEach((n: any) => {
          const rawId = (n._id || n.id)?.toString();
          const notifType = (n.type || "").toLowerCase();
          let alertType: AlertItem["type"] = "system";
          let link = "/all-orders";

          if (notifType.includes("review") || notifType.includes("product") || notifType.includes("item_listed")) {
            alertType = "review";
            link = "/pending-review";
          } else if (notifType.includes("issue") || notifType.includes("dispute")) {
            alertType = "issue";
            link = "/issues";
          } else if (notifType.includes("order") || notifType.includes("payment")) {
            alertType = "order";
            link = "/all-orders";
          }

          collectedAlerts.push({
            id: `backend-${rawId}`,
            backendId: rawId,
            type: alertType,
            title: n.title || "Notification",
            description: n.body || n.message || "",
            time: n.createdAt
              ? new Date(n.createdAt).toLocaleDateString()
              : "Recent",
            link: n.link || n.url || link,
            read: Boolean(n.readAt || n.read || n.isRead),
          });
        });
      } catch (err) {
        console.warn("Could not load backend notifications:", err);
      }

      cachedAlerts = collectedAlerts;
      lastCacheTime = Date.now();
      return collectedAlerts;
    })().finally(() => {
      inFlightAlertsPromise = null;
    });

    try {
      const result = await inFlightAlertsPromise;
      setAlerts(result);
    } catch {}
  };

  // Fetch notifications on mount and set up 25s polling
  useEffect(() => {
    loadAlerts();
    const interval = setInterval(() => {
      loadAlerts(true);
    }, 25000);
    return () => clearInterval(interval);
  }, []);

  // Handle FCM Web Push registration
  const handleEnablePush = async () => {
    setIsRegisteringPush(true);
    try {
      const token = await requestWebPushToken();
      if (token && getAuthToken()) {
        await adminApi.registerDeviceToken(token);
        console.log("FCM Web Push token successfully registered with backend");
      }
      if (typeof window !== "undefined" && "Notification" in window) {
        setPushPermission(Notification.permission);
      }
    } catch (err) {
      console.warn("Failed to register web push token:", err);
    } finally {
      setIsRegisteringPush(false);
    }
  };

  // Auto-register if permission already granted and token exists
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      requestWebPushToken().then((token) => {
        if (token && getAuthToken()) {
          adminApi.registerDeviceToken(token).catch(() => {});
        }
      });
    }
  }, []);

  // Deduplicated Desktop Notifications & Table Refresh Helper
  const showDesktopNotification = (title: string, body: string, dedupeKey?: string) => {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const tag = dedupeKey || `${title}::${body}`;
    const now = Date.now();
    const lastTime = recentDesktopNotifications.get(tag);

    // If identical notification was already displayed within the last 10 seconds, ignore duplicate
    if (lastTime && now - lastTime < 10000) {
      return;
    }
    recentDesktopNotifications.set(tag, now);

    // Clean old entries
    if (recentDesktopNotifications.size > 50) {
      for (const [k, t] of recentDesktopNotifications.entries()) {
        if (now - t > 30000) recentDesktopNotifications.delete(k);
      }
    }

    try {
      const notif = new Notification(title, {
        body,
        icon: "/icon.png",
        tag,
      });
      notif.onclick = () => {
        window.focus();
      };
    } catch (e) {
      console.warn("Could not display notification:", e);
    }
  };

  const broadcastTableRefreshes = (type?: string, screen?: string) => {
    if (typeof window === "undefined") return;
    const t = (type || "").toLowerCase();
    const s = (screen || "").toLowerCase();
    if (
      t.includes("item") ||
      t.includes("review") ||
      t.includes("product") ||
      s.includes("pending") ||
      s.includes("review")
    ) {
      window.dispatchEvent(new CustomEvent("closete:refresh-pending-reviews"));
    }
    if (t.includes("order") || t.includes("payment") || s.includes("order")) {
      window.dispatchEvent(new CustomEvent("closete:refresh-orders"));
    }
    if (t.includes("issue") || t.includes("dispute") || s.includes("issue")) {
      window.dispatchEvent(new CustomEvent("closete:refresh-issues"));
    }
  };

  // Foreground FCM listener
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    onForegroundMessage((payload) => {
      console.log("Foreground FCM notification received:", payload);
      loadAlerts(true);
      const title = payload.notification?.title || payload.data?.title || "Closeté Ops";
      const body = payload.notification?.body || payload.data?.body || "New update received";
      const dedupeKey =
        payload.data?.id ||
        payload.data?.notificationId ||
        payload.data?.eventKey ||
        payload.messageId ||
        `${title}::${body}`;

      showDesktopNotification(title, body, dedupeKey);
      broadcastTableRefreshes(payload.data?.type, payload.data?.screen);
    }).then((unsub) => {
      if (unsub) unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Socket.io real-time listener
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewNotification = (data: any) => {
      console.log("[Socket] Real-time notification received:", data);
      loadAlerts(true);
      const title = data.title || "Closeté Ops";
      const body = data.body || "New update received";
      const dedupeKey =
        data._id ||
        data.id ||
        data.eventKey ||
        `${title}::${body}`;

      showDesktopNotification(title, body, dedupeKey);
      broadcastTableRefreshes(data.type, data.data?.screen);
    };

    socket.on("notification:new", handleNewNotification);

    return () => {
      socket.off("notification:new", handleNewNotification);
    };
  }, []);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const unreadAlerts = alerts.filter((a) => !readIds.has(a.id) && !a.read);
  const unreadCount = unreadAlerts.length;

  const displayedAlerts = filter === "unread" ? unreadAlerts : alerts;

  const handleMarkAllRead = async () => {
    const newReadIds = new Set(readIds);
    alerts.forEach((a) => newReadIds.add(a.id));
    setReadIds(newReadIds);
    cachedAlerts = null;
    try {
      localStorage.setItem(
        "closete_read_alerts",
        JSON.stringify(Array.from(newReadIds))
      );
      await adminApi.markAllNotificationsRead();
    } catch (e) {
      console.warn("Failed to mark all notifications as read:", e);
    }
  };

  const handleItemClick = async (alert: AlertItem) => {
    const newReadIds = new Set(readIds);
    newReadIds.add(alert.id);
    setReadIds(newReadIds);
    cachedAlerts = null;
    try {
      localStorage.setItem(
        "closete_read_alerts",
        JSON.stringify(Array.from(newReadIds))
      );
      if (alert.backendId) {
        adminApi.markNotificationRead(alert.backendId).catch(() => {});
      }
    } catch {}
    setIsOpen(false);
    router.push(alert.link);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative h-10 w-10 rounded-full bg-[#1A1A1D] border border-white/5 flex items-center justify-center hover:bg-white/10 transition-colors text-white focus:outline-none"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="h-4.5 w-4.5 text-[#CCCCCC]" />

        {/* Clean, calm badge — no pulse, no neon glow */}
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#FFAF2C]" />
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 sm:w-92 rounded-xl bg-[#141416] border border-white/10 shadow-2xl z-50 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-4 py-3.5 border-b border-white/5 flex items-center justify-between bg-[#18181A]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white tracking-wide">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#FFAF2C]/10 text-[#FFAF2C]">
                  {unreadCount} new
                </span>
              )}
            </div>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-[#8C8C8C] hover:text-[#FFAF2C] transition-colors flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Mark all as read</span>
              </button>
            )}
          </div>

          {/* Clean Segment Tabs */}
          <div className="px-4 py-2 flex items-center gap-1.5 bg-[#121214] border-b border-white/5 text-xs">
            <button
              onClick={() => setFilter("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === "all"
                  ? "bg-white/10 text-white"
                  : "text-[#8C8C8C] hover:text-white"
              }`}
            >
              All ({alerts.length})
            </button>
            <button
              onClick={() => setFilter("unread")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === "unread"
                  ? "bg-white/10 text-[#FFAF2C]"
                  : "text-[#8C8C8C] hover:text-[#FFAF2C]"
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Desktop Push Banner if not yet enabled */}
          {pushPermission === "default" && (
            <div className="px-3.5 py-2 bg-[#FFAF2C]/10 border-b border-[#FFAF2C]/20 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[#FFAF2C] font-normal leading-tight">
                Enable desktop alerts for new reviews & orders
              </span>
              <button
                onClick={handleEnablePush}
                disabled={isRegisteringPush}
                className="px-2.5 py-1 rounded text-[11px] font-medium bg-[#FFAF2C] text-black hover:bg-[#FFAF2C]/90 transition-colors disabled:opacity-50 shrink-0 cursor-pointer shadow-sm"
              >
                {isRegisteringPush ? "Enabling..." : "Enable"}
              </button>
            </div>
          )}

          {/* Alert List — Clean scroll area with completely hidden/clean scrollbar */}
          <div className="max-h-76 overflow-y-auto divide-y divide-white/5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {displayedAlerts.length === 0 ? (
              <div className="py-10 px-4 text-center flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mb-2.5 text-[#666666]">
                  <Inbox className="w-5 h-5" />
                </div>
                <p className="text-xs font-medium text-white mb-0.5">
                  No notifications
                </p>
                <p className="text-[11px] text-[#8C8C8C]">
                  {filter === "unread"
                    ? "You are all caught up."
                    : "No alerts at this time."}
                </p>
              </div>
            ) : (
              displayedAlerts.map((alert) => {
                const isRead = readIds.has(alert.id) || alert.read;
                return (
                  <div
                    key={alert.id}
                    onClick={() => handleItemClick(alert)}
                    className={`px-4 py-3 flex items-start gap-3 cursor-pointer transition-colors hover:bg-white/[0.04] ${
                      !isRead ? "bg-white/[0.015]" : "opacity-75"
                    }`}
                  >
                    {/* Minimalist uniform icon */}
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5 text-[#A0A0A0]">
                      {alert.type === "review" ? (
                        <FileText className="w-4 h-4 text-[#FFAF2C]" />
                      ) : alert.type === "issue" ? (
                        <AlertCircle className="w-4 h-4 text-[#E57373]" />
                      ) : (
                        <Package className="w-4 h-4 text-[#CCCCCC]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span
                          className={`text-xs font-medium truncate ${
                            !isRead ? "text-white" : "text-[#A0A0A0]"
                          }`}
                        >
                          {alert.title}
                        </span>
                        <span className="text-[10px] text-[#666666] shrink-0">
                          {alert.time}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8C8C8C] line-clamp-2 leading-relaxed">
                        {alert.description}
                      </p>
                    </div>

                    {!isRead && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#FFAF2C] shrink-0 self-center" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Navigation */}
          <div className="px-4 py-2.5 border-t border-white/5 bg-[#18181A] flex items-center justify-between text-xs">
            <Link
              href="/pending-review"
              onClick={() => setIsOpen(false)}
              className="text-[#FFAF2C] hover:underline font-medium flex items-center gap-1 transition-colors"
            >
              <span>Pending Review</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/all-orders"
              onClick={() => setIsOpen(false)}
              className="text-[#8C8C8C] hover:text-white transition-colors"
            >
              All Orders
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
