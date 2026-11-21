
import { useEffect, useState } from "react";
import axios from "axios";

function Automation() {
  const [dashboard, setDashboard] = useState(null);
  const [activity, setActivity] = useState([]);
  const [rules, setRules] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [loadingRules, setLoadingRules] = useState(false);

  const [error, setError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [rulesError, setRulesError] = useState("");

  const [updatingConfig, setUpdatingConfig] = useState(false);
  const [runningAutomation, setRunningAutomation] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState(null);

  const [runResult, setRunResult] = useState(null);

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleSuccess, setRuleSuccess] = useState("");

  const emptyRuleForm = {
    rule_key: "",
    name: "",
    description: "",
    priority: 300,
    conditions: "{}",
    outcome: "READY_FOR_REVIEW",
    is_active: true,
  };

  const [ruleForm, setRuleForm] = useState(emptyRuleForm);

  const dashboardUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/dashboard/";
  const configUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/config/";
  const runUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/run/";
  const activityUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/activity/";
  const rulesUrl =
    "https://invoicepilot-ocr.onrender.com/api/automation/rules/";

  // ---------------- LOAD DASHBOARD ----------------

  const loadDashboard = async () => {
    const response = await axios.get(dashboardUrl);
    setDashboard(response.data);
  };

  // ---------------- LOAD ACTIVITY ----------------

  const loadActivity = async () => {
    setLoadingActivity(true);
    setActivityError("");

    try {
      const response = await axios.get(activityUrl);
      let activityData = response.data;

      if (activityData && activityData.results) {
        activityData = activityData.results;
      }

      if (Array.isArray(activityData)) {
        setActivity(activityData);
      } else {
        setActivity([]);
      }
    } catch (err) {
      console.error(err);
      setActivityError("Failed to load automation activity.");
    } finally {
      setLoadingActivity(false);
    }
  };

  // ---------------- LOAD RULES ----------------

  const loadRules = async () => {
    setLoadingRules(true);
    setRulesError("");

    try {
      const response = await axios.get(rulesUrl);
      let ruleData = response.data;

      if (ruleData && ruleData.results) {
        ruleData = ruleData.results;
      }

      if (Array.isArray(ruleData)) {
        setRules(ruleData);
      } else {
        setRules([]);
      }
    } catch (err) {
      console.error(err);
      setRulesError("Failed to load automation rules.");
    } finally {
      setLoadingRules(false);
    }
  };

  // ---------------- INITIAL LOAD ----------------

  useEffect(() => {
    loadDashboard()
      .catch((err) => {
        console.error(err);
        setError("Failed to load automation dashboard data.");
      })
      .finally(() => {
        setLoading(false);
      });

    loadActivity();
    loadRules();
  }, []);

  const summary = dashboard ? dashboard.summary : {};
  const config = dashboard ? dashboard.config : {};
  const automationEnabled = config.enabled === true;

  // ---------------- TOGGLE GLOBAL AUTOMATION ----------------

  const toggleAutomation = async () => {
    if (!dashboard || updatingConfig) {
      return;
    }

    const newEnabledState = !automationEnabled;

    setUpdatingConfig(true);
    setError("");

    try {
      await axios.patch(configUrl, {
        enabled: newEnabledState,
      });

      setDashboard((previous) => ({
        ...previous,
        config: {
          ...previous.config,
          enabled: newEnabledState,
        },
      }));
    } catch (err) {
      console.error(err);
      setError("Failed to update automation settings. Please try again.");
    } finally {
      setUpdatingConfig(false);
    }
  };

  // ---------------- RUN AUTOMATION ----------------

  const runAutomation = async () => {
    if (runningAutomation) {
      return;
    }

    setRunningAutomation(true);
    setError("");
    setRunResult(null);

    try {
      const response = await axios.post(runUrl);

      setRunResult(response.data);

      await loadDashboard();
      await loadActivity();
      await loadRules();
    } catch (err) {
      console.error(err);
      setError("Automation run failed. Please check the backend and try again.");
    } finally {
      setRunningAutomation(false);
    }
  };

  // ---------------- HANDLE FORM INPUT ----------------

  const handleRuleInput = (event) => {
    const fieldName = event.target.name;
    const fieldValue =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;

    setRuleForm((previous) => ({
      ...previous,
      [fieldName]: fieldValue,
    }));
  };

  // ---------------- OPEN CREATE FORM ----------------

  const openCreateForm = () => {
    setEditingRuleId(null);
    setRuleForm({ ...emptyRuleForm });
    setRuleSuccess("");
    setRulesError("");
    setShowRuleForm(true);
  };

  // ---------------- OPEN EDIT FORM ----------------

  const editRule = (rule) => {
    setEditingRuleId(rule.id);
    setRuleSuccess("");
    setRulesError("");

    setRuleForm({
      rule_key: rule.rule_key || "",
      name: rule.name || "",
      description: rule.description || "",
      priority: rule.priority,
      conditions: JSON.stringify(rule.conditions || {}, null, 2),
      outcome: rule.outcome || "READY_FOR_REVIEW",
      is_active: rule.is_active === true,
    });

    setShowRuleForm(true);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  // ---------------- CANCEL FORM ----------------

  const cancelRuleForm = () => {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleForm({ ...emptyRuleForm });
    setRulesError("");
    setRuleSuccess("");
  };

  // ---------------- CREATE / UPDATE RULE ----------------

  const saveRule = async (event) => {
    event.preventDefault();

    setSavingRule(true);
    setRulesError("");
    setRuleSuccess("");

    // Validate JSON conditions.
    let parsedConditions;

    try {
      parsedConditions = JSON.parse(ruleForm.conditions);
    } catch (err) {
      setRulesError("Conditions must be valid JSON.");
      setSavingRule(false);
      return;
    }

    if (
      parsedConditions === null ||
      Array.isArray(parsedConditions) ||
      typeof parsedConditions !== "object"
    ) {
      setRulesError("Conditions must be a JSON object.");
      setSavingRule(false);
      return;
    }

    const payload = {
      rule_key: ruleForm.rule_key.trim(),
      name: ruleForm.name.trim(),
      description: ruleForm.description.trim(),
      priority: Number(ruleForm.priority),
      conditions: parsedConditions,
      outcome: ruleForm.outcome,
      is_active: ruleForm.is_active,
    };

    if (!payload.rule_key || !payload.name) {
      setRulesError("Rule key and rule name are required.");
      setSavingRule(false);
      return;
    }

    if (
      !Number.isInteger(payload.priority) ||
      payload.priority < 0 ||
      payload.priority > 2147483647
    ) {
      setRulesError("Priority must be a valid non-negative whole number.");
      setSavingRule(false);
      return;
    }

    try {
      if (editingRuleId !== null) {
        await axios.patch(rulesUrl + editingRuleId + "/", payload);
        setRuleSuccess("Automation rule updated successfully.");
      } else {
        await axios.post(rulesUrl, payload);
        setRuleSuccess("Automation rule created successfully.");
      }

      await loadRules();
      await loadDashboard();

      setRuleForm({ ...emptyRuleForm });
      setEditingRuleId(null);
      setShowRuleForm(false);
    } catch (err) {
      console.error(err);

      if (err.response && err.response.data) {
        const backendError = JSON.stringify(err.response.data);
        setRulesError(
          (editingRuleId !== null ? "Rule update" : "Rule creation") +
            " failed: " +
            backendError
        );
      } else {
        setRulesError(
          editingRuleId !== null
            ? "Failed to update rule. Please try again."
            : "Failed to create rule. Please try again."
        );
      }
    } finally {
      setSavingRule(false);
    }
  };

  // ---------------- TOGGLE INDIVIDUAL RULE ----------------

  const toggleRuleStatus = async (rule) => {
    if (togglingRuleId !== null) {
      return;
    }

    const newActiveState = !rule.is_active;

    const actionText = newActiveState ? "activate" : "deactivate";

    const confirmed = window.confirm(
      "Are you sure you want to " +
        actionText +
        ' the rule "' +
        rule.name +
        '"?'
    );

    if (!confirmed) {
      return;
    }

    setTogglingRuleId(rule.id);
    setRulesError("");
    setRuleSuccess("");

    try {
      await axios.patch(rulesUrl + rule.id + "/", {
        is_active: newActiveState,
      });

      setRuleSuccess(
        '"' +
          rule.name +
          '" has been ' +
          (newActiveState ? "activated" : "deactivated") +
          " successfully."
      );

      await loadRules();
      await loadDashboard();
    } catch (err) {
      console.error(err);

      if (err.response && err.response.data) {
        setRulesError(
          "Failed to change rule status: " +
            JSON.stringify(err.response.data)
        );
      } else {
        setRulesError("Failed to update rule status. Please try again.");
      }
    } finally {
      setTogglingRuleId(null);
    }
  };

  // ---------------- FORMATTERS ----------------

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

  const getExecutionStatus = (item) => {
    if (item.success === true) {
      return "Evaluation succeeded";
    }

    if (item.success === false) {
      return "Evaluation failed";
    }

    if (item.result === "FAILURE") {
      return "Evaluation failed";
    }

    return "Unknown";
  };

  const formatOutcome = (outcome) => {
    if (!outcome) {
      return "—";
    }

    return outcome.replaceAll("_", " ");
  };

  // ---------------- STATISTICS ----------------

  const stats = [
    {
      label: "Automation Rules",
      value: summary.total_rules || 0,
      description: "Configured rules",
    },
    {
      label: "Active Rules",
      value: summary.active_rules || 0,
      description: "Currently enabled",
    },
    {
      label: "Invoices Processed",
      value: summary.invoices_automatically_processed || 0,
      description: "Automation evaluations",
    },
    {
      label: "Exceptions",
      value: summary.exception_invoices || 0,
      description: "Need attention",
    },
  ];

  const automationModules = [
    {
      title: "Invoice Processing",
      description:
        "Automatically validate invoices, detect duplicates, and identify missing information.",
      status: "Configured",
      icon: "📄",
    },
    {
      title: "Approval Routing",
      description:
        "Route invoices to the appropriate approval workflow based on amount and vendor rules.",
      status: "Configured",
      icon: "🔀",
    },
    {
      title: "Due Date Reminders",
      description:
        "Monitor upcoming due dates and identify overdue invoices.",
      status: "Configured",
      icon: "📅",
    },
    {
      title: "Exception Detection",
      description:
        "Identify duplicates, invalid invoices, inactive vendors, and amount mismatches.",
      status: "Configured",
      icon: "⚠️",
    },
  ];

  // ---------------- UI ----------------

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* PAGE HEADER */}

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Workflow Automation
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Automate invoice processing, approvals, reminders, and exception monitoring.
          </p>
        </div>

        <button
          onClick={showRuleForm ? cancelRuleForm : openCreateForm}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showRuleForm ? "Close Rule Form" : "+ Create automation rule"}
        </button>
      </div>

      {/* LOADING */}

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Loading automation dashboard...
        </div>
      )}

      {/* DASHBOARD ERROR */}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* RULE FORM */}

      {showRuleForm && (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingRuleId !== null
              ? "Edit Automation Rule"
              : "Create Automation Rule"}
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Define the conditions and outcome for an invoice automation rule.
          </p>

          <form onSubmit={saveRule} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Rule Key *
                </label>

                <input
                  name="rule_key"
                  value={ruleForm.rule_key}
                  onChange={handleRuleInput}
                  required
                  maxLength={80}
                  disabled={editingRuleId !== null}
                  placeholder="e.g. custom-vendor-review"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />

                <p className="mt-1 text-xs text-slate-400">
                  Use lowercase letters, numbers, and hyphens.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Rule Name *
                </label>

                <input
                  name="name"
                  value={ruleForm.name}
                  onChange={handleRuleInput}
                  required
                  maxLength={160}
                  placeholder="e.g. Custom vendor review"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Description
              </label>

              <textarea
                name="description"
                value={ruleForm.description}
                onChange={handleRuleInput}
                rows={2}
                placeholder="Describe what this rule does..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Priority
                </label>

                <input
                  type="number"
                  name="priority"
                  value={ruleForm.priority}
                  onChange={handleRuleInput}
                  min="0"
                  max="2147483647"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <p className="mt-1 text-xs text-slate-400">
                  Higher priority rules are evaluated first.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Outcome *
                </label>

                <select
                  name="outcome"
                  value={ruleForm.outcome}
                  onChange={handleRuleInput}
                  required
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  <option value="READY_FOR_REVIEW">
                    Ready for review
                  </option>
                  <option value="ROUTED_FOR_APPROVAL">
                    Routed for approval
                  </option>
                  <option value="EXCEPTION">Exception</option>
                  <option value="DUPLICATE_BLOCKED">
                    Duplicate blocked
                  </option>
                  <option value="VENDOR_REVIEW_REQUIRED">
                    Vendor review required
                  </option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Conditions (JSON)
              </label>

              <textarea
                name="conditions"
                value={ruleForm.conditions}
                onChange={handleRuleInput}
                rows={5}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              <p className="mt-1 text-xs text-slate-400">
                Enter a valid JSON object. Example: {"{"}"is_duplicate": false{"}"}
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                name="is_active"
                checked={ruleForm.is_active}
                onChange={handleRuleInput}
                className="h-4 w-4 rounded"
              />
              Activate rule immediately
            </label>

            {rulesError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {rulesError}
              </div>
            )}

            {ruleSuccess && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                {ruleSuccess}
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={savingRule}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingRule
                  ? editingRuleId !== null
                    ? "Saving Changes..."
                    : "Creating Rule..."
                  : editingRuleId !== null
                    ? "Save Changes"
                    : "Create Rule"}
              </button>

              <button
                type="button"
                onClick={cancelRuleForm}
                disabled={savingRule}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* KPI CARDS */}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-slate-500">{stat.label}</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-900">
              {stat.value}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {stat.description}
            </p>
          </div>
        ))}
      </div>

      {/* GLOBAL AUTOMATION TOGGLE */}

      <div
        className={`rounded-xl border p-5 ${
          automationEnabled
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2
              className={`font-semibold ${
                automationEnabled ? "text-emerald-900" : "text-amber-900"
              }`}
            >
              Automation overview
            </h2>

            <p
              className={`mt-1 text-sm ${
                automationEnabled ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {automationEnabled
                ? "Automation is enabled. Invoice processing rules are ready to run."
                : "Automation is disabled. Automated processing is paused."}
            </p>

            <p className="mt-2 text-xs font-semibold">
              Current status: {automationEnabled ? "ENABLED" : "DISABLED"}
            </p>
          </div>

          <button
            onClick={toggleAutomation}
            disabled={loading || updatingConfig || !dashboard}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
              automationEnabled
                ? "bg-red-600 hover:bg-red-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {updatingConfig
              ? "Updating..."
              : automationEnabled
                ? "Disable Automation"
                : "Enable Automation"}
          </button>
        </div>
      </div>

      {/* RUN AUTOMATION */}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold text-slate-900">
              Run Automation
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Manually evaluate invoices, apply automation rules, and generate due-date reminders.
            </p>
          </div>

          <button
            onClick={runAutomation}
            disabled={runningAutomation || loading}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runningAutomation
              ? "Running Automation..."
              : "▶ Run Automation Now"}
          </button>
        </div>
      </div>

      {/* RUN RESULT */}

      {runResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-semibold text-emerald-900">
            Automation Run Completed
          </h2>

          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-emerald-700">Run ID</p>
              <p className="mt-1 text-xl font-bold text-emerald-900">
                #{runResult.id}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">Processed</p>
              <p className="mt-1 text-xl font-bold text-emerald-900">
                {runResult.processed_count}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">Reminders</p>
              <p className="mt-1 text-xl font-bold text-emerald-900">
                {runResult.reminder_count}
              </p>
            </div>

            <div>
              <p className="text-xs text-emerald-700">Failures</p>
              <p className="mt-1 text-xl font-bold text-emerald-900">
                {runResult.failure_count}
              </p>
            </div>
          </div>

          <p className="mt-3 text-sm text-emerald-800">
            {runResult.explanation}
          </p>
        </div>
      )}

      {/* AUTOMATION DESCRIPTION */}

      <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
        <h2 className="font-semibold text-blue-900">
          Automation overview
        </h2>
        <p className="mt-1 text-sm text-blue-700">
          Configure rules to reduce manual accounts payable work while keeping
          approval and payment controls in place.
        </p>
      </div>

      {/* AUTOMATION RULES */}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Automation Rules
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Rules are evaluated according to priority. Higher priority rules take precedence.
            </p>
          </div>

          <button
            onClick={loadRules}
            disabled={loadingRules}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingRules ? "Refreshing..." : "↻ Refresh Rules"}
          </button>
        </div>

        {rulesError && !showRuleForm && (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {rulesError}
          </div>
        )}

        {ruleSuccess && !showRuleForm && (
          <div className="m-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {ruleSuccess}
          </div>
        )}

        {loadingRules && rules.length === 0 && (
          <div className="p-6 text-sm text-slate-500">
            Loading automation rules...
          </div>
        )}

        {!loadingRules && rules.length === 0 && !rulesError && (
          <div className="p-8 text-center text-sm text-slate-500">
            No automation rules found.
          </div>
        )}

        {rules.length > 0 && (
          <div className="divide-y divide-slate-100">
            {rules.map((rule) => (
              <div key={rule.id} className="p-5 hover:bg-slate-50">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">
                        {rule.name}
                      </h3>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          rule.is_active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {rule.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-400">
                      Key: {rule.rule_key}
                    </p>

                    <p className="mt-2 text-sm text-slate-600">
                      {rule.description || "No description provided."}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700">
                      Priority: {rule.priority}
                    </div>

                    <button
                      onClick={() => editRule(rule)}
                      disabled={savingRule || togglingRuleId !== null}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      ✎ Edit
                    </button>

                    <button
                      onClick={() => toggleRuleStatus(rule)}
                      disabled={togglingRuleId !== null || savingRule}
                      className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                        rule.is_active
                          ? "bg-amber-500 hover:bg-amber-600"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {togglingRuleId === rule.id
                        ? "Updating..."
                        : rule.is_active
                          ? "Deactivate"
                          : "Activate"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Outcome
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">
                      {formatOutcome(rule.outcome)}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Conditions
                    </p>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">
                      {JSON.stringify(rule.conditions || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {rules.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
            Showing {rules.length} automation rule(s)
          </div>
        )}
      </div>

      {/* AUTOMATION MODULES */}

      <div>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">
          Automation modules
        </h2>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {automationModules.map((module) => (
            <div
              key={module.title}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl">
                  {module.icon}
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900">
                    {module.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    {module.description}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3">
                <span className="text-xs font-medium text-emerald-600">
                  ● {module.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ACTIVITY LOG */}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Automation Activity Log
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              History of invoice evaluations, automation actions, and results.
            </p>
          </div>

          <button
            onClick={loadActivity}
            disabled={loadingActivity}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingActivity ? "Refreshing..." : "↻ Refresh Activity"}
          </button>
        </div>

        {activityError && (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {activityError}
          </div>
        )}

        {loadingActivity && activity.length === 0 && (
          <div className="p-6 text-sm text-slate-500">
            Loading activity log...
          </div>
        )}

        {!loadingActivity && activity.length === 0 && !activityError && (
          <div className="p-8 text-center">
            <p className="font-medium text-slate-700">
              No automation activity yet
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Run automation to see invoice evaluation activity here.
            </p>
          </div>
        )}

        {activity.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Invoice
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Vendor
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Rule
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Result
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Execution
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600">
                    Date & Time
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {activity.map((item) => {
                  const executionStatus = getExecutionStatus(item);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                        {item.invoice_number || "—"}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {item.vendor_name || "Unknown vendor"}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {item.rule_name || "No rule"}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        {item.action || "—"}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            item.result === "SUCCESS"
                              ? "bg-emerald-100 text-emerald-700"
                              : item.result === "FAILURE"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {item.result || "—"}
                        </span>

                        {item.explanation && (
                          <p
                            title={item.explanation}
                            className="mt-1 max-w-xs truncate text-xs text-slate-400"
                          >
                            {item.explanation}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            executionStatus === "Evaluation succeeded"
                              ? "bg-emerald-100 text-emerald-700"
                              : executionStatus === "Evaluation failed"
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {executionStatus}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {formatDate(item.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activity.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-500">
            Showing {activity.length} activity record(s)
          </div>
        )}
      </div>
    </div>
  );
}

export default Automation;



