import { useCallback, useEffect, useMemo, useState } from "react";
import OperationsGrid from "./OperationsGrid";
import "./App.css";
import "./CompactDashboard.css";

const INVESTIGATION_ID = 3;
const PROPOSAL_ID = 1;

/* =========================================================
   Shared helpers (unchanged behaviour)
   ========================================================= */

function humanize(value) {
  return String(value || "Unknown")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleString();
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAmount(amount, currency) {
  if (amount === undefined || amount === null || amount === "") return "—";

  const numeric = Number(amount);

  if (!Number.isFinite(numeric)) {
    return `${amount} ${currency || ""}`.trim();
  }

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency || ""}`.trim();
  }
}

function isTrue(value) {
  return value === true || value === 1 || value === "1";
}

function displayName(username) {
  const first = String(username || "Operator").split(/[._@\s-]/)[0];

  return first
    ? first.charAt(0).toUpperCase() + first.slice(1)
    : "Operator";
}

function initials(username) {
  return String(username || "OP")
    .split(/[._@\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "OP";
}

const SUCCESS_STATUSES = [
  "COMPLETED",
  "CAPTURED",
  "APPROVED",
  "PAID",
  "EXECUTED",
];
const DANGER_STATUSES = [
  "FAILED",
  "DECLINED",
  "DENIED",
  "VOIDED",
  "CANCELLED",
  "CANCELED",
];

function statusTone(value) {
  const status = String(value || "").toUpperCase();

  if (SUCCESS_STATUSES.includes(status)) return "success";
  if (DANGER_STATUSES.includes(status)) return "danger";

  return "warning";
}

/* =========================================================
   Audit helpers
   ========================================================= */

const AUDIT_LABELS = {
  DETECTION_COMPLETED: "Mismatch detected",
  AI_ANALYSIS_COMPLETED: "AI analysis completed",
  RECONCILIATION_PROPOSED: "Reconciliation proposal created",
  RECONCILIATION_APPROVED: "Human approval recorded",
  RECONCILIATION_EXECUTED: "Simulated reconciliation executed",
};

function getVisibleAuditEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) =>
      Object.prototype.hasOwnProperty.call(AUDIT_LABELS, event.eventType)
    )
    .slice()
    .sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });
}

/* =========================================================
   Icons and brand
   ========================================================= */

const ICON_PATHS = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  card: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  sync: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" />
    </>
  ),
  doc: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5v16h4" />
      <path d="m16 8 4 4-4 4M20 12H9" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17v-6a6 6 0 1 1 12 0v6l1.5 2h-15z" />
      <path d="M10 21.5h4" />
    </>
  ),
  shield: <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />,
  shieldcheck: (
    <>
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z" />
      <path d="m8.7 12 2.4 2.4 4.4-4.4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  store: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5 12.5V20h14v-7.5M10 20v-4.5h4V20" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeoff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M4 4l16 16" />
    </>
  ),
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  sparkle: (
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z" />
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
};

function Icon({ name, size = 18, className = "" }) {
  return (
    <svg
      className={`rai-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function BrandLogo({ size = 34, inverse = false }) {
  return (
    <span className={`rai-brand ${inverse ? "rai-brand-inverse" : ""}`}>
      <Icon name="shieldcheck" size={size} className="rai-brand-mark" />
      <span className="rai-brand-name">
        Resolve<span>AI</span>
      </span>
    </span>
  );
}

function StatusPill({ children, type = "neutral" }) {
  return <span className={`status-pill ${type}`}>{children}</span>;
}

/* =========================================================
   AI report helpers (unchanged behaviour)
   ========================================================= */

/* Render basic Markdown bold without using dangerouslySetInnerHTML. */
function renderReportText(value) {
  return String(value || "")
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      return part;
    });
}

/* All report sections are expanded by default. */
function ReportSection({ title, text }) {
  const lines = String(text || "No details recorded.")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <details className="compact-report-section" open>
      <summary>
        {title}
        <Icon name="chevron" size={16} className="compact-chevron" />
      </summary>

      <div className="compact-report-text">
        {lines.map((line, index) => {
          const bulletMatch = line.match(/^[-*•]\s+(.+)/);
          const numberedMatch = line.match(/^(\d+)[.)]\s+(.+)/);

          if (bulletMatch || numberedMatch) {
            const content = bulletMatch
              ? bulletMatch[1]
              : numberedMatch[2];

            return (
              <div className="report-list-item" key={index}>
                <span className="report-list-marker" aria-hidden="true">
                  {numberedMatch ? `${numberedMatch[1]}.` : "•"}
                </span>
                <span>{renderReportText(content)}</span>
              </div>
            );
          }

          return <p key={index}>{renderReportText(line)}</p>;
        })}
      </div>
    </details>
  );
}

function parseAiSections(raw) {
  const titles = {
    summary: "Summary",
    "verified evidence": "Verified Evidence",
    "possible explanation": "Possible Explanation",
    "missing evidence": "Missing Evidence",
    "recommended next steps": "Recommended Next Steps",
    note: "Note",
    "safety note": "Note",
  };

  const source = String(raw || "").replace(/\r\n/g, "\n");
  const sections = [];
  let current = null;

  for (const originalLine of source.split("\n")) {
    const line = originalLine.trim();

    const normalizedHeading = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\*\*(.*?)\*\*$/, "$1")
      .replace(/:$/, "")
      .trim()
      .toLowerCase();

    const heading = titles[normalizedHeading];

    if (heading) {
      current = { title: heading, text: "" };
      sections.push(current);
      continue;
    }

    if (current && line) {
      current.text += `${line}\n`;
    }
  }

  return sections
    .map((section) => ({
      ...section,
      text: section.text.trim(),
    }))
    .filter((section) => section.text);
}

/* =========================================================
   Evidence verification and case state (unchanged behaviour)
   ========================================================= */

function VerificationPanel({ paypal, ai }) {
  const verification = paypal?.apiVerification || {};
  const verificationStatus = String(
    ai?.verification?.status || ""
  ).toUpperCase();

  const verified =
    verificationStatus === "VERIFIED" &&
    isTrue(verification.verifiedByPayPalApi) &&
    isTrue(verification.matchesRecordedEvidence);

  return (
    <section
      id="evidence-verification"
      className="rai-card compact-verification"
    >
      <div className="compact-verification-heading">
        <div>
          <div className="eyebrow">LIVE PROVIDER EVIDENCE CHECK</div>
          <h3>PayPal verification</h3>
        </div>

        <StatusPill type={verified ? "success" : "warning"}>
          {verified ? "Verified" : "Not verified"}
        </StatusPill>
      </div>

      <div className="compact-verification-grid">
        <div>
          <span>Order status</span>
          <strong>
            {humanize(verification.orderStatus || paypal?.orderStatus)}
          </strong>
        </div>

        <div>
          <span>Capture status</span>
          <strong>{humanize(verification.captureStatus || "Unknown")}</strong>
        </div>

        <div>
          <span>Capture belongs to order</span>
          <strong>
            {isTrue(verification.captureBelongsToOrder)
              ? "Yes"
              : "Not confirmed"}
          </strong>
        </div>

        <div>
          <span>Matches recorded evidence</span>
          <strong>
            {isTrue(verification.matchesRecordedEvidence)
              ? "Yes"
              : "Not confirmed"}
          </strong>
        </div>
      </div>

      <p className="compact-verification-footnote">
        {verified
          ? "A fresh PayPal API check confirmed that the order and capture match the saved PayPal evidence. This does not verify the actual merchant fulfillment record."
          : "Fresh PayPal verification is not confirmed by the available investigation data."}
      </p>
    </section>
  );
}

function CurrentCaseState({ investigation, proposal }) {
  const reconciliation = investigation?.reconciliation || {};
  const paymentState = investigation?.paymentState || {};
  const evidence = investigation?.evidence || {};

  const originalMerchantStatus = String(
    evidence.merchantStatus || "UNKNOWN"
  ).toUpperCase();

  const simulatedMerchantStatus = String(
    reconciliation.simulatedMerchantStatus ||
      (proposal?.status === "EXECUTED"
        ? "COMPLETED"
        : originalMerchantStatus)
  ).toUpperCase();

  const actualMerchantStatus = String(
    paymentState.actualMerchantStatus || "UNKNOWN"
  ).toUpperCase();

  const paypalStatus = String(
    paymentState.paypalStatus || evidence.paypalStatus || "UNKNOWN"
  ).toUpperCase();

  const executed =
    String(
      reconciliation.status || proposal?.status || ""
    ).toUpperCase() === "EXECUTED";

  return (
    <section className="rai-card compact-current-state">
      <div className="eyebrow">CASE STATE / RECONCILIATION OUTCOME</div>
      <h3>What changed — and what did not</h3>

      <div className="compact-state-grid">
        <div className="compact-state-item">
          <span>PayPal payment</span>
          <strong>{humanize(paypalStatus)}</strong>
          <StatusPill type="success">Provider state</StatusPill>
        </div>

        <div className="compact-state-item">
          <span>Original simulated merchant state</span>
          <strong>{humanize(originalMerchantStatus)}</strong>
          <StatusPill type="warning">Before reconciliation</StatusPill>
        </div>

        <div className="compact-state-item">
          <span>Simulated merchant state</span>
          <strong>{humanize(simulatedMerchantStatus)}</strong>
          <StatusPill type={executed ? "success" : "warning"}>
            {executed ? "After execution" : "Current simulation"}
          </StatusPill>
        </div>

        <div className="compact-state-item">
          <span>Actual merchant record</span>
          <strong>{humanize(actualMerchantStatus)}</strong>
          <StatusPill type="neutral">Unchanged</StatusPill>
        </div>
      </div>

      <div className="compact-state-boundary">
        <strong>Important:</strong> The reconciliation updated only the
        simulated merchant order. It did not change the actual merchant
        record or the PayPal payment, and it did not move customer funds.
      </div>
    </section>
  );
}

/*
 * Group repeated AI analysis events visually.
 * Every original event and timestamp remains available in the expanded group.
 * The source audit history is never modified.
 */
function AuditTimeline({ events = [], defaultOpen = false }) {
  const visibleEvents = getVisibleAuditEvents(events);

  if (!visibleEvents.length) return null;

  const aiEvents = visibleEvents.filter(
    (event) => event.eventType === "AI_ANALYSIS_COMPLETED"
  );

  const firstAiIndex = visibleEvents.findIndex(
    (event) => event.eventType === "AI_ANALYSIS_COMPLETED"
  );

  const timelineItems = [];
  let aiGroupInserted = false;

  visibleEvents.forEach((event, index) => {
    if (event.eventType === "AI_ANALYSIS_COMPLETED") {
      if (!aiGroupInserted && index === firstAiIndex) {
        timelineItems.push({ type: "ai-group" });
        aiGroupInserted = true;
      }
      return;
    }

    timelineItems.push({ type: "event", event });
  });

  const latestAiEvent = aiEvents[aiEvents.length - 1];

  return (
    <details className="compact-audit" open={defaultOpen}>
      <summary>
        View case audit trail
        <span className="compact-audit-count">
          {visibleEvents.length} events
        </span>
        <Icon name="chevron" size={16} className="compact-chevron" />
      </summary>

      <div className="compact-audit-list">
        {timelineItems.map((item, index) => {
          if (item.type === "ai-group") {
            return (
              <details
                className="compact-audit-ai-group"
                key="ai-analysis-history"
              >
                <summary>
                  <span className="compact-audit-dot" />
                  <span className="compact-audit-ai-summary">
                    <strong>AI analysis history</strong>
                    <small>
                      {aiEvents.length} recorded runs · Latest:{" "}
                      {formatTimestamp(latestAiEvent?.createdAt)}
                    </small>
                  </span>
                </summary>

                <div className="compact-audit-ai-events">
                  {aiEvents.map((event) => (
                    <div className="compact-audit-item" key={event.id}>
                      <span className="compact-audit-dot" />
                      <div>
                        <strong>AI analysis completed</strong>
                        <span>
                          Event #{event.id} · {formatTimestamp(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            );
          }

          const event = item.event;

          return (
            <div className="compact-audit-item" key={event.id || index}>
              <span className="compact-audit-dot" />
              <div>
                <strong>{AUDIT_LABELS[event.eventType]}</strong>
                <span>{formatTimestamp(event.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/* =========================================================
   Reconciliation panel (unchanged behaviour)
   ========================================================= */

function ReconciliationPanel({
  proposal,
  investigation,
  state,
  error,
  operator,
  authChecking,
  onRefresh,
  onCreate,
  onApprove,
  onExecute,
}) {
  const reconciliation = investigation?.reconciliation || {};

  const status = String(
    proposal?.status || reconciliation.status || ""
  ).toUpperCase();

  const isExecuted = status === "EXECUTED";
  const isApproved = status === "APPROVED";
  const isPending = status === "PENDING" || status === "PENDING_APPROVAL";

  const isSimulated =
    isTrue(proposal?.simulated) || isTrue(reconciliation.simulated);

  const busy = state === "loading";
  const canAuthorize = Boolean(operator) && !authChecking;

  let statusType = "neutral";

  if (isExecuted || isApproved) statusType = "success";
  if (isPending) statusType = "warning";

  const proposalId = proposal?.id ?? reconciliation.proposalId;
  const createdAt = proposal?.createdAt ?? reconciliation.createdAt;
  const approvedAt = proposal?.approvedAt ?? reconciliation.approvedAt;
  const approvedBy = proposal?.approvedBy ?? reconciliation.approvedBy;
  const executedAt = proposal?.executedAt ?? reconciliation.executedAt;
  const proposedAction =
    proposal?.proposedAction ?? reconciliation.proposedAction;

  return (
    <section id="reconciliation" className="panel reconciliation-panel">
      <div className="compact-section-header">
        <div>
          <div className="eyebrow">CONTROLLED RECOVERY WORKFLOW</div>
          <h2>Reconciliation</h2>
          <p className="reconciliation-subtitle">
            Review the proposed action and track its approval and execution.
          </p>
        </div>

        <button
          type="button"
          className="button button-secondary"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}

      {state === "loading" && !proposal && (
        <p role="status">Loading reconciliation proposal…</p>
      )}

      {!proposal && !proposalId && state !== "loading" && (
        <div className="reconciliation-empty">
          <h3>No reconciliation proposal loaded</h3>
          <p>
            Create a proposal from the current investigation to begin
            the controlled recovery workflow.
          </p>

          <button
            type="button"
            className="button button-primary"
            onClick={onCreate}
            disabled={busy}
          >
            Create reconciliation proposal
          </button>
        </div>
      )}

      {(proposal || proposalId) && (
        <>
          <div className="reconciliation-summary">
            <div>
              <span className="reconciliation-label">Proposal</span>
              <strong>#{proposalId}</strong>
            </div>

            <div>
              <span className="reconciliation-label">Status</span>
              <StatusPill type={statusType}>{humanize(status)}</StatusPill>
            </div>

            <div>
              <span className="reconciliation-label">Investigation run</span>
              <strong>
                {proposal?.investigationRunId ?? investigation?.id ?? "—"}
              </strong>
            </div>

            <div>
              <span className="reconciliation-label">Payment</span>
              <strong>
                {proposal?.paymentId ?? investigation?.paymentId ?? "—"}
              </strong>
            </div>
          </div>

          <div className="reconciliation-action">
            <span className="reconciliation-label">Proposed action</span>
            <strong>{humanize(proposedAction)}</strong>
            <code>{proposedAction || "Not specified"}</code>
          </div>

          <div className="reconciliation-timeline">
            <div className="reconciliation-timeline-item">
              <span className="reconciliation-timeline-marker">1</span>
              <div>
                <strong>Proposal created</strong>
                <span>{formatTimestamp(createdAt)}</span>
              </div>
            </div>

            <div className="reconciliation-timeline-item">
              <span className="reconciliation-timeline-marker">
                {approvedAt ? "✓" : "2"}
              </span>
              <div>
                <strong>Human approval</strong>
                <span>
                  {approvedAt
                    ? `Approved by ${approvedBy || "operator"} · ${formatTimestamp(approvedAt)}`
                    : "Awaiting approval"}
                </span>
              </div>
            </div>

            <div className="reconciliation-timeline-item">
              <span className="reconciliation-timeline-marker">
                {executedAt ? "✓" : "3"}
              </span>
              <div>
                <strong>Execution</strong>
                <span>
                  {executedAt ? formatTimestamp(executedAt) : "Not executed"}
                </span>
              </div>
            </div>
          </div>

          {isSimulated && (
            <div className="reconciliation-notice">
              <strong>Simulation only.</strong> This proposal updates a
              simulated merchant order. It does not modify a real PayPal
              payment or actual merchant record, and it does not move
              customer funds.
            </div>
          )}

          {!isSimulated && (
            <div className="reconciliation-notice">
              <strong>Safety notice.</strong> Review the evidence and
              verify the intended impact before approving any action.
            </div>
          )}

          <div className="reconciliation-controls">
            {isPending && (
              <button
                type="button"
                className="button button-primary"
                onClick={onApprove}
                disabled={busy || !canAuthorize}
              >
                {busy
                  ? "Processing…"
                  : authChecking
                    ? "Checking access…"
                    : "Approve proposal"}
              </button>
            )}

            {isApproved && (
              <button
                type="button"
                className="button button-primary"
                onClick={onExecute}
                disabled={busy || !canAuthorize}
              >
                {busy
                  ? "Executing…"
                  : authChecking
                    ? "Checking access…"
                    : "Execute approved action"}
              </button>
            )}

            {isExecuted && (
              <StatusPill type="success">✓ Execution completed</StatusPill>
            )}

            {!isPending && !isApproved && !isExecuted && (
              <StatusPill type="warning">{humanize(status)}</StatusPill>
            )}
          </div>

          {!canAuthorize && !authChecking && !isExecuted && (
            <p className="operator-auth-hint">
              Sign in as an operator to approve or execute this proposal.
            </p>
          )}

          {authChecking && !isExecuted && (
            <p className="operator-auth-hint" role="status">
              Checking operator access before enabling recovery actions…
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* =========================================================
   Pre-login screens
   ========================================================= */

const REMEMBER_KEY = "resolveai.operatorUsername";

/* Decorative "city lights" on the globe (seeded, so they never change). */
const GLOBE_LIGHTS = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const centers = [
    [190, 380], [330, 350], [455, 372], [270, 430],
    [400, 430], [120, 440], [520, 430], [350, 410],
  ];
  const lights = [];

  for (let i = 0; i < 260; i += 1) {
    const [cx, cy] = centers[Math.floor(rand() * centers.length)];
    const x = cx + (rand() - 0.5) * 120;
    const y = cy + (rand() - 0.5) * 76;

    if (Math.hypot(x - 320, y - 640) < 370 && y < 478) {
      lights.push({ x, y, r: 0.5 + rand() * 1.3, o: 0.25 + rand() * 0.6 });
    }
  }

  return lights;
})();

function HeroArt() {
  const nodes = [
    [96, 330], [168, 292], [236, 336], [312, 300], [384, 342],
    [452, 306], [520, 340], [140, 388], [262, 392], [408, 396],
  ];
  const links = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [1, 7], [2, 8], [4, 9], [3, 8], [5, 9],
  ];

  return (
    <svg
      className="rai-hero-art"
      viewBox="0 0 640 480"
      role="img"
      aria-label="Digital payment network illustration"
      preserveAspectRatio="xMidYMax slice"
    >
      <defs>
        <radialGradient id="rai-globe-fill" cx="50%" cy="8%" r="85%">
          <stop offset="0%" stopColor="#3b7bff" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#14378a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#0b1220" stopOpacity="0" />
        </radialGradient>
        <filter id="rai-rim-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id="rai-globe-clip">
          <circle cx="320" cy="640" r="380" />
        </clipPath>
      </defs>

      <circle cx="320" cy="640" r="380" fill="url(#rai-globe-fill)" />
      <circle
        cx="320"
        cy="640"
        r="380"
        fill="none"
        stroke="#6aa8ff"
        strokeOpacity="0.7"
        strokeWidth="3"
        filter="url(#rai-rim-glow)"
      />

      <g clipPath="url(#rai-globe-clip)" fill="none" stroke="#6ea2ff" strokeOpacity="0.28">
        <ellipse cx="320" cy="640" rx="380" ry="120" />
        <ellipse cx="320" cy="640" rx="380" ry="230" />
        <ellipse cx="320" cy="640" rx="120" ry="380" />
        <ellipse cx="320" cy="640" rx="250" ry="380" />
        <line x1="320" y1="260" x2="320" y2="1020" />
      </g>

      <g fill="#bcd6ff">
        {GLOBE_LIGHTS.map((light, index) => (
          <circle
            key={index}
            cx={light.x}
            cy={light.y}
            r={light.r}
            opacity={light.o}
          />
        ))}
      </g>

      <g stroke="#7fb0ff" strokeOpacity="0.45" strokeWidth="1">
        {links.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={nodes[from][0]}
            y1={nodes[from][1]}
            x2={nodes[to][0]}
            y2={nodes[to][1]}
          />
        ))}
      </g>
      <g fill="#cfe1ff">
        {nodes.map(([x, y], index) => (
          <circle key={index} cx={x} cy={y} r={index % 3 === 0 ? 3.4 : 2.4} />
        ))}
      </g>
    </svg>
  );
}

/* Separate from the globe so it is never cropped by the globe's viewBox. */
function HeroShield() {
  return (
    <svg
      className="rai-hero-shield"
      viewBox="0 0 220 290"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="rai-shield-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8dbbff" />
          <stop offset="55%" stopColor="#2f6bff" />
          <stop offset="100%" stopColor="#1740b8" />
        </linearGradient>
        <filter id="rai-soft-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <path
        d="M110 14 20 52v96c0 62 40 108 90 128 50-20 90-66 90-128V52z"
        fill="#2f6bff"
        opacity="0.55"
        filter="url(#rai-soft-glow)"
      />
      <path
        d="M110 14 20 52v96c0 62 40 108 90 128 50-20 90-66 90-128V52z"
        fill="url(#rai-shield-fill)"
        stroke="#cfe1ff"
        strokeOpacity="0.7"
        strokeWidth="2"
      />
      <text
        x="110"
        y="172"
        textAnchor="middle"
        fontSize="118"
        fontWeight="800"
        fontStyle="italic"
        fill="#0b1f5c"
        fontFamily="Inter, Arial, sans-serif"
      >
        P
      </text>
    </svg>
  );
}

function SplashScreen() {
  return (
    <div className="rai-splash" role="status" aria-live="polite">
      <BrandLogo size={40} inverse />
      <span className="rai-splash-loader" />
      <p>Checking your operator session…</p>
    </div>
  );
}

function LoginScreen({
  username,
  password,
  error,
  busy,
  remember,
  paymentState,
  paymentError,
  onUsernameChange,
  onPasswordChange,
  onRememberChange,
  onLogin,
  onCheckout,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showResetNote, setShowResetNote] = useState(false);

  const checkoutBusy =
    paymentState === "loading" || paymentState === "redirecting";

  return (
    <div className="rai-login">
      <section className="rai-login-hero">
        <BrandLogo size={48} inverse />
        <p className="rai-hero-tagline">SMARTER PAYMENTS. SAFER RECOVERY.</p>

        <div className="rai-hero-copy">
          <h1>
            Intelligent Payment
            <br />
            Reconciliation for a
            <br />
            Trusted Digital Economy
          </h1>
          <p>
            Detect discrepancies. Verify evidence.
            <br />
            Recover safely with AI.
          </p>
        </div>

        <HeroArt />
        <HeroShield />

        <ul className="rai-hero-features">
          <li>
            <Icon name="shield" size={26} />
            <span>
              PayPal
              <br />
              Integration
            </span>
          </li>
          <li>
            <Icon name="chip" size={26} />
            <span>
              AI-Powered
              <br />
              Insights
            </span>
          </li>
          <li>
            <Icon name="shieldcheck" size={26} />
            <span>
              Secure &amp;
              <br />
              Auditable
            </span>
          </li>
        </ul>
      </section>

      <section className="rai-login-panel">
        <div className="rai-login-card">
          <div className="rai-login-brand-mobile">
            <BrandLogo size={32} />
          </div>

          <h2>Welcome Back</h2>
          <p className="rai-login-sub">Sign in to your ResolveAI workspace</p>

          <form className="rai-login-form" onSubmit={onLogin}>
            <label className="rai-input" htmlFor="operator-username">
              <span className="sr-only">Email address or operator username</span>
              <Icon name="mail" size={18} />
              <input
                id="operator-username"
                name="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                placeholder="Username"
                required
                disabled={busy}
              />
            </label>

            <label className="rai-input" htmlFor="operator-password">
              <span className="sr-only">Password</span>
              <Icon name="lock" size={18} />
              <input
                id="operator-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="Password"
                required
                disabled={busy}
              />
              <button
                type="button"
                className="rai-input-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name={showPassword ? "eye" : "eyeoff"} size={18} />
              </button>
            </label>

            <div className="rai-login-options">
              <label className="rai-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => onRememberChange(event.target.checked)}
                />
                Remember me
              </label>

              <button
                type="button"
                className="rai-forgot"
                onClick={() => setShowResetNote((value) => !value)}
                aria-expanded={showResetNote}
              >
                Forgot password?
              </button>
            </div>

            {showResetNote && (
              <p className="rai-reset-note" role="status">
                Password reset is not available in this Sandbox demo. Ask
                your ResolveAI administrator to reset operator access.
              </p>
            )}

            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}

            <button type="submit" className="rai-signin" disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
              {!busy && <Icon name="arrowRight" size={16} />}
            </button>
          </form>

          <div className="rai-or" aria-hidden="true">
            <span>or</span>
          </div>

          <button
            type="button"
            className="rai-paypal-btn"
            onClick={onCheckout}
            disabled={checkoutBusy}
          >
            <span className="rai-paypal-glyph" aria-hidden="true">
              P
            </span>
            {paymentState === "loading"
              ? "Creating order…"
              : paymentState === "redirecting"
                ? "Redirecting…"
                : "Continue with PayPal"}
          </button>
          <p className="rai-login-note">
            Opens a PayPal Sandbox test checkout. It does not sign you in.
          </p>

          {paymentError && (
            <div className="inline-error" role="alert">
              {paymentError}
            </div>
          )}

          <div className="rai-sandbox-wrap">
            <span className="rai-sandbox-pill">
              <span className="live-dot" /> Sandbox Environment
            </span>
          </div>

          <p className="rai-copyright">
            © 2026 ResolveAI. Built for a safer payment ecosystem.
          </p>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   Authenticated shell
   ========================================================= */

const NAV_ITEMS = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "payments", label: "Payments", icon: "card" },
  { id: "investigations", label: "Investigations", icon: "search" },
  { id: "reconciliation", label: "Reconciliation", icon: "sync" },
  { id: "audit", label: "Audit Trail", icon: "doc" },
];

function Sidebar({ activeNav, open, onNavigate, onLogout, logoutBusy, onClose }) {
  return (
    <>
      <div
        className={`rai-sidebar-scrim ${open ? "is-open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`rai-sidebar ${open ? "is-open" : ""}`}
        aria-label="Primary"
      >
        <div className="rai-sidebar-top">
          <BrandLogo size={30} inverse />
          <button
            type="button"
            className="rai-sidebar-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="rai-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rai-nav-item ${activeNav === item.id ? "active" : ""}`}
              aria-current={activeNav === item.id ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="rai-sidebar-divider" />

        <nav className="rai-nav" aria-label="Account">
          <button
            type="button"
            className={`rai-nav-item ${activeNav === "settings" ? "active" : ""}`}
            aria-current={activeNav === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            <Icon name="gear" size={18} />
            Settings
          </button>
          <button
            type="button"
            className="rai-nav-item"
            onClick={onLogout}
            disabled={logoutBusy}
          >
            <Icon name="logout" size={18} />
            {logoutBusy ? "Signing out…" : "Logout"}
          </button>
        </nav>

        <div className="rai-sidebar-env">
          <span className="live-dot" aria-hidden="true" />
          <span>
            <strong>Sandbox Mode</strong>
            <small>Test Environment</small>
          </span>
        </div>
      </aside>
    </>
  );
}

function Topbar({
  operator,
  inDetail,
  caseLabel,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onOpenMenu,
  onBackToList,
  pendingApproval,
  onBell,
  userMenuOpen,
  onToggleUserMenu,
  onLogout,
  logoutBusy,
}) {
  return (
    <header className="rai-topbar">
      <button
        type="button"
        className="rai-menu-button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
      >
        <Icon name="menu" size={20} />
      </button>

      {inDetail ? (
        <nav className="rai-breadcrumb" aria-label="Breadcrumb">
          <button type="button" onClick={onBackToList}>
            Investigations
          </button>
          <Icon name="chevron" size={14} className="rai-breadcrumb-sep" />
          <strong>{caseLabel}</strong>
        </nav>
      ) : (
        <form className="rai-search" onSubmit={onSearchSubmit} role="search">
          <Icon name="search" size={17} />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search payments, investigations…"
            aria-label="Search payments and investigations"
          />
        </form>
      )}

      <div className="rai-topbar-right">
        <span className="rai-sandbox-pill">
          <span className="live-dot" /> Sandbox
        </span>

        <button
          type="button"
          className="rai-icon-button"
          onClick={onBell}
          aria-label={
            pendingApproval
              ? "1 proposal awaiting human approval"
              : "Open reconciliation"
          }
        >
          <Icon name="bell" size={19} />
          {pendingApproval && <span className="rai-bell-dot" />}
        </button>

        <div className="rai-user">
          <button
            type="button"
            className="rai-user-button"
            onClick={onToggleUserMenu}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
          >
            <span className="rai-avatar">{initials(operator.username)}</span>
            <span className="rai-user-name">
              {displayName(operator.username)}
            </span>
            <Icon name="chevron" size={14} />
          </button>

          {userMenuOpen && (
            <div className="rai-user-menu" role="menu">
              <div className="rai-user-menu-meta">
                <small>Signed in as</small>
                <strong>{operator.username}</strong>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={onLogout}
                disabled={logoutBusy}
              >
                <Icon name="logout" size={16} />
                {logoutBusy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* =========================================================
   Overview
   ========================================================= */

function KpiCard({ tone, icon, label, value, detail }) {
  return (
    <div className="rai-kpi">
      <span className={`rai-kpi-icon ${tone}`}>
        <Icon name={icon} size={22} />
      </span>
      <div className="rai-kpi-body">
        <span className="rai-kpi-label">{label}</span>
        <strong className="rai-kpi-value">{value}</strong>
        <span className="rai-kpi-detail">{detail}</span>
      </div>
    </div>
  );
}

function LoadNotice({ model, onRetry }) {
  if (model.loadState === "loading") {
    return (
      <div className="rai-notice" role="status">
        <span className="operations-grid-loader" />
        Loading investigation from the backend…
      </div>
    );
  }

  if (model.loadError) {
    return (
      <div className="inline-error rai-notice-error" role="alert">
        <span>{model.loadError}</span>
        <button type="button" className="button button-primary" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  return null;
}

function SelectedInvestigationCard({
  model,
  aiState,
  aiError,
  onNavigate,
  onInvestigate,
}) {
  const { investigation, evidence, severity, severityType, caseHeadline, merchantStatus, isSimulated } = model;

  const paypalStatus = String(evidence.paypalStatus || "UNKNOWN").toUpperCase();

  return (
    <section className="rai-card rai-selected">
      <div className="rai-card-head">
        <h2>Selected Investigation</h2>
        {investigation && (
          <button
            type="button"
            className="rai-link"
            onClick={() => onNavigate("investigation")}
          >
            View Details <Icon name="arrowRight" size={14} />
          </button>
        )}
      </div>

      {!investigation ? (
        <div className="rai-empty">
          <strong>No investigation selected</strong>
          <p>Investigation details appear here once a case is loaded.</p>
        </div>
      ) : (
        <>
          <div className="rai-selected-id">
            <strong>INV-{investigation.id}</strong>
            <StatusPill type={severityType}>
              {humanize(severity)} Severity
            </StatusPill>
          </div>
          <h3 className="rai-selected-headline">{caseHeadline}</h3>

          <div className="rai-sel-tiles">
            <div className="rai-sel-tile paypal">
              <span className="rai-paypal-word">PayPal</span>
              <span className={`rai-tile-status ${statusTone(paypalStatus)}`}>
                <Icon
                  name={statusTone(paypalStatus) === "success" ? "check" : "alert"}
                  size={14}
                />
                Payment {humanize(paypalStatus)}
              </span>
            </div>

            <div className="rai-sel-tile merchant">
              <span className="rai-sel-merchant">
                <Icon name="store" size={18} /> Merchant
              </span>
              <span className={`rai-tile-status ${statusTone(merchantStatus)}`}>
                <Icon
                  name={statusTone(merchantStatus) === "success" ? "check" : "alert"}
                  size={14}
                />
                Order {humanize(merchantStatus)}
                {isSimulated ? " (simulated)" : ""}
              </span>
            </div>
          </div>

          <div className="rai-sel-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={onInvestigate}
              disabled={aiState === "loading"}
            >
              <Icon name="sparkle" size={14} />
              {aiState === "loading" ? "Running…" : "Run AI Analysis"}
            </button>
            <button
              type="button"
              className="button button-outline"
              onClick={() => onNavigate("reconciliation")}
            >
              View Reconciliation
            </button>
          </div>

          {aiError && (
            <div className="inline-error" role="alert">
              {aiError}
            </div>
          )}
          {aiState === "complete" && !aiError && (
            <p className="rai-success-note" role="status">
              AI analysis completed and recorded in the audit trail.
            </p>
          )}
          <p className="rai-sel-note">
            AI is advisory. Reconciliation needs human approval and is
            simulated.
          </p>
        </>
      )}
    </section>
  );
}

function AiInsightsCard({ model, onNavigate }) {
  const {
    investigation,
    evidence,
    ai,
    hasAi,
    merchantStatus,
    isSimulated,
    proposalStatus,
    freshVerificationPassed,
  } = model;

  const recommendation =
    investigation?.recommendedAction ||
    ai.recommendedAction ||
    "No recovery guidance has been recorded for this investigation.";

  const findings = investigation
    ? [
        {
          tone: freshVerificationPassed
            ? "success"
            : statusTone(evidence.paypalStatus),
          text: freshVerificationPassed
            ? "PayPal capture confirmed by a fresh API check"
            : `PayPal status: ${humanize(evidence.paypalStatus)} (fresh check not confirmed)`,
        },
        {
          tone: statusTone(merchantStatus),
          text: `Merchant order ${humanize(merchantStatus).toLowerCase()}${
            isSimulated ? " (simulated)" : ""
          }`,
        },
        {
          tone: proposalStatus ? statusTone(proposalStatus) : "warning",
          text: proposalStatus
            ? `Reconciliation ${humanize(proposalStatus).toLowerCase()}`
            : "No reconciliation proposal yet",
        },
        {
          tone: hasAi ? "success" : "warning",
          text: hasAi
            ? "AI analysis available (advisory)"
            : "AI analysis not run yet",
        },
      ]
    : [];

  return (
    <section className="rai-card rai-insights">
      <div className="rai-card-head">
        <h2>
          <Icon name="sparkle" size={16} className="rai-ai-spark" /> AI Insights
        </h2>
        <span className="rai-advisory">Advisory</span>
      </div>

      <button
        type="button"
        className="rai-insight-reco"
        onClick={() => onNavigate("investigation")}
        disabled={!investigation}
      >
        <span>
          <small>Recommended Action</small>
          <strong>{recommendation}</strong>
          <em>Rule-based guidance from the backend</em>
        </span>
        <Icon name="arrowRight" size={16} />
      </button>

      <h3 className="rai-findings-title">Key Findings</h3>
      {findings.length === 0 ? (
        <p className="rai-muted">Findings appear once a case is loaded.</p>
      ) : (
        <ul className="rai-findings">
          {findings.map((finding) => (
            <li key={finding.text}>
              <span className={`rai-finding-icon ${finding.tone}`}>
                <Icon
                  name={finding.tone === "success" ? "check" : "alert"}
                  size={12}
                />
              </span>
              {finding.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewView({
  model,
  aiState,
  aiError,
  onNavigate,
  onRetry,
  onInvestigate,
}) {
  const {
    evidence,
    loaded,
    severity,
    caseIsMismatch,
    reconciliationExecuted,
    proposalStatus,
    isPendingProposal,
    isSimulated,
    loadState,
    loadError,
    caseRows,
  } = model;

  const openIncidents =
    loaded && caseIsMismatch && !reconciliationExecuted ? 1 : 0;

  const columnDefs = useMemo(
    () => [
      { field: "caseId", headerName: "Case #", minWidth: 90, flex: 0.9 },
      { field: "amount", headerName: "Amount", minWidth: 90, flex: 0.8 },
      {
        field: "reconciliation",
        headerName: "Status",
        minWidth: 110,
        flex: 1,
        cellRenderer: StatusCell,
      },
      {
        field: "severity",
        headerName: "Severity",
        minWidth: 90,
        flex: 0.9,
        cellRenderer: SeverityCell,
      },
      { field: "updated", headerName: "Updated", minWidth: 110, flex: 1.1 },
    ],
    [],
  );

  return (
    <>
      <div className="rai-page-heading">
        <h1>Payment Operations Dashboard</h1>
        <p>Monitor, investigate and resolve payment discrepancies.</p>
      </div>

      <LoadNotice model={model} onRetry={onRetry} />

      <section className="rai-kpis" aria-label="Case summary">
        <KpiCard
          tone="blue"
          icon="card"
          label="Case payment"
          value={loaded ? formatAmount(evidence.amount, evidence.currency) : "—"}
          detail={
            loaded
              ? `Order ${evidence.orderId || "not recorded"}`
              : "No case loaded"
          }
        />
        <KpiCard
          tone="red"
          icon="alert"
          label="Open incidents"
          value={loaded ? openIncidents : "—"}
          detail={
            loaded
              ? `${humanize(severity)} severity${isSimulated ? " · simulated" : ""}`
              : "No case loaded"
          }
        />
        <KpiCard
          tone="green"
          icon="check"
          label="Reconciliation"
          value={proposalStatus ? humanize(proposalStatus) : "No proposal"}
          detail={
            reconciliationExecuted
              ? "Simulated merchant state only"
              : "Human approval required"
          }
        />
        <KpiCard
          tone="purple"
          icon="shield"
          label="Pending review"
          value={loaded || proposalStatus ? (isPendingProposal ? 1 : 0) : "—"}
          detail="Proposals awaiting approval"
        />
      </section>

      <div className="rai-dash-grid">
        <OperationsGrid
          compact
          title="Investigation Workbench"
          rowData={caseRows}
          columnDefs={columnDefs}
          loading={loadState === "loading"}
          error={loadError}
          emptyMessage="No investigation has been loaded from the backend."
          selectedId={caseRows[0]?.id}
          getRowId={(params) => String(params.data.id)}
          onRowClicked={() => {}}
          headerAction={
            <button
              type="button"
              className="rai-link"
              onClick={() => onNavigate("investigations")}
            >
              View All <Icon name="arrowRight" size={14} />
            </button>
          }
          pageSize={5}
        />

        <SelectedInvestigationCard
          model={model}
          aiState={aiState}
          aiError={aiError}
          onNavigate={onNavigate}
          onInvestigate={onInvestigate}
        />

        <AiInsightsCard model={model} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/* =========================================================
   Grids: Payments and Investigations
   ========================================================= */

function StatusCell({ value }) {
  if (!value) return <span className="rai-muted">—</span>;

  return <StatusPill type={statusTone(value)}>{humanize(value)}</StatusPill>;
}

function SeverityCell({ value }) {
  if (!value) return <span className="rai-muted">—</span>;

  const danger = ["HIGH", "CRITICAL"].includes(String(value).toUpperCase());

  return (
    <StatusPill type={danger ? "danger" : "warning"}>
      {humanize(value)}
    </StatusPill>
  );
}

function InvestigationsView({ model, searchSeed, onOpenCase, onRetry }) {
  const columnDefs = useMemo(
    () => [
      { field: "caseId", headerName: "Case", minWidth: 120, flex: 0.8 },
      {
        field: "classification",
        headerName: "Classification",
        minWidth: 220,
        flex: 1.6,
        valueFormatter: (params) => humanize(params.value),
      },
      {
        field: "severity",
        headerName: "Severity",
        minWidth: 120,
        flex: 0.8,
        cellRenderer: SeverityCell,
      },
      {
        field: "paypalStatus",
        headerName: "PayPal status",
        minWidth: 140,
        flex: 1,
        cellRenderer: StatusCell,
      },
      {
        field: "merchantStatus",
        headerName: "Merchant (simulated)",
        minWidth: 170,
        flex: 1,
        cellRenderer: StatusCell,
      },
      {
        field: "amount",
        headerName: "Amount",
        minWidth: 120,
        flex: 0.8,
        type: "rightAligned",
      },
      {
        field: "reconciliation",
        headerName: "Reconciliation",
        minWidth: 150,
        flex: 1,
        cellRenderer: StatusCell,
      },
    ],
    [],
  );

  return (
    <>
      <div className="rai-page-heading">
        <h1>Investigations</h1>
        <p>
          Records are loaded from the ResolveAI backend. Select a row to open
          the investigation.
        </p>
      </div>

      <OperationsGrid
        title="Investigation queue"
        description="Deterministic discrepancy detections with AI as advisory support."
        eyebrow="INVESTIGATIONS"
        rowData={model.caseRows}
        columnDefs={columnDefs}
        loading={model.loadState === "loading"}
        error={model.loadError}
        emptyMessage="No investigation has been loaded from the backend."
        searchPlaceholder="Search investigations…"
        searchSeed={searchSeed}
        exportFileName="resolveai-investigations.csv"
        footerNote={`Showing investigation #${INVESTIGATION_ID} as returned by the backend.`}
        getRowId={(params) => String(params.data.id)}
        onRowClicked={(event) => onOpenCase(event.data?.id)}
        pageSize={10}
      />

      {model.loadError && (
        <button type="button" className="button button-primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </>
  );
}

function CheckoutPanel({ paymentState, paymentError, onCheckout }) {
  return (
    <section id="checkout" className="rai-card rai-checkout">
      <div className="eyebrow">PAYPAL INTEGRATION</div>
      <h3>Sandbox checkout</h3>
      <p>Test the existing PayPal payment lifecycle.</p>

      <div className="rai-product">
        <span>ResolveAI Demo Product</span>
        <strong>$10.00</strong>
      </div>

      {paymentError && (
        <div className="inline-error" role="alert">
          {paymentError}
        </div>
      )}

      <button
        type="button"
        className="button button-paypal"
        onClick={onCheckout}
        disabled={paymentState === "loading" || paymentState === "redirecting"}
      >
        {paymentState === "loading"
          ? "Creating order…"
          : paymentState === "redirecting"
            ? "Redirecting…"
            : "Test PayPal Sandbox Payment →"}
      </button>

      <small>Sandbox environment only · No real payment</small>
    </section>
  );
}

function OversightPanel() {
  return (
    <section className="rai-card rai-oversight">
      <div className="eyebrow">SAFETY BY DESIGN</div>
      <h3>Human oversight</h3>

      <p>
        Provider evidence, actual merchant records, simulated merchant
        state, and AI interpretation remain separate.
      </p>

      <p>
        Recovery actions require fresh provider verification and an
        authenticated operator's approval. The backend enforces operator
        authentication before approval and execution.
      </p>
    </section>
  );
}

function PaymentsView({
  model,
  searchSeed,
  paymentState,
  paymentError,
  onCheckout,
  onRetry,
}) {
  const columnDefs = useMemo(
    () => [
      { field: "paymentId", headerName: "Payment", minWidth: 110, flex: 0.7 },
      { field: "orderId", headerName: "PayPal order", minWidth: 190, flex: 1.3 },
      { field: "captureId", headerName: "Capture", minWidth: 190, flex: 1.3 },
      {
        field: "amount",
        headerName: "Amount",
        minWidth: 120,
        flex: 0.8,
        type: "rightAligned",
      },
      {
        field: "paypalStatus",
        headerName: "PayPal status",
        minWidth: 140,
        flex: 1,
        cellRenderer: StatusCell,
      },
      {
        field: "merchantStatus",
        headerName: "Merchant (simulated)",
        minWidth: 170,
        flex: 1,
        cellRenderer: StatusCell,
      },
      { field: "source", headerName: "Evidence source", minWidth: 170, flex: 1.2 },
    ],
    [],
  );

  return (
    <>
      <div className="rai-page-heading">
        <h1>Payments</h1>
        <p>
          PayPal-verified evidence is authoritative. Merchant status shown
          here is simulated demo data.
        </p>
      </div>

      <OperationsGrid
        title="Payment records"
        description="Payments attached to the loaded investigation."
        eyebrow="PAYMENTS"
        rowData={model.paymentRows}
        columnDefs={columnDefs}
        loading={model.loadState === "loading"}
        error={model.loadError}
        emptyMessage="No payment evidence has been loaded from the backend."
        searchPlaceholder="Search payments…"
        searchSeed={searchSeed}
        exportFileName="resolveai-payments.csv"
        footerNote="Payment evidence from the loaded investigation. Merchant status is simulated."
        getRowId={(params) => String(params.data.id)}
        pageSize={10}
      />

      {model.loadError && (
        <button type="button" className="button button-primary" onClick={onRetry}>
          Retry
        </button>
      )}

      <div className="rai-two-col">
        <CheckoutPanel
          paymentState={paymentState}
          paymentError={paymentError}
          onCheckout={onCheckout}
        />
        <OversightPanel />
      </div>
    </>
  );
}

/* =========================================================
   Investigation detail
   ========================================================= */

function PaymentOverviewCard({ model }) {
  const { evidence, reconciliation, proposal, merchantStatus } = model;

  const paypalStatus = String(evidence.paypalStatus || "UNKNOWN").toUpperCase();
  const executedAt = proposal?.executedAt ?? reconciliation.executedAt;
  const simulatedStatus = String(
    reconciliation.simulatedMerchantStatus ||
      (model.reconciliationExecuted ? "COMPLETED" : merchantStatus)
  ).toUpperCase();

  return (
    <section className="rai-card rai-case-card">
      <div className="rai-card-head">
        <h2>Payment Overview</h2>
      </div>

      <div className="rai-order-row">
        <div>
          <small>Order ID</small>
          <strong>{evidence.orderId || "Not recorded"}</strong>
        </div>
        <span className="rai-paypal-word">PayPal</span>
      </div>

      <div className="rai-status-split">
        <div className="rai-status-col">
          <span className={`rai-status-icon ${statusTone(paypalStatus)}`}>
            <Icon name={statusTone(paypalStatus) === "success" ? "check" : "alert"} size={14} />
          </span>
          <small>PayPal Status</small>
          <strong className={`rai-status-text ${statusTone(paypalStatus)}`}>
            {paypalStatus}
          </strong>

          <small>Amount</small>
          <strong>{formatAmount(evidence.amount, evidence.currency)}</strong>

          <small>Recorded</small>
          <strong>
            {evidence.verifiedAt
              ? formatTimestamp(evidence.verifiedAt)
              : "Not recorded"}
          </strong>
        </div>

        <div className="rai-status-col">
          <span className={`rai-status-icon ${statusTone(merchantStatus)}`}>
            <Icon name={statusTone(merchantStatus) === "success" ? "check" : "alert"} size={14} />
          </span>
          <small>Merchant Status (simulated)</small>
          <strong className={`rai-status-text ${statusTone(merchantStatus)}`}>
            {merchantStatus}
          </strong>

          <small>Simulated state now</small>
          <strong>{humanize(simulatedStatus)}</strong>

          <small>Last updated</small>
          <strong>
            {executedAt ? formatTimestamp(executedAt) : "Not updated"}
          </strong>
        </div>
      </div>
    </section>
  );
}

function EvidenceComparisonCard({ model }) {
  const {
    evidence,
    merchantStatus,
    hasMerchantEvidence,
    caseIsMismatch,
    reconciliationExecuted,
    isSimulated,
  } = model;

  let mismatch = {
    tone: "neutral",
    icon: "search",
    label: "Review Evidence",
  };

  if (!hasMerchantEvidence) {
    mismatch = { tone: "warning", icon: "alert", label: "Merchant Evidence Missing" };
  } else if (reconciliationExecuted) {
    mismatch = { tone: "success", icon: "check", label: "Aligned In Simulation" };
  } else if (caseIsMismatch) {
    mismatch = { tone: "danger", icon: "alert", label: "Mismatch Detected" };
  }

  const paypalStatus = String(evidence.paypalStatus || "UNKNOWN").toUpperCase();

  return (
    <section className="rai-card rai-case-card">
      <div className="rai-card-head">
        <h2>Evidence Comparison</h2>
        <a className="rai-link" href="#evidence-verification">
          View Details <Icon name="arrowRight" size={14} />
        </a>
      </div>

      <div className="rai-compare">
        <div className="rai-evidence-tile paypal">
          <span className="rai-paypal-word">PayPal</span>
          <strong>PayPal Evidence</strong>
          <span className={`rai-tile-status ${statusTone(paypalStatus)}`}>
            <Icon name={statusTone(paypalStatus) === "success" ? "check" : "alert"} size={14} />
            Payment {humanize(paypalStatus)}
          </span>
          <small>Transaction ID</small>
          <span className="rai-mono">{evidence.captureId || "Not recorded"}</span>
          <small>Order</small>
          <span className="rai-mono">{evidence.orderId || "Not recorded"}</span>
        </div>

        <div className={`rai-mismatch ${mismatch.tone}`}>
          <span className="rai-mismatch-arrows" aria-hidden="true">
            <Icon name="arrowLeft" size={16} />
            <span className="rai-mismatch-icon">
              <Icon name={mismatch.icon} size={20} />
            </span>
            <Icon name="arrowRight" size={16} />
          </span>
          <strong>{mismatch.label}</strong>
        </div>

        <div className="rai-evidence-tile merchant">
          <Icon name="store" size={24} className="rai-store-icon" />
          <strong>Merchant Evidence</strong>
          <span className={`rai-tile-status ${statusTone(merchantStatus)}`}>
            <Icon name={statusTone(merchantStatus) === "success" ? "check" : "alert"} size={14} />
            {humanize(merchantStatus)}
          </span>
          <small>Source</small>
          <span>
            {isSimulated
              ? "Simulated merchant order"
              : evidence.evidenceSource || "Not recorded"}
          </span>
          <small>Original state</small>
          <span>{humanize(merchantStatus)}</span>
        </div>
      </div>
    </section>
  );
}

function AiFindingsCard({ model, aiState, aiError, onInvestigate }) {
  const { ai, hasAi, aiSections, investigation } = model;

  const summary =
    aiSections.find((section) => section.title === "Summary") || aiSections[0];

  const summaryLines = summary
    ? summary.text
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s+/, "").trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const recommendation =
    investigation.recommendedAction ||
    ai.recommendedAction ||
    "No recovery guidance has been recorded for this investigation.";

  return (
    <section className="rai-card rai-case-card rai-ai-card">
      <div className="rai-card-head">
        <h2>
          <Icon name="sparkle" size={16} className="rai-ai-spark" /> AI Findings
        </h2>
        <span className="rai-advisory">Advisory</span>
      </div>

      <div className="rai-ai-body">
        {hasAi ? (
          summaryLines.length > 0 ? (
            summaryLines.map((line, index) => (
              <p key={index}>{renderReportText(line)}</p>
            ))
          ) : (
            <p>The AI analysis has no summary section. See the full report below.</p>
          )
        ) : (
          <p>
            No AI analysis has been run for this case. The mismatch detection
            above is deterministic; AI only adds an advisory explanation.
          </p>
        )}
      </div>

      <div className="rai-recommendation">
        <Icon name="bulb" size={18} />
        <p>
          <strong>Recommendation:</strong> {recommendation}
          <small>Rule-based guidance from the backend, separate from the AI model.</small>
        </p>
      </div>

      <div className="rai-ai-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={onInvestigate}
          disabled={aiState === "loading"}
        >
          {aiState === "loading"
            ? "Investigating…"
            : hasAi
              ? "Run AI analysis again"
              : "Investigate with AI"}
        </button>

        {hasAi && (
          <span className="compact-model">
            {ai.model || "Local model"} · Case #{investigation.id}
          </span>
        )}
      </div>

      {aiError && (
        <div className="inline-error" role="alert">
          {aiError}
        </div>
      )}

      {aiState === "loading" && (
        <p className="compact-ai-progress" role="status">
          AI investigation is running. The existing case evidence and payment
          state will remain unchanged.
        </p>
      )}

      {aiState === "complete" && !aiError && (
        <p className="rai-success-note" role="status">
          AI analysis completed and recorded in the audit trail.
        </p>
      )}
    </section>
  );
}

function ProposalStrip({
  model,
  rec,
  operator,
  authChecking,
  onCreate,
  onApprove,
  onExecute,
}) {
  const { proposal, investigation } = model;
  const reconciliation = investigation?.reconciliation || {};

  const status = String(
    proposal?.status || reconciliation.status || ""
  ).toUpperCase();

  const isExecuted = status === "EXECUTED";
  const isApproved = status === "APPROVED";
  const isPending = status === "PENDING" || status === "PENDING_APPROVAL";

  const busy = rec.state === "loading";
  const canAuthorize = Boolean(operator) && !authChecking;

  const proposalId = proposal?.id ?? reconciliation.proposalId;
  const proposedAction =
    proposal?.proposedAction ?? reconciliation.proposedAction;
  const reason =
    proposal?.reason ??
    proposal?.rationale ??
    reconciliation.reason ??
    reconciliation.rationale;

  let heading = "Requires Human Approval";
  let helper = "Please review and approve before execution.";
  let tone = "pending";

  if (!proposal && !proposalId) {
    heading = rec.state === "loading" ? "Loading proposal…" : "No proposal yet";
    helper = "Create a proposal to begin the controlled recovery workflow.";
    tone = "idle";
  } else if (isExecuted) {
    heading = "Executed in simulation";
    helper = "Only the simulated merchant order changed. No real funds moved.";
    tone = "done";
  } else if (isApproved) {
    heading = "Approved — ready to execute";
    helper = "Execution updates the simulated merchant order only.";
    tone = "ready";
  } else if (!isPending) {
    heading = humanize(status);
    helper = "Review the proposal in Reconciliation.";
    tone = "idle";
  }

  return (
    <section className="rai-card rai-proposal">
      <div className="rai-proposal-main">
        <h2>
          <Icon name="sync" size={18} className="rai-proposal-icon" />{" "}
          Reconciliation Proposal
        </h2>

        {proposal || proposalId ? (
          <>
            <p>
              <strong>Action:</strong> {humanize(proposedAction)}
              {proposedAction && (
                <code className="rai-inline-code">{proposedAction}</code>
              )}
            </p>
            {reason && (
              <p>
                <strong>Reason:</strong> {reason}
              </p>
            )}
            <p className="rai-proposal-sim">
              Merchant execution is simulated. Actual merchant records and
              PayPal payments are not changed.
            </p>
          </>
        ) : (
          <p>No reconciliation proposal exists for this investigation.</p>
        )}

        {rec.error && (
          <div className="inline-error" role="alert">
            {rec.error}
          </div>
        )}
      </div>

      <div className="rai-proposal-action">
        <span className={`rai-approval-icon ${tone}`}>
          <Icon name={tone === "idle" ? "alert" : "check"} size={20} />
        </span>
        <div className="rai-approval-copy">
          <strong>{heading}</strong>
          <small>{helper}</small>
        </div>

        {isPending && (
          <button
            type="button"
            className="button button-primary"
            onClick={onApprove}
            disabled={busy || !canAuthorize}
          >
            {busy ? "Processing…" : "Approve proposal"}
            {!busy && <Icon name="arrowRight" size={14} />}
          </button>
        )}

        {isApproved && (
          <button
            type="button"
            className="button button-primary"
            onClick={onExecute}
            disabled={busy || !canAuthorize}
          >
            {busy ? "Executing…" : "Execute approved action"}
            {!busy && <Icon name="arrowRight" size={14} />}
          </button>
        )}

        {isExecuted && <StatusPill type="success">✓ Execution completed</StatusPill>}

        {!proposal && !proposalId && rec.state !== "loading" && (
          <button
            type="button"
            className="button button-primary"
            onClick={onCreate}
            disabled={busy}
          >
            Create proposal
          </button>
        )}
      </div>
    </section>
  );
}

function AuditMiniCard({ model, onViewAll }) {
  const recent = model.auditEvents.slice(-3);

  return (
    <section className="rai-card rai-audit-mini">
      <div className="rai-card-head">
        <h2>
          <Icon name="doc" size={16} /> Audit Trail
        </h2>
        <button type="button" className="rai-link" onClick={onViewAll}>
          View All <Icon name="arrowRight" size={14} />
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="rai-muted">No audit events recorded yet.</p>
      ) : (
        <ul>
          {recent.map((event, index) => (
            <li key={event.id || index}>
              <span className="rai-audit-check">
                <Icon name="check" size={12} />
              </span>
              <span>{AUDIT_LABELS[event.eventType]}</span>
              <time dateTime={event.createdAt}>
                {event.createdAt
                  ? new Date(event.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AiReportSection({ model }) {
  const { ai, aiSections, freshVerificationPassed } = model;

  return (
    <section className="rai-card compact-report-wrapper">
      <div className="compact-report-heading">
        <div>
          <div className="eyebrow">LOCAL LANGUAGE MODEL</div>
          <h3>AI investigation findings</h3>
        </div>

        <span className="compact-report-date">
          Analyzed: {formatTimestamp(ai.analyzedAt)}
        </span>
      </div>

      <div className="compact-report-history-note">
        <strong>Analysis snapshot:</strong> This report was generated on{" "}
        {formatTimestamp(ai.analyzedAt)}. It is an advisory assessment of the
        evidence available at that time. The recorded reconciliation outcome
        is displayed separately in the case state and audit trail.
      </div>

      {freshVerificationPassed && (
        <div className="compact-report-verification">
          PayPal evidence verification passed. This confirms the recorded
          PayPal order and capture match the fresh provider check; it does
          not independently establish merchant fulfillment.
        </div>
      )}

      <div className="compact-full-report">
        {aiSections.map((section, index) => (
          <ReportSection
            key={`${section.title}-${index}`}
            title={section.title}
            text={section.text}
          />
        ))}

        {aiSections.length === 0 && <p>No detailed explanation recorded.</p>}
      </div>
    </section>
  );
}

function InvestigationDetail({
  model,
  operator,
  authChecking,
  aiState,
  aiError,
  rec,
  onBack,
  onRetry,
  onInvestigate,
  onCreate,
  onApprove,
  onExecute,
  onViewAudit,
  onExport,
}) {
  const {
    investigation,
    evidence,
    ai,
    paypal,
    proposal,
    severity,
    severityType,
    caseHeadline,
    caseStatusLabel,
    caseStatusType,
    isSimulated,
    hasMerchantEvidence,
    caseIsMismatch,
    hasAi,
  } = model;

  if (!investigation) {
    return (
      <>
        <button type="button" className="rai-back" onClick={onBack}>
          <Icon name="arrowLeft" size={14} /> Back to Investigations
        </button>
        <LoadNotice model={model} onRetry={onRetry} />
        {model.loadState !== "loading" && !model.loadError && (
          <div className="rai-card rai-empty">
            <strong>No investigation loaded</strong>
            <p>The backend has not returned an investigation for this case.</p>
          </div>
        )}
      </>
    );
  }

  const summaryLine = caseIsMismatch
    ? "Payment status mismatch detected between PayPal and Merchant systems."
    : caseHeadline;

  return (
    <>
      <button type="button" className="rai-back" onClick={onBack}>
        <Icon name="arrowLeft" size={14} /> Back to Investigations
      </button>

      <div className="rai-detail-head">
        <div>
          <h1>
            Investigation #INV-{investigation.id}
            <StatusPill type={severityType}>
              {humanize(severity)} Severity
            </StatusPill>
            <StatusPill type={caseStatusType}>{caseStatusLabel}</StatusPill>
          </h1>
          <p>{summaryLine}</p>
        </div>

        <div className="rai-detail-meta">
          <span>
            Recorded:{" "}
            {evidence.verifiedAt
              ? formatTimestamp(evidence.verifiedAt)
              : "Not recorded"}
          </span>
          <button
            type="button"
            className="button button-primary"
            onClick={onExport}
          >
            <Icon name="download" size={15} /> Export Report
          </button>
        </div>
      </div>

      {model.loadError && (
        <div className="inline-error" role="alert">
          {model.loadError}
        </div>
      )}

      <div className="rai-detail-grid">
        <PaymentOverviewCard model={model} />
        <EvidenceComparisonCard model={model} />
        <AiFindingsCard
          model={model}
          aiState={aiState}
          aiError={aiError}
          onInvestigate={onInvestigate}
        />
      </div>

      <div className="rai-detail-grid-2">
        <ProposalStrip
          model={model}
          rec={rec}
          operator={operator}
          authChecking={authChecking}
          onCreate={onCreate}
          onApprove={onApprove}
          onExecute={onExecute}
        />
        <AuditMiniCard model={model} onViewAll={onViewAudit} />
      </div>

      <div className="rai-integrity">
        <strong>Evidence boundary:</strong>{" "}
        {isSimulated
          ? "This is a simulated merchant discrepancy, not a confirmed customer incident."
          : !hasMerchantEvidence
            ? "Merchant status is UNKNOWN. Saved PayPal evidence alone does not establish a real provider-versus-merchant mismatch."
            : "This case uses recorded merchant state; verify its origin before any recovery action."}
      </div>

      <div className="rai-detail-grid-3">
        <VerificationPanel paypal={paypal} ai={ai} />
        <CurrentCaseState investigation={investigation} proposal={proposal} />
      </div>

      {hasAi && <AiReportSection model={model} />}

      <p className="compact-safety">
        AI findings are advisory. They do not capture, refund or modify
        payments. Recovery actions remain separate controlled operations.
      </p>
    </>
  );
}

/* =========================================================
   Reconciliation, Audit and Settings views
   ========================================================= */

function AuditView({ model, onRetry }) {
  const events = model.investigation?.auditTimeline || [];

  return (
    <>
      <div className="rai-page-heading">
        <h1>Audit Trail</h1>
        <p>
          Append-only history of detection, AI analysis, approval and
          simulated execution events for the loaded case.
        </p>
      </div>

      <LoadNotice model={model} onRetry={onRetry} />

      <section className="rai-card rai-audit-full">
        {getVisibleAuditEvents(events).length === 0 ? (
          <div className="rai-empty">
            <strong>No audit events recorded</strong>
            <p>Events appear here once an investigation has been loaded.</p>
          </div>
        ) : (
          <AuditTimeline events={events} defaultOpen />
        )}
      </section>
    </>
  );
}

function SettingsView({ operator, model, onLogout, busy }) {
  return (
    <>
      <div className="rai-page-heading">
        <h1>Settings</h1>
        <p>Read-only information about this workspace and your session.</p>
      </div>

      <div className="rai-two-col">
        <section className="rai-card rai-settings-card">
          <div className="eyebrow">OPERATOR SESSION</div>
          <h3>Signed-in operator</h3>

          <dl>
            <div>
              <dt>Username</dt>
              <dd>{operator.username}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusPill type="success">Signed in</StatusPill>
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="button button-secondary"
            onClick={onLogout}
            disabled={busy}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </section>

        <section className="rai-card rai-settings-card">
          <div className="eyebrow">ENVIRONMENT</div>
          <h3>Sandbox workspace</h3>

          <dl>
            <div>
              <dt>Payments</dt>
              <dd>PayPal Sandbox — no live payments</dd>
            </div>
            <div>
              <dt>Merchant execution</dt>
              <dd>Simulated only</dd>
            </div>
            <div>
              <dt>AI model</dt>
              <dd>{model.ai.model || "Local model"} — advisory only</dd>
            </div>
            <div>
              <dt>Approval</dt>
              <dd>Human approval required</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}

/* =========================================================
   Application
   ========================================================= */

export default function App() {
  const [investigation, setInvestigation] = useState(null);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [aiState, setAiState] = useState("idle");
  const [aiError, setAiError] = useState("");

  const [paymentState, setPaymentState] = useState("idle");
  const [paymentError, setPaymentError] = useState("");

  const [proposal, setProposal] = useState(null);
  const [reconciliationState, setReconciliationState] =
    useState("loading");
  const [reconciliationError, setReconciliationError] =
    useState("");

  const [captureState, setCaptureState] = useState("loading");
  const [captureResult, setCaptureResult] = useState(null);

  // Operator authentication state
  const [operator, setOperator] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginUsername, setLoginUsername] = useState(() => {
    try {
      return window.localStorage.getItem(REMEMBER_KEY) || "";
    } catch {
      return "";
    }
  });
  const [rememberOperator, setRememberOperator] = useState(() => {
    try {
      return Boolean(window.localStorage.getItem(REMEMBER_KEY));
    } catch {
      return false;
    }
  });
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  // Interface state (presentation only)
  const [view, setView] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchSeed, setSearchSeed] = useState("");

  const isSuccessPage = window.location.pathname === "/success";
  const isCancelPage = window.location.pathname === "/cancel";

  const loadInvestigation = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");

    try {
      const response = await fetch(
        `/api/investigations/${INVESTIGATION_ID}`,
        { credentials: "same-origin" }
      );

      if (response.status === 401) {
        setOperator(null);
        setLoginPassword("");
        setLoginError(
          "Your operator session has expired. Please sign in again."
        );

        throw new Error(
          "Operator authentication is required. Please sign in again."
        );
      }

      const data = await response.json();

      if (!response.ok || !data.success || !data.investigation) {
        throw new Error(data.error || "Could not load investigation.");
      }

      setInvestigation(data.investigation);
      setLoadState("complete");

      return data.investigation;
    } catch (error) {
      setLoadError(error.message || "Investigation unavailable.");
      setLoadState("error");
      throw error;
    }
  }, []);

  const loadProposal = useCallback(async () => {
    setReconciliationState("loading");
    setReconciliationError("");

    try {
      const response = await fetch(
        `/api/reconciliation-proposals/${PROPOSAL_ID}`,
        { credentials: "same-origin" }
      );

      if (response.status === 401) {
        setOperator(null);
        setLoginPassword("");
        setLoginError(
          "Your operator session has expired. Please sign in again."
        );

        throw new Error(
          "Operator authentication is required. Please sign in again."
        );
      }

      const data = await response.json();

      if (!response.ok || data.success !== true) {
        throw new Error(
          data.error || "Could not load reconciliation proposal."
        );
      }

      setProposal(data.proposal || null);
      setReconciliationState("complete");

      return data.proposal || null;
    } catch (error) {
      setReconciliationError(
        error.message || "Could not load reconciliation proposal."
      );
      setReconciliationState("error");
      throw error;
    }
  }, []);

  const refreshCaseData = useCallback(async () => {
    await Promise.all([
      loadInvestigation(),
      loadProposal(),
    ]);
  }, [loadInvestigation, loadProposal]);

  // Load private case data only after operator session restoration.
  useEffect(() => {
    if (isSuccessPage || isCancelPage || authChecking) return;

    if (!operator) {
      setInvestigation(null);
      setProposal(null);
      setAiState("idle");
      setAiError("");
      setLoadState("idle");
      setLoadError("");
      setReconciliationState("idle");
      setReconciliationError("");
      return;
    }

    refreshCaseData().catch(() => {});
  }, [
    isSuccessPage,
    isCancelPage,
    authChecking,
    operator,
    refreshCaseData,
  ]);

  // Restore the operator session when the dashboard loads.
  useEffect(() => {
    if (isSuccessPage || isCancelPage) {
      setAuthChecking(false);
      return;
    }

    let cancelled = false;

    async function restoreOperatorSession() {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
        });

        const data = await response.json();

        if (!response.ok || data.success !== true) {
          throw new Error(
            data.error || "Could not restore operator session."
          );
        }

        if (!cancelled) {
          if (data.authenticated && data.operator) {
            setOperator(data.operator);
            setLoginError("");
          } else {
            setOperator(null);
          }
        }
      } catch {
        if (!cancelled) {
          setOperator(null);
          setLoginError(
            "Unable to verify your operator session. Please log in again."
          );
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    }

    restoreOperatorSession();

    return () => {
      cancelled = true;
    };
  }, [isSuccessPage, isCancelPage]);

  // Complete the PayPal Sandbox capture after the customer returns.
  useEffect(() => {
    if (!isSuccessPage) return;

    const orderId = new URLSearchParams(
      window.location.search
    ).get("token");

    if (!orderId || !/^[A-Za-z0-9-]+$/.test(orderId)) {
      setCaptureState("error");
      setPaymentError(
        "The PayPal return URL did not include a valid order ID."
      );
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/capture`,
          { method: "POST" }
        );
        const data = await response.json();

        if (!response.ok || data.success !== true) {
          throw new Error(
            data.error || "Payment capture could not be confirmed."
          );
        }

        if (!cancelled) {
          setCaptureResult(data);
          setCaptureState("complete");
        }
      } catch (error) {
        if (!cancelled) {
          setPaymentError(
            error.message || "Unable to confirm payment."
          );
          setCaptureState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isSuccessPage]);

  async function handleLogin(event) {
    event.preventDefault();

    if (loginBusy) return;

    setLoginError("");
    setLoginBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Operator login failed.");
      }

      // "Remember me" keeps only the username in this browser, never the password.
      try {
        if (rememberOperator) {
          window.localStorage.setItem(REMEMBER_KEY, loginUsername.trim());
        } else {
          window.localStorage.removeItem(REMEMBER_KEY);
        }
      } catch {
        // Storage can be unavailable; sign-in itself is unaffected.
      }

      setOperator(data.operator);
      setLoginPassword("");
      setLoginError("");
      setView("overview");
    } catch (error) {
      setLoginError(error.message || "Unable to log in.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    if (loginBusy) return;

    setLoginError("");
    setLoginBusy(true);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = await response.json();

      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Operator logout failed.");
      }

      setOperator(null);
      setInvestigation(null);
      setProposal(null);
      setAiState("idle");
      setAiError("");
      setLoadState("idle");
      setLoadError("");
      setReconciliationState("idle");
      setReconciliationError("");
      setLoginPassword("");
      setLoginError("");
      setUserMenuOpen(false);
      setSidebarOpen(false);
      setView("overview");
    } catch (error) {
      setLoginError(error.message || "Unable to log out.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handlePayment() {
    setPaymentState("loading");
    setPaymentError("");

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();

      if (!response.ok || !data.approvalUrl) {
        throw new Error(data.error || "Unable to create PayPal order.");
      }

      setPaymentState("redirecting");
      window.location.assign(data.approvalUrl);
    } catch (error) {
      setPaymentError(error.message || "Unable to start payment.");
      setPaymentState("error");
    }
  }

  async function handleAiInvestigation() {
    setAiState("loading");
    setAiError("");

    try {
      const response = await fetch(
        `/api/investigations/${INVESTIGATION_ID}/ai-analysis`,
        { method: "POST", credentials: "same-origin" }
      );

      if (response.status === 401) {
        setOperator(null);
        setLoginPassword("");
        setLoginError(
          "Your operator session has expired. Please sign in again."
        );

        throw new Error(
          "Operator authentication is required. Please sign in again."
        );
      }

      const data = await response.json();

      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "AI investigation failed.");
      }

      await refreshCaseData();
      setAiState("complete");
    } catch (error) {
      setAiError(error.message || "AI investigation failed.");
      setAiState("error");
    }
  }

  async function reconciliationRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: "same-origin",
    });

    const data = await response.json();

    if (response.status === 401) {
      setOperator(null);
      setLoginPassword("");
      setLoginError(
        "Your operator session has expired. Please sign in again."
      );
      throw new Error(
        "Operator authentication is required. Please sign in again."
      );
    }

    if (!response.ok || data.success !== true) {
      throw new Error(
        data.error || "Reconciliation request failed."
      );
    }

    if (data.proposal) {
      setProposal(data.proposal);
    }

    return data;
  }

  async function handleCreateProposal() {
    setReconciliationState("loading");
    setReconciliationError("");

    try {
      await reconciliationRequest(
        `/api/investigations/${INVESTIGATION_ID}/reconciliation-proposals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      await refreshCaseData();
    } catch (error) {
      setReconciliationError(
        error.message || "Could not create the proposal."
      );
      setReconciliationState("error");
    }
  }

  async function handleRefreshProposal() {
    try {
      await refreshCaseData();
    } catch {
      // Individual loaders already update their visible error states.
    }
  }

  async function handleApproveProposal() {
    if (!operator || !proposal?.id) {
      setLoginError("Sign in as an operator before approving a proposal.");
      return;
    }

    setReconciliationState("loading");
    setReconciliationError("");

    try {
      await reconciliationRequest(
        `/api/reconciliation-proposals/${proposal.id}/approve`,
        {
          method: "POST",
        }
      );

      await refreshCaseData();
    } catch (error) {
      setReconciliationError(
        error.message || "Could not approve the proposal."
      );
      setReconciliationState("error");
    }
  }

  async function handleExecuteReconciliation() {
    if (!operator || !proposal?.id || proposal.status !== "APPROVED") {
      if (!operator) {
        setLoginError("Sign in as an operator before executing a proposal.");
      }
      return;
    }

    setReconciliationState("loading");
    setReconciliationError("");

    try {
      await reconciliationRequest(
        `/api/reconciliation-proposals/${proposal.id}/execute`,
        { method: "POST" }
      );

      await refreshCaseData();
    } catch (error) {
      setReconciliationError(
        error.message || "Could not execute the simulation."
      );
      setReconciliationState("error");
    }
  }

  /* ---------- Presentation-only handlers ---------- */

  function navigate(target) {
    setView(target);
    setSidebarOpen(false);
    setUserMenuOpen(false);
    window.scrollTo({ top: 0 });
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setSearchSeed(searchInput.trim());

    if (view !== "payments") {
      setView("investigations");
    }

    window.scrollTo({ top: 0 });
  }

  function handleRetry() {
    refreshCaseData().catch(() => {});
  }

  function handleExportReport() {
    if (!investigation) return;

    const report = {
      exportedAt: new Date().toISOString(),
      environment: "PayPal Sandbox (simulated merchant execution)",
      note: "Exported from data currently loaded in ResolveAI. AI findings are advisory.",
      investigation,
      reconciliationProposal: proposal,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `resolveai-investigation-${investigation.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- Derived case model ---------- */

  const evidence = investigation?.evidence || {};
  const ai = investigation?.ai || {};
  const paypal = investigation?.paypal || {};
  const reconciliation = investigation?.reconciliation || {};

  /*
   * AI completion is determined by the presence of the model explanation.
   * A rule-based recommendation alone does not count as an AI analysis.
   */
  const hasAi = Boolean(ai.explanation);
  const isSimulated = isTrue(investigation?.simulated);
  const severity = investigation?.severity || "Unknown";

  const severityType = ["HIGH", "CRITICAL"].includes(
    String(severity).toUpperCase()
  )
    ? "danger"
    : "warning";

  const aiSections = parseAiSections(ai.explanation);

  const merchantStatus = String(
    evidence.merchantStatus || "UNKNOWN"
  ).toUpperCase();

  const hasMerchantEvidence = ![
    "UNKNOWN",
    "NOT_RECORDED",
    "",
  ].includes(merchantStatus);

  const classification = String(
    investigation?.classification || ""
  ).toUpperCase();

  const caseIsMismatch = [
    "RECONCILIATION_MISMATCH",
    "SIMULATED_RECONCILIATION_MISMATCH",
    "PAYMENT_COMPLETED_ORDER_PENDING",
  ].includes(classification);

  const caseHeadline = isSimulated
    ? "Simulated payment discrepancy"
    : !hasMerchantEvidence
      ? "Merchant status needs verification"
      : caseIsMismatch
        ? "Provider and merchant statuses differ"
        : "Payment investigation findings";

  const caseStatusLabel = isSimulated
    ? "Simulation only"
    : !hasMerchantEvidence
      ? "Evidence incomplete"
      : "Recorded";

  const caseStatusType =
    isSimulated || !hasMerchantEvidence ? "warning" : "neutral";

  const verificationStatus = String(
    ai?.verification?.status || ""
  ).toUpperCase();

  const paypalVerification = paypal?.apiVerification || {};

  const freshVerificationPassed =
    verificationStatus === "VERIFIED" &&
    isTrue(paypalVerification.verifiedByPayPalApi) &&
    isTrue(paypalVerification.matchesRecordedEvidence);

  const proposalStatus = String(
    proposal?.status || reconciliation.status || ""
  ).toUpperCase();

  const reconciliationExecuted = proposalStatus === "EXECUTED";
  const isPendingProposal =
    proposalStatus === "PENDING" || proposalStatus === "PENDING_APPROVAL";

  const auditEvents = useMemo(
    () => getVisibleAuditEvents(investigation?.auditTimeline || []),
    [investigation]
  );

  // Grid rows are derived only from records returned by the backend.
  const caseRows = useMemo(() => {
    if (!investigation) return [];

    const rowEvidence = investigation.evidence || {};
    const rowReconciliation = investigation.reconciliation || {};

    return [
      {
        id: investigation.id ?? INVESTIGATION_ID,
        caseId: `INV-${investigation.id ?? INVESTIGATION_ID}`,
        classification: investigation.classification || "",
        severity: investigation.severity || "",
        paypalStatus: rowEvidence.paypalStatus || "",
        merchantStatus: rowEvidence.merchantStatus || "",
        amount: formatAmount(rowEvidence.amount, rowEvidence.currency),
        reconciliation:
          rowReconciliation.status || proposal?.status || "",
        updated: formatTime(
          auditEvents[auditEvents.length - 1]?.createdAt ||
            rowEvidence.verifiedAt
        ),
      },
    ];
  }, [investigation, proposal, auditEvents]);

  const paymentRows = useMemo(() => {
    if (!investigation) return [];

    const rowEvidence = investigation.evidence || {};

    return [
      {
        id: investigation.paymentId ?? investigation.id ?? INVESTIGATION_ID,
        paymentId: investigation.paymentId ?? "—",
        orderId: rowEvidence.orderId || "Not recorded",
        captureId: rowEvidence.captureId || "Not recorded",
        amount: formatAmount(rowEvidence.amount, rowEvidence.currency),
        paypalStatus: rowEvidence.paypalStatus || "",
        merchantStatus: rowEvidence.merchantStatus || "",
        source: rowEvidence.evidenceSource || "Not recorded",
      },
    ];
  }, [investigation]);

  const model = {
    investigation,
    proposal,
    evidence,
    ai,
    paypal,
    reconciliation,
    loaded: Boolean(investigation),
    loadState,
    loadError,
    hasAi,
    isSimulated,
    severity,
    severityType,
    aiSections,
    merchantStatus,
    hasMerchantEvidence,
    caseIsMismatch,
    caseHeadline,
    caseStatusLabel,
    caseStatusType,
    freshVerificationPassed,
    proposalStatus,
    reconciliationExecuted,
    isPendingProposal,
    auditEvents,
    caseRows,
    paymentRows,
  };

  /* ---------- PayPal return pages ---------- */

  if (isSuccessPage || isCancelPage) {
    return (
      <div className="rai-return-shell">
        <header className="rai-return-header">
          <a href="/" aria-label="ResolveAI home">
            <BrandLogo size={30} inverse />
          </a>
          <span className="rai-sandbox-pill dark">
            <span className="live-dot" /> PayPal Sandbox
          </span>
        </header>

        <main className="return-page">
          <div className="return-card">
            <div
              className={`return-icon ${
                isCancelPage ? "" : captureState
              }`}
            >
              {isCancelPage
                ? "↩"
                : captureState === "complete"
                  ? "✓"
                  : captureState === "error"
                    ? "!"
                    : "↻"}
            </div>

            <div className="eyebrow">PAYPAL SANDBOX CHECKOUT</div>

            <h1>
              {isCancelPage
                ? "Checkout cancelled"
                : captureState === "loading"
                  ? "Confirming your payment"
                  : captureState === "complete"
                    ? "Payment confirmation received"
                    : "We couldn't confirm the payment"}
            </h1>

            <p>
              {isCancelPage
                ? "You returned from PayPal without completing checkout."
                : captureState === "loading"
                  ? "ResolveAI is checking the capture response."
                  : captureState === "complete"
                    ? "The backend confirmed the PayPal Sandbox capture."
                    : paymentError}
            </p>

            {captureResult && (
              <pre className="result-json">
                {JSON.stringify(captureResult, null, 2)}
              </pre>
            )}

            {captureState === "error" && !isCancelPage && (
              <p>
                Check the existing order in PayPal before retrying
                capture, to avoid duplicate operations.
              </p>
            )}

            <a className="button button-primary" href="/">
              Return to ResolveAI
            </a>
          </div>
        </main>
      </div>
    );
  }

  /* ---------- Before login ---------- */

  if (authChecking) {
    return <SplashScreen />;
  }

  if (!operator) {
    return (
      <LoginScreen
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        busy={loginBusy}
        remember={rememberOperator}
        paymentState={paymentState}
        paymentError={paymentError}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onRememberChange={setRememberOperator}
        onLogin={handleLogin}
        onCheckout={handlePayment}
      />
    );
  }

  /* ---------- After login ---------- */

  const inDetail = view === "investigation";
  const activeNav = inDetail ? "investigations" : view;

  const recState = {
    state: reconciliationState,
    error: reconciliationError,
  };

  return (
    <div className="rai-shell">
      <Sidebar
        activeNav={activeNav}
        open={sidebarOpen}
        onNavigate={navigate}
        onLogout={handleLogout}
        logoutBusy={loginBusy}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="rai-main">
        <Topbar
          operator={operator}
          inDetail={inDetail}
          caseLabel={`INV-${investigation?.id ?? INVESTIGATION_ID}`}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearchSubmit}
          onOpenMenu={() => setSidebarOpen(true)}
          onBackToList={() => navigate("investigations")}
          pendingApproval={isPendingProposal}
          onBell={() => navigate("reconciliation")}
          userMenuOpen={userMenuOpen}
          onToggleUserMenu={() => setUserMenuOpen((open) => !open)}
          onLogout={handleLogout}
          logoutBusy={loginBusy}
        />

        <main className="rai-content" id="main-content">
          {loginError && (
            <div className="inline-error" role="alert">
              {loginError}
            </div>
          )}

          {view === "overview" && (
            <OverviewView
              model={model}
              aiState={aiState}
              aiError={aiError}
              onNavigate={navigate}
              onRetry={handleRetry}
              onInvestigate={handleAiInvestigation}
            />
          )}

          {view === "payments" && (
            <PaymentsView
              model={model}
              searchSeed={searchSeed}
              paymentState={paymentState}
              paymentError={paymentError}
              onCheckout={handlePayment}
              onRetry={handleRetry}
            />
          )}

          {view === "investigations" && (
            <InvestigationsView
              model={model}
              searchSeed={searchSeed}
              onOpenCase={() => navigate("investigation")}
              onRetry={handleRetry}
            />
          )}

          {view === "investigation" && (
            <InvestigationDetail
              model={model}
              operator={operator}
              authChecking={authChecking}
              aiState={aiState}
              aiError={aiError}
              rec={recState}
              onBack={() => navigate("investigations")}
              onRetry={handleRetry}
              onInvestigate={handleAiInvestigation}
              onCreate={handleCreateProposal}
              onApprove={handleApproveProposal}
              onExecute={handleExecuteReconciliation}
              onViewAudit={() => navigate("audit")}
              onExport={handleExportReport}
            />
          )}

          {view === "reconciliation" && (
            <>
              <div className="rai-page-heading">
                <h1>Reconciliation</h1>
                <p>
                  Human-approved recovery. Merchant execution is simulated
                  and never changes real records or funds.
                </p>
              </div>

              <LoadNotice model={model} onRetry={handleRetry} />

              <ReconciliationPanel
                proposal={proposal}
                investigation={investigation}
                state={reconciliationState}
                error={reconciliationError}
                operator={operator}
                authChecking={authChecking}
                onRefresh={handleRefreshProposal}
                onCreate={handleCreateProposal}
                onApprove={handleApproveProposal}
                onExecute={handleExecuteReconciliation}
              />
            </>
          )}

          {view === "audit" && (
            <AuditView model={model} onRetry={handleRetry} />
          )}

          {view === "settings" && (
            <SettingsView
              operator={operator}
              model={model}
              onLogout={handleLogout}
              busy={loginBusy}
            />
          )}

          <footer className="dashboard-footer">
            <span className="footer-brand">
              <Icon name="shieldcheck" size={18} />
              <strong>ResolveAI</strong>
              <span aria-hidden="true">•</span>
              Intelligent payment reconciliation with human oversight
            </span>
            <span>PayPal Sandbox | Local AI</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
