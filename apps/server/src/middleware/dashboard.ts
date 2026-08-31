export const MIDDLEWARE_DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Agent Launchpad Middleware Evidence</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #171717; background: #f5f5f7; }
    body { margin: 0; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px; }
    header { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 26px; }
    p { color: #5c5c66; }
    .controls { display: flex; gap: 8px; flex-wrap: wrap; }
    input, button, select { border: 1px solid #d7d7de; border-radius: 8px; padding: 9px 11px; font: inherit; }
    button { cursor: pointer; background: #1f1f24; color: white; }
    .status { margin: 16px 0; padding: 12px; border-radius: 8px; background: white; border: 1px solid #e4e4e8; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
    article { background: white; border: 1px solid #e4e4e8; border-radius: 12px; padding: 16px; }
    .row { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
    .pill { font-size: 12px; border-radius: 999px; padding: 3px 8px; background: #efeff3; }
    .row-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
    .timeline { margin: 12px 0 0; display: grid; gap: 8px; padding: 0; list-style: none; }
    .timeline li { border: 1px solid #ececf1; border-radius: 10px; padding: 10px 12px; background: #fcfcfd; }
    .timeline .meta { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .timeline .when { color: #70707a; font-size: 12px; }
    code { overflow-wrap: anywhere; }
    details { margin-top: 10px; }
    .denied { border-left: 4px solid #a52a2a; }
    .failed { border-left: 4px solid #8b0000; }
    .completed { border-left: 4px solid #2e7d32; }
    .running { border-left: 4px solid #8a6d1d; }
    .cancelled { border-left: 4px solid #6a5acd; }
    .recovered { border-left: 4px solid #0b7a75; }
    ul { padding-left: 18px; }
    .muted { color: #70707a; font-size: 13px; }
    .ghost { background: #f4f4f6; color: #1f1f24; }
    .banner { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: #edf7f6; color: #0b7a75; border: 1px solid #cfe9e7; }
  </style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Middleware Evidence</h1>
      <p>Runtime traces, policy decisions, redacted summaries, and failure evidence.</p>
    </div>
    <div class="controls">
      <input id="token" type="password" placeholder="APP_AUTH_TOKEN (if enabled)" autocomplete="off" />
      <select id="statusFilter">
        <option value="">All statuses</option>
        <option>completed</option><option>running</option><option>recovered</option><option>denied</option><option>failed</option><option>cancelled</option>
      </select>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  <div id="health" class="status">Loading middleware health…</div>
  <div id="traces" class="grid"></div>
</main>
<script>
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  const headers = () => {
    const token = document.getElementById("token").value.trim();
    return token ? { Authorization: "Bearer " + token } : {};
  };
  async function getJson(url) {
    const response = await fetch(url, { headers: headers() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    return data;
  }
  function renderTrace(trace) {
    const spans = trace.spans
      .slice()
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map((span) =>
        "<li><div class=\"meta\"><strong>" + escapeHtml(span.name) + "</strong><span>" + escapeHtml(span.status) + "</span></div>" +
        "<div class=\"when\">" + escapeHtml(span.category) + " · " + escapeHtml(span.startedAt) + (span.completedAt ? " → " + escapeHtml(span.completedAt) : "") + (span.durationMs == null ? "" : " · " + span.durationMs + " ms") + "</div>" +
        (span.detail ? "<div>" + escapeHtml(span.detail) + "</div>" : "") +
        "</li>"
      ).join("");
    const recovery = trace.recovery?.snapshotPath
      ? "<p><strong>Checkpoint:</strong> " + escapeHtml(trace.recovery.snapshotPath) +
        (trace.recovery.restoredAt ? "<br/><span class=\"muted\">Restored at " + escapeHtml(trace.recovery.restoredAt) + "</span>" : "") +
        "</p>"
      : "";
    const banner = trace.status === "recovered"
      ? "<div class=\"banner\">Workspace was automatically recovered after a runtime failure.</div>"
      : "";
    const recoverButton = trace.recovery?.snapshotPath && !trace.recovery.restoredAt
      ? "<button class=\"ghost\" data-recover=\"" + escapeHtml(trace.id) + "\">Rollback workspace</button>"
      : "";
    return "<article class=\"" + escapeHtml(trace.status) + "\">" +
      "<div class=\"row\"><strong>" + escapeHtml(trace.status.toUpperCase()) + "</strong><span class=\"pill\">" + escapeHtml(trace.policy.decision) + "</span></div>" +
      "<p><code>trace " + escapeHtml(trace.id) + "</code><br/><code>run " + escapeHtml(trace.runId || "unresolved") + "</code><br/><code>agent " + escapeHtml(trace.agentId) + "</code></p>" +
      "<p><strong>Input:</strong> " + escapeHtml(trace.inputSummary) + "</p>" +
      (trace.outputSummary ? "<p><strong>Output:</strong> " + escapeHtml(trace.outputSummary) + "</p>" : "") +
      (trace.errorSummary ? "<p><strong>Error:</strong> " + escapeHtml(trace.errorSummary) + "</p>" : "") +
      "<p><strong>Policy:</strong> " + escapeHtml(trace.policy.reason) + (trace.policy.ruleId ? " (" + escapeHtml(trace.policy.ruleId) + ")" : "") + "</p>" +
      banner +
      recovery +
      "<div class=\"row-actions\">" + recoverButton + "</div>" +
      "<details open><summary>Incident timeline · " + trace.spans.length + " steps</summary><ul class=\"timeline\">" + spans + "</ul></details>" +
      "</article>";
  }
  async function rollback(traceId) {
    const response = await fetch("/api/middleware/traces/" + encodeURIComponent(traceId) + "/recover", {
      method: "POST",
      headers: headers(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    return data;
  }
  async function refresh() {
    const health = document.getElementById("health");
    const traces = document.getElementById("traces");
    try {
      const status = document.getElementById("statusFilter").value;
      const suffix = status ? "?status=" + encodeURIComponent(status) : "";
      const [healthData, traceData] = await Promise.all([
        getJson("/api/middleware/health"),
        getJson("/api/middleware/traces" + suffix),
      ]);
      health.textContent = "Middleware healthy · " + healthData.capabilities.join(" · ") + " · traces=" + healthData.traceCount;
      traces.innerHTML = traceData.traces.length ? traceData.traces.map(renderTrace).join("") : "<article>No traces yet. Run an Agent in the Playground.</article>";
      traces.querySelectorAll("[data-recover]").forEach((button) => {
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Rolling back…";
          try {
            await rollback(button.getAttribute("data-recover"));
            await refresh();
          } catch (error) {
            alert("Rollback failed: " + error.message);
            button.disabled = false;
            button.textContent = "Rollback workspace";
          }
        });
      });
    } catch (error) {
      health.textContent = "Unable to load middleware data: " + error.message + ". If APP_AUTH_TOKEN is enabled, enter it above.";
      traces.innerHTML = "";
    }
  }
  document.getElementById("refresh").addEventListener("click", refresh);
  document.getElementById("statusFilter").addEventListener("change", refresh);
  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`;