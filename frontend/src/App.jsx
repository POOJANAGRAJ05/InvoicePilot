
import { useEffect, useState } from "react";
import axios from "axios";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useLocation,
} from "react-router-dom";

import Payments from "./pages/Payments";
import Invoices from "./pages/Invoices";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Vendors from "./pages/Vendors";
import PurchaseOrders from "./pages/PurchaseOrders";
import POMatching from "./pages/POMatching";
import Automation from "./pages/Automation";
import Notifications from "./pages/Notifications";
import Approvals from "./pages/Approvals";
import Settings from "./pages/Settings";

const menuItems = [
  { name: "Dashboard", path: "/" },
  { name: "Invoices", path: "/invoices" },
  { name: "Vendors", path: "/vendors" },
  { name: "Purchase Orders", path: "/purchase-orders" },
  { name: "PO Matching", path: "/po-matching" },
  { name: "Approvals", path: "/approvals" },
  { name: "Payments", path: "/payments" },
  { name: "Reports", path: "/reports" },
  { name: "Automation", path: "/automation" },
  { name: "Notifications", path: "/notifications" },
  { name: "Settings", path: "/settings" },
];

function AppLayout() {
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  const currentPage =
    menuItems.find((item) => item.path === location.pathname)?.name || "Dashboard";

  useEffect(() => {
    let isMounted = true;

    const fetchUnreadNotifications = async () => {
      try {
        const response = await axios.get(
          "https://invoicepilot-ocr.onrender.com/api/automation/dashboard/"
        );

        if (isMounted && response.data && response.data.summary) {
          setUnreadCount(
            Number(response.data.summary.unread_notifications) || 0
          );
        }
      } catch (error) {
        console.error("Failed to fetch unread notification count:", error);
      }
    };

    fetchUnreadNotifications();

    const intervalId = setInterval(fetchUnreadNotifications, 10000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 hidden h-screen w-64 bg-slate-950 p-6 text-white md:block">
        <h1 className="mb-2 text-2xl font-bold">
          Invoice<span className="text-blue-400">Pilot</span>
        </h1>

        <p className="mb-10 text-xs text-slate-400">
          SMART ACCOUNTS PAYABLE
        </p>

        <nav className="space-y-3">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm transition ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800"
                }`
              }
            >
              <span>{item.name}</span>

              {/* Unread notifications badge */}
              {item.path === "/notifications" && unreadCount > 0 && (
                <span className="ml-3 flex min-w-[24px] items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="min-h-screen md:ml-64">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <h2 className="text-xl font-bold">{currentPage}</h2>
            <p className="text-sm text-slate-500">
              Welcome to InvoicePilot
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:block">
              Admin
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
              A
            </div>
          </div>
        </header>

        {/* Routes */}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/po-matching" element={<POMatching />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/automation" element={<Automation />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;



