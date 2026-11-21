import { useState } from "react";

const DEFAULT_SETTINGS = {
  companyName: "InvoicePilot",
  email: "",
  phone: "",
  currency: "INR",
  paymentTerms: "30",
  overdueAlerts: true,
  paymentNotifications: true,
};

function getSavedSettings() {
  try {
    const saved = localStorage.getItem("invoicepilot_settings");
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function Settings() {
  const [settings, setSettings] = useState(getSavedSettings);
  const [message, setMessage] = useState("");

  function handleChange(e) {
    const { name, value, type, checked } = e.target;

    setSettings((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));

    setMessage("");
  }

  function handleSave(e) {
    e.preventDefault();

    localStorage.setItem("invoicepilot_settings", JSON.stringify(settings));
    setMessage("Settings saved successfully!");
  }

  function handleReset() {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem("invoicepilot_settings");
    setMessage("Settings reset to default.");
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">
          Manage your company details and application preferences.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Company Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Company Details
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Name
              </label>
              <input
                type="text"
                name="companyName"
                value={settings.companyName}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Email
              </label>
              <input
                type="email"
                name="email"
                value={settings.email}
                onChange={handleChange}
                placeholder="company@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                name="phone"
                value={settings.phone}
                onChange={handleChange}
                placeholder="Enter phone number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Invoice Preferences */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Invoice Preferences
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Currency
              </label>
              <select
                name="currency"
                value={settings.currency}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Payment Terms
              </label>
              <select
                name="paymentTerms"
                value={settings.paymentTerms}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="7">7 Days</option>
                <option value="15">15 Days</option>
                <option value="30">30 Days</option>
                <option value="45">45 Days</option>
                <option value="60">60 Days</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Notifications
          </h2>

          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-gray-800">Overdue Invoice Alerts</p>
                <p className="text-sm text-gray-500">
                  Receive alerts for invoices past their due date.
                </p>
              </div>
              <input
                type="checkbox"
                name="overdueAlerts"
                checked={settings.overdueAlerts}
                onChange={handleChange}
                className="w-5 h-5 accent-blue-600"
              />
            </label>

            <hr className="border-gray-100" />

            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <p className="font-medium text-gray-800">Payment Notifications</p>
                <p className="text-sm text-gray-500">
                  Receive notifications when invoice payments are recorded.
                </p>
              </div>
              <input
                type="checkbox"
                name="paymentNotifications"
                checked={settings.paymentNotifications}
                onChange={handleChange}
                className="w-5 h-5 accent-blue-600"
              />
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Reset Defaults
          </button>

          <button
            type="submit"
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Save Settings
          </button>
        </div>

        {message && (
          <p className="text-sm text-green-600 font-medium">{message}</p>
        )}
      </form>
    </div>
  );
}