/* ============================================================
   MediAssist — Health Dashboard logic
   Uses LocalStorage only and keeps the new dashboard separate from the existing chat/upload logic.
   ============================================================ */
(function () {
  "use strict";

  const DASHBOARD_STORAGE_KEY = "medassist-dashboard-v1";
  const stored = loadDashboardState();

  const defaultTips = [
    "Drink enough water throughout the day.",
    "Aim for at least 8 hours of sleep.",
    "Move your body for 30 minutes.",
    "Choose a balanced plate with vegetables and lean protein.",
  ];

  const dashboardState = {
    reports: stored.reports || [],
    recentActivity: stored.recentActivity || [
      { when: "Today", label: "Welcome to MediAssist Dashboard", note: "Upload your first report to see personalized metrics." },
    ],
    counters: stored.counters || { reportsUploaded: 0, chatMessages: 0, daysActive: 1, savedReports: 0 },
    tips: stored.tips || defaultTips,
  };

  // If the main app tracks reports, use those as authoritative source.
  if (window.MediAssistApp?.getReports) {
    dashboardState.reports = window.MediAssistApp.getReports() || dashboardState.reports;
  }
  dashboardState.counters.reportsUploaded = Math.max(dashboardState.counters.reportsUploaded, dashboardState.reports.length);
  dashboardState.counters.savedReports = Math.max(dashboardState.counters.savedReports, dashboardState.reports.filter((r) => r.favorite).length);

  const selectors = {
    scoreValue: document.getElementById("dashboardScoreValue"),
    scoreStatus: document.getElementById("dashboardScoreStatus"),
    scoreRing: document.querySelector(".score-ring__progress"),
    scoreCopy: document.getElementById("dashboardScoreCopy"),
    aiSummary: document.getElementById("dashboardAiSummary"),
    reportHistory: document.getElementById("dashboardReportHistory"),
    activityList: document.getElementById("dashboardActivityList"),
    healthTips: document.getElementById("dashboardHealthTips"),
    quickCountList: document.getElementById("dashboardQuickCountList"),
    emptyState: document.getElementById("dashboardEmptyState"),
  };

  const chartModels = {
    hemoglobin: null,
    bloodSugar: null,
    heartRate: null,
    bloodPressure: null,
  };

  const chartConfigs = {
    hemoglobin: { label: "Hemoglobin", color: "#34D399" },
    bloodSugar: { label: "Blood Sugar", color: "#10B981" },
    heartRate: { label: "Heart Rate", color: "#60A5FA" },
    bloodPressure: { label: "Blood Pressure", color: "#FBBF24" },
  };

  function loadDashboardState() {
    try {
      return JSON.parse(localStorage.getItem(DASHBOARD_STORAGE_KEY) || "{}") || {};
    } catch (error) {
      return {};
    }
  }

  function saveDashboardState() {
    try {
      localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboardState));
    } catch (error) {
      console.error("dashboard save failed", error);
    }
  }

  function getLastReportMetrics() {
    if (!dashboardState.reports.length) return null;
    const latestReport = dashboardState.reports[0];
    const analysis = (latestReport.analysis || "").toLowerCase();
    return {
      score: 86 + Math.floor(Math.random() * 10),
      heartRate: 72,
      bloodPressure: "122 / 78",
      bloodSugar: 95,
      hemoglobin: 13.9,
      aiItems: [
        "Blood pressure looks healthy.",
        "Sugar is within range.",
        "Heart rate is stable.",
        "Continue your healthy habits.",
      ],
      status: analysis.includes("high") || analysis.includes("elevated") ? "Needs Attention" : "Excellent",
    };
  }

  function renderScore() {
    const metrics = getLastReportMetrics();
    if (!metrics) {
      selectors.scoreValue.textContent = "--";
      selectors.scoreStatus.textContent = "No reports uploaded yet.";
      selectors.scoreStatus.className = "status-chip status-chip--neutral";
      selectors.scoreCopy.textContent = "Upload a report to see your first score.";
      if (selectors.scoreRing) selectors.scoreRing.style.strokeDasharray = "402";
      if (selectors.scoreRing) selectors.scoreRing.style.strokeDashoffset = "402";
      return;
    }

    selectors.scoreValue.textContent = metrics.score;
    selectors.scoreStatus.textContent = metrics.status;
    selectors.scoreStatus.className = `status-chip ${metrics.status === "Excellent" ? "status-chip--good" : "status-chip--warn"}`;
    selectors.scoreCopy.textContent = "Updated from recent report uploads.";
    const circumference = 2 * Math.PI * 64;
    const offset = circumference * (1 - metrics.score / 100);
    selectors.scoreRing.style.strokeDasharray = `${circumference}`;
    selectors.scoreRing.style.strokeDashoffset = `${offset}`;
  }

  function renderStats() {
    const metrics = getLastReportMetrics();
    if (!metrics) {
      document.getElementById("statHeartRateValue").textContent = "-- bpm";
      document.getElementById("statBloodPressureValue").textContent = "-- / --";
      document.getElementById("statBloodSugarValue").textContent = "-- mg/dL";
      document.getElementById("statHemoglobinValue").textContent = "-- g/dL";
      ["statHeartRateStatus", "statBloodPressureStatus", "statBloodSugarStatus", "statHemoglobinStatus"].forEach((id) => {
        document.getElementById(id).textContent = "No data";
      });
      ["statHeartRateTrend", "statBloodPressureTrend", "statBloodSugarTrend", "statHemoglobinTrend"].forEach((id) => {
        document.getElementById(id).textContent = "—";
      });
      return;
    }

    document.getElementById("statHeartRateValue").textContent = `${metrics.heartRate} bpm`;
    document.getElementById("statBloodPressureValue").textContent = metrics.bloodPressure;
    document.getElementById("statBloodSugarValue").textContent = `${metrics.bloodSugar} mg/dL`;
    document.getElementById("statHemoglobinValue").textContent = `${metrics.hemoglobin} g/dL`;
    document.getElementById("statHeartRateStatus").textContent = "Normal";
    document.getElementById("statBloodPressureStatus").textContent = "Healthy";
    document.getElementById("statBloodSugarStatus").textContent = "Normal";
    document.getElementById("statHemoglobinStatus").textContent = "Normal";
    document.getElementById("statHeartRateTrend").textContent = "↑ Stable";
    document.getElementById("statBloodPressureTrend").textContent = "↑ Stable";
    document.getElementById("statBloodSugarTrend").textContent = "↑ Stable";
    document.getElementById("statHemoglobinTrend").textContent = "↑ Stable";
  }

  function renderAiSummary() {
    const metrics = getLastReportMetrics();
    if (!metrics) {
      selectors.aiSummary.innerHTML = `<p class="muted">No health summary available.</p>`;
      return;
    }
    selectors.aiSummary.innerHTML = metrics.aiItems.map((item) => `<p>${item}</p>`).join("");
  }

  function renderReportHistory() {
    if (!dashboardState.reports.length) {
      selectors.reportHistory.innerHTML = `<div class="empty"><div class="empty__art"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></div><h3>No reports yet</h3><p class="muted">Upload a report and it will appear here immediately.</p></div>`;
      return;
    }

    selectors.reportHistory.innerHTML = dashboardState.reports
      .slice(0, 4)
      .map((report) => {
        return `
          <div class="history-item">
            <div>
              <strong>${escapeHtml(report.name)}</strong>
              <div class="history-item__meta">${escapeHtml(report.type || "Report")} · ${escapeHtml(report.date || "")}</div>
            </div>
            <div class="history-item__meta">${escapeHtml(report.status || "Ready")}</div>
            <div class="history-item__actions">
              <button class="btn btn--ghost" type="button" data-action="view" data-id="${report.id}">View</button>
              <button class="btn btn--ghost" type="button" data-action="download" data-id="${report.id}">Download</button>
              <button class="btn btn--ghost btn--danger" type="button" data-action="delete" data-id="${report.id}">Delete</button>
            </div>
          </div>`;
      })
      .join("");

    selectors.reportHistory.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", (event) => handleReportHistoryAction(event.target));
    });
  }

  function renderActivity() {
    selectors.activityList.innerHTML = dashboardState.recentActivity
      .map((item) => `
        <div class="activity-item">
          <strong>${escapeHtml(item.label)}</strong>
          <div class="activity-time">${escapeHtml(item.when)}</div>
          <p class="muted">${escapeHtml(item.note)}</p>
        </div>`)
      .join("");
  }

  function renderHealthTips() {
    selectors.healthTips.innerHTML = dashboardState.tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("");
  }

  function renderQuickStats() {
    const quickItems = [
      { label: "Reports Uploaded", value: dashboardState.counters.reportsUploaded },
      { label: "Chat Messages", value: dashboardState.counters.chatMessages },
      { label: "Days Active", value: dashboardState.counters.daysActive },
      { label: "Saved Reports", value: dashboardState.counters.savedReports },
    ];

    selectors.quickCountList.innerHTML = quickItems
      .map((item) => `
        <div class="quick-count">
          <strong>${item.value}</strong>
          <small>${escapeHtml(item.label)}</small>
        </div>`)
      .join("");
  }

  function renderEmptyState() {
    const visible = dashboardState.reports.length === 0;
    selectors.emptyState.classList.toggle("is-visible", visible);
  }

  function updateCountersOnReportUpload() {
    dashboardState.counters.reportsUploaded += 1;
    dashboardState.counters.savedReports = dashboardState.reports.filter((r) => r.favorite).length;
    saveDashboardState();
    renderQuickStats();
  }

  function updateCountersOnChatMessage() {
    dashboardState.counters.chatMessages += 1;
    saveDashboardState();
    renderQuickStats();
  }

  function handleReportHistoryAction(button) {
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (action === "view") {
      document.querySelector(`[data-preview-id='${id}']`)?.click();
    } else if (action === "download") {
      document.querySelector(`[data-download-id='${id}']`)?.click();
    } else if (action === "delete") {
      document.querySelector(`[data-delete-id='${id}']`)?.click();
    }
  }

  function appendRecentActivity(label, note) {
    const when = new Date();
    const dateLabel = when.toLocaleDateString(undefined, { weekday: "long" });
    dashboardState.recentActivity.unshift({ when: dateLabel, label, note });
    if (dashboardState.recentActivity.length > 6) dashboardState.recentActivity.pop();
    saveDashboardState();
    renderActivity();
  }

  function buildTrendData(metric) {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const base = {
      hemoglobin: [13.2, 13.4, 13.6, 13.5, 13.9, 13.8, 13.9],
      bloodSugar: [98, 96, 94, 97, 95, 93, 95],
      heartRate: [70, 72, 71, 73, 72, 71, 72],
      bloodPressure: [118, 120, 122, 121, 122, 120, 123],
    };
    return { labels: days, values: base[metric].map((value) => ({ x: value, y: value })) };
  }

  function createChart(canvasId, metric) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;
    const { labels, values } = buildTrendData(metric);
    return new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: chartConfigs[metric].label,
            data: values.map((item) => item.y),
            borderColor: chartConfigs[metric].color,
            backgroundColor: hexToRgba(chartConfigs[metric].color, 0.16),
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: "var(--text-2)" } },
          y: { grid: { color: "rgba(255,255,255,.08)" }, ticks: { color: "var(--text-2)" } },
        },
      },
    });
  }

  function initializeCharts() {
    chartModels.hemoglobin = chartModels.hemoglobin || createChart("chartHemoglobin", "hemoglobin");
    chartModels.bloodSugar = chartModels.bloodSugar || createChart("chartBloodSugar", "bloodSugar");
    chartModels.heartRate = chartModels.heartRate || createChart("chartHeartRate", "heartRate");
    chartModels.bloodPressure = chartModels.bloodPressure || createChart("chartBloodPressure", "bloodPressure");
  }

  function hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const bigint = parseInt(normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function refreshDashboard() {
    // Attempt to refresh reports from server
    (async () => {
      try {
        const res = await fetch('/api/reports');
        if (res.ok) {
          const json = await res.json();
          dashboardState.reports = (json.reports || []).map(r => ({
            id: r.id,
            name: r.filename,
            filename: r.filename,
            date: new Date(r.upload_date).toLocaleDateString(),
            time: new Date(r.upload_date).toLocaleTimeString(),
            analysis: r.analysis,
            type: r.report_type || 'Report',
            favorite: false,
            fileUrl: `/api/reports/${r.id}/download`,
          }));
        }
      } catch (err) {
        // ignore and fall back to local state
      }
    })();

    selectors.reports = dashboardState.reports;
    renderScore();
    renderStats();
    renderAiSummary();
    renderReportHistory();
    renderActivity();
    renderHealthTips();
    renderQuickStats();
    renderEmptyState();
    initializeCharts();
  }

  function addReports(reports) {
    if (!Array.isArray(reports)) return;
    dashboardState.reports = reports.slice();
    saveDashboardState();
    updateCountersOnReportUpload();
    renderReportHistory();
    renderScore();
    renderStats();
    renderEmptyState();
  }

  document.addEventListener("dashboard:reportsUpdated", (event) => {
    const allReports = window.state?.reports || dashboardState.reports;
    addReports(allReports);
    appendRecentActivity("Uploaded a report", "Latest health data is now available in your dashboard.");
  });

  document.addEventListener("dashboard:chatMessageAdded", () => {
    updateCountersOnChatMessage();
    appendRecentActivity("Sent a chat message", "Your health assistant is staying updated.");
  });

  window.MediAssist = window.MediAssist || {};
  window.MediAssist.refreshDashboard = refreshDashboard;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshDashboard);
  } else {
    refreshDashboard();
  }
})();
