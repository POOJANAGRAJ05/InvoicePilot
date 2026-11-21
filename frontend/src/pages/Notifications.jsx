
import { useEffect, useState } from "react";
import axios from "axios";

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState("ALL");

  const notificationUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/notifications/";

  const loadNotifications = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axios.get(notificationUrl);

      let data = response.data;

      if (data && data.results) {
        data = data.results;
      }

      if (Array.isArray(data)) {
        setNotifications(data);
      } else {
        setNotifications([]);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load notifications. Please check the backend.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const markAsRead = async (notificationId) => {
    setUpdatingId(notificationId);
    setError("");

    try {
      await axios.post(
        notificationUrl + notificationId + "/mark-read/"
      );

      setNotifications((previous) =>
        previous.map((item) =>
          item.id === notificationId
            ? { ...item, is_read: true }
            : item
        )
      );
    } catch (err) {
      console.error(err);
      setError("Failed to mark notification as read.");
    } finally {
      setUpdatingId(null);
    }
  };

  const markAllAsRead = async () => {
    setMarkingAll(true);
    setError("");

    try {
      await axios.post(notificationUrl + "mark-all-read/");

      setNotifications((previous) =>
        previous.map((item) => ({ ...item, is_read: true }))
      );
    } catch (err) {
      console.error(err);
      setError("Failed to mark all notifications as read.");
    } finally {
      setMarkingAll(false);
    }
  };

  const filteredNotifications = notifications.filter((item) => {
    if (filter === "UNREAD") {
      return item.is_read === false;
    }

    if (filter === "READ") {
      return item.is_read === true;
    }

    return true;
  });

  const unreadCount = notifications.filter(
    (item) => item.is_read === false
  ).length;

  const getNotificationStyle = (type) => {
    const value = (type || "").toUpperCase();

    if (value.includes("OVERDUE")) {
      return {
        icon: "🚨",
        color: "border-red-200 bg-red-50",
        badge: "bg-red-100 text-red-700",
      };
    }

    if (value.includes("DUE")) {
      return {
        icon: "📅",
        color: "border-amber-200 bg-amber-50",
        badge: "bg-amber-100 text-amber-700",
      };
    }

    if (value.includes("DUPLICATE")) {
      return {
        icon: "⚠️",
        color: "border-orange-200 bg-orange-50",
        badge: "bg-orange-100 text-orange-700",
      };
    }

    if (value.includes("EXCEPTION")) {
      return {
        icon: "❌",
        color: "border-red-200 bg-red-50",
        badge: "bg-red-100 text-red-700",
      };
    }

    if (value.includes("VENDOR")) {
      return {
        icon: "🏢",
        color: "border-purple-200 bg-purple-50",
        badge: "bg-purple-100 text-purple-700",
      };
    }

    return {
      icon: "🔔",
      color: "border-blue-200 bg-blue-50",
      badge: "bg-blue-100 text-blue-700",
    };
  };

  const formatType = (type) => {
    if (!type) {
      return "Notification";
    }

    return type.replaceAll("_", " ");
  };

  const formatDate = (dateValue) => {
    if (!dateValue) {
      return "—";
    }

    const date = new Date(dateValue);

    if (isNaN(date.getTime())) {
      return "—";
    }

    return date.toLocaleString();
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* HEADER */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor invoice reminders, exceptions, vendor alerts, and automation events.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={loadNotifications}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "↻ Refresh"}
          </button>

          <button
            onClick={markAllAsRead}
            disabled={markingAll || unreadCount === 0}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {markingAll ? "Updating..." : "Mark all as read"}
          </button>
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Notifications</p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">
            {notifications.length}
          </h2>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-sm text-amber-700">Unread Notifications</p>
          <h2 className="mt-2 text-3xl font-bold text-amber-900">
            {unreadCount}
          </h2>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm text-emerald-700">Read Notifications</p>
          <h2 className="mt-2 text-3xl font-bold text-emerald-900">
            {notifications.length - unreadCount}
          </h2>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* FILTERS */}
      <div className="flex flex-wrap gap-2">
        {["ALL", "UNREAD", "READ"].map((option) => (
          <button
            key={option}
            onClick={() => setFilter(option)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              filter === option
                ? "bg-blue-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option === "ALL"
              ? "All Notifications"
              : option === "UNREAD"
                ? "Unread"
                : "Read"}
          </button>
        ))}
      </div>

      {/* NOTIFICATION LIST */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-900">
            Notification Center
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Your invoice automation alerts and reminders.
          </p>
        </div>

        {loading && notifications.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            Loading notifications...
          </div>
        )}

        {!loading && filteredNotifications.length === 0 && !error && (
          <div className="p-10 text-center">
            <div className="text-4xl">🔔</div>
            <h3 className="mt-3 font-semibold text-slate-800">
              No notifications found
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {filter === "UNREAD"
                ? "You're all caught up!"
                : "Notifications will appear here when automation generates them."}
            </p>
          </div>
        )}

        {filteredNotifications.length > 0 && (
          <div className="divide-y divide-slate-100">
            {filteredNotifications.map((item) => {
              const style = getNotificationStyle(item.notification_type);

              return (
                <div
                  key={item.id}
                  className={`border-l-4 p-5 transition hover:bg-slate-50 ${
                    item.is_read
                      ? "border-l-slate-300 bg-white"
                      : style.color
                  }`}
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row">
                    <div className="flex gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl shadow-sm">
                        {style.icon}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900">
                            {item.title || "Notification"}
                          </h3>

                          {!item.is_read && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              New
                            </span>
                          )}
                        </div>

                        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                          {formatType(item.notification_type)}
                        </p>

                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {item.message || "No details available."}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                          {item.invoice_number && (
                            <span>
                              Invoice: {item.invoice_number}
                            </span>
                          )}

                          <span>{formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>

                    {!item.is_read && (
                      <button
                        onClick={() => markAsRead(item.id)}
                        disabled={updatingId === item.id}
                        className="self-start whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {updatingId === item.id
                          ? "Updating..."
                          : "Mark as read"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredNotifications.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
            Showing {filteredNotifications.length} notification(s)
          </div>
        )}
      </div>
    </div>
  );
}

export default Notifications;


