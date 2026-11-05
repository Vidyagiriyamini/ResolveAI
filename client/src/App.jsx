
import { useCallback, useEffect, useState } from "react";
import "./App.css";
import "./CompactDashboard.css";

const INVESTIGATION_ID = 3;
const PROPOSAL_ID = 1;

function BrandHeader() {
  return (
    <header className="topbar">
      <a href="/" className="brand-lockup" aria-label="ResolveAI home">
        <span className="brand-mark">
          <span className="brand-mark-symbol">R</span>
        </span>
        <span className="brand-name">
          Resolve<span>AI</span>
        </span>
      </a>

      <nav className="topbar-nav" aria-label="Main navigation">
        <a className="nav-item active" href="/">Overview</a>
        <a className="nav-item" href="#investigation">Investigation</a>
        <a className="nav-item" href="#reconciliation">Reconciliation</a>
        <a className="nav-item" href="#checkout">Payment demo</a>
      </nav>

      <div className="topbar-right">
        <span className="sandbox-badge">
          <span className="live-dot" /> PayPal Sandbox
        </span>
      </div>
    </header>
  );
}

function StatusPill({ children, type = "neutral" }) {
  return <span className={`status-pill ${type}`}>{children}</span>;
}

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

function isTrue(value) {
  return value === true || value === 1 || value === "1";
}

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
        <span className="compact-chevron" aria-hidden="true">⌄</span>
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

          return (
            <p key={index}>
              {renderReportText(line)}
            </p>
          );
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
    <section className="compact-verification">
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
    <section className="compact-current-state">
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
function AuditTimeline({ events = [] }) {
  if (!events.length) return null;

  const labels = {
    DETECTION_COMPLETED: "Mismatch detected",
    AI_ANALYSIS_COMPLETED: "AI analysis completed",
    RECONCILIATION_PROPOSED: "Reconciliation proposal created",
    RECONCILIATION_APPROVED: "Human approval recorded",
    RECONCILIATION_EXECUTED: "Simulated reconciliation executed",
  };

  const visibleEvents = events
    .filter((event) =>
      Object.prototype.hasOwnProperty.call(labels, event.eventType)
    )
    .slice()
    .sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeA - timeB;
    });

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
    <details className="compact-audit">
      <summary>
        View case audit trail
        <span className="compact-audit-count">
          {visibleEvents.length} events
        </span>
        <span className="compact-chevron" aria-hidden="true">⌄</span>
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
                  <span className="compact-chevron" aria-hidden="true">⌄</span>
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
                <strong>{labels[event.eventType]}</strong>
                <span>{formatTimestamp(event.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function OperatorAccess({
  operator,
  authChecking,
  username,
  password,
  error,
  busy,
  onUsernameChange,
  onPasswordChange,
  onLogin,
  onLogout,
}) {
  if (authChecking) {
    return (
      <section className="operator-access" aria-live="polite">
        <div>
          <strong>Operator access</strong>
          <p>Checking your operator session…</p>
        </div>
      </section>
    );
  }

  if (operator) {
    return (
      <section className="operator-access">
        <div className="operator-access-info">
          <span className="operator-access-label">AUTHENTICATED OPERATOR</span>
          <strong>{operator.username}</strong>
          <StatusPill type="success">Signed in</StatusPill>
        </div>

        <button
          type="button"
          className="button button-secondary"
          onClick={onLogout}
          disabled={busy}
        >
          Sign out
        </button>

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="operator-access">
      <div className="operator-access-heading">
        <span className="eyebrow">CONTROLLED RECOVERY ACCESS</span>
        <h2>Operator sign in</h2>
        <p>
          Sign in to approve or execute reconciliation proposals.
          Investigation and payment demo features remain available.
        </p>
      </div>

      <form className="operator-login-form" onSubmit={onLogin}>
        <label htmlFor="operator-username">Username</label>
        <input
          id="operator-username"
          name="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="Enter operator username"
          required
          disabled={busy}
        />

        <label htmlFor="operator-password">Password</label>
        <input
          id="operator-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="Enter operator password"
          required
          disabled={busy}
        />

        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  );
}

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
              <StatusPill type={statusType}>
                {humanize(status)}
              </StatusPill>
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
                  {executedAt
                    ? formatTimestamp(executedAt)
                    : "Not executed"}
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
              <StatusPill type="success">
                ✓ Execution completed
              </StatusPill>
            )}

            {!isPending && !isApproved && !isExecuted && (
              <StatusPill type="warning">
                {humanize(status)}
              </StatusPill>
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
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

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

      setOperator(data.operator);
      setLoginPassword("");
      setLoginError("");
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

  if (isSuccessPage || isCancelPage) {
    return (
      <div className="app-shell">
        <BrandHeader />

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

  const evidence = investigation?.evidence || {};
  const ai = investigation?.ai || {};
  const paypal = investigation?.paypal || {};

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

  const reconciliation = investigation?.reconciliation || {};

  const reconciliationExecuted =
    String(
      reconciliation.status || proposal?.status || ""
    ).toUpperCase() === "EXECUTED";

  return (
    <div className="app-shell">
      <BrandHeader />

      <OperatorAccess
        operator={operator}
        authChecking={authChecking}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        busy={loginBusy}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onLogin={handleLogin}
        onLogout={handleLogout}
      />

      <main className="dashboard compact-dashboard">
        <section className="compact-hero">
          <div>
            <div className="eyebrow">
              PAYMENT OPERATIONS / OVERVIEW
            </div>

            <h1>
              Payment intelligence, <span>without the noise.</span>
            </h1>

            <p>
              Verify discrepancies, review AI findings, and decide
              on safe next steps.
            </p>
          </div>

          <StatusPill type="warning">
            Sandbox environment
          </StatusPill>
        </section>

        {operator && !authChecking && (
          <section
            className="compact-metrics"
            aria-label="Investigation summary"
          >
            <div className="compact-metric">
              <span>Current case</span>
              <strong>#{investigation?.id || INVESTIGATION_ID}</strong>
              <small>
                {loadState === "complete"
                  ? "Loaded from SQLite"
                  : humanize(loadState)}
              </small>
            </div>

            <div className="compact-metric">
              <span>Severity</span>
              <strong>
                {investigation ? humanize(severity) : "—"}
              </strong>
              <small>
                {isSimulated
                  ? "Simulated scenario"
                  : !hasMerchantEvidence
                    ? "Merchant evidence missing"
                    : "Recorded evidence"}
              </small>
            </div>

            <div className="compact-metric">
              <span>AI analysis</span>
              <strong>
                {aiState === "loading"
                  ? "Running…"
                  : hasAi
                    ? humanize(ai.status || "Available")
                    : "Not run"}
              </strong>
              <small>{ai.model || "Local AI"}</small>
            </div>

            <div className="compact-metric">
              <span>Recovery</span>
              <strong>
                {reconciliationExecuted
                  ? "Simulated execution"
                  : "Human-led"}
              </strong>
              <small>
                {reconciliationExecuted
                  ? "Actual payment unchanged"
                  : "No automatic payment changes"}
              </small>
            </div>
          </section>
        )}

        <div className="compact-layout">
          {operator && !authChecking && (
            <section id="investigation" className="panel compact-case">
              <div className="compact-section-header">
                <div>
                  <div className="eyebrow">INVESTIGATION WORKSPACE</div>
                  <h2>Payment investigation</h2>
                </div>

                {investigation && (
                  <StatusPill type={caseStatusType}>
                    {caseStatusLabel}
                  </StatusPill>
                )}
              </div>

              {loadState === "loading" && (
                <p role="status">
                  Loading investigation from the backend…
                </p>
              )}

              {loadError && (
                <div className="inline-error" role="alert">
                  {loadError}{" "}
                  <button
                    className="button button-primary"
                    onClick={() => refreshCaseData().catch(() => {})}
                  >
                    Retry
                  </button>
                </div>
              )}

              {investigation && (
                <>
                  <div className="compact-case-title">
                    <div>
                      <span className="eyebrow">
                        {humanize(investigation.classification)}
                      </span>
                      <h3>{caseHeadline}</h3>
                    </div>

                    <StatusPill type={severityType}>
                      {humanize(severity)} severity
                    </StatusPill>
                  </div>

                  <div className="compact-evidence">
                    <div className="compact-evidence-card">
                      <span>PayPal · recorded evidence</span>
                      <strong>{humanize(evidence.paypalStatus)}</strong>
                      <small>
                        Order: {evidence.orderId || "Not recorded"}
                      </small>
                    </div>

                    <div className="compact-evidence-card">
                      <span>
                        Merchant · original simulated state
                      </span>
                      <strong>{humanize(merchantStatus)}</strong>
                      <small>
                        Capture: {evidence.captureId || "Not recorded"}
                      </small>
                    </div>
                  </div>

                  <div className="compact-evidence-meta">
                    <span>
                      Amount:{" "}
                      <strong>
                        {evidence.amount || "—"} {evidence.currency || ""}
                      </strong>
                    </span>

                    <span>
                      Source:{" "}
                      <strong>
                        {evidence.evidenceSource || "Not recorded"}
                      </strong>
                    </span>

                    {evidence.verifiedAt && (
                      <span>
                        Recorded:{" "}
                        <strong>{formatTimestamp(evidence.verifiedAt)}</strong>
                      </span>
                    )}
                  </div>

                  <div className="compact-integrity">
                    <strong>Evidence boundary:</strong>{" "}
                    {isSimulated
                      ? "This is a simulated merchant discrepancy, not a confirmed customer incident."
                      : !hasMerchantEvidence
                        ? "Merchant status is UNKNOWN. Saved PayPal evidence alone does not establish a real provider-versus-merchant mismatch."
                        : "This case uses recorded merchant state; verify its origin before any recovery action."}
                  </div>

                  <VerificationPanel paypal={paypal} ai={ai} />

                  <CurrentCaseState
                    investigation={investigation}
                    proposal={proposal}
                  />

                  <div className="compact-ai-card">
                    <div className="compact-ai-top">
                      <div>
                        <div className="eyebrow">
                          RULE-BASED DECISION SUPPORT
                        </div>
                        <h3>Recovery guidance</h3>
                      </div>

                      <StatusPill type="neutral">
                        Backend rule
                      </StatusPill>
                    </div>

                    <p className="compact-recommendation">
                      {investigation.recommendedAction ||
                        ai.recommendedAction ||
                        "No recovery guidance has been recorded for this investigation."}
                    </p>

                    <p className="compact-guidance-note">
                      This recommendation is supplied by the deterministic
                      backend decision logic. It is separate from the
                      language model's analysis.
                    </p>

                    <div className="compact-ai-actions">
                      <button
                        className="button button-primary"
                        onClick={handleAiInvestigation}
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
                        AI investigation is running. The existing case
                        evidence and payment state will remain unchanged.
                      </p>
                    )}

                    {hasAi && (
                      <div className="compact-report-wrapper">
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
                          <strong>Analysis snapshot:</strong> This report
                          was generated on {formatTimestamp(ai.analyzedAt)}.
                          It is an advisory assessment of the evidence
                          available at that time. The recorded reconciliation
                          outcome is displayed separately in the case state
                          and audit trail.
                        </div>

                        {freshVerificationPassed && (
                          <div className="compact-report-verification">
                            PayPal evidence verification passed. This confirms
                            the recorded PayPal order and capture match the
                            fresh provider check; it does not independently
                            establish merchant fulfillment.
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

                          {aiSections.length === 0 && (
                            <p>No detailed explanation recorded.</p>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="compact-safety">
                      AI findings are advisory. They do not capture,
                      refund or modify payments. Recovery actions remain
                      separate controlled operations.
                    </p>
                  </div>

                  <AuditTimeline events={investigation.auditTimeline || []} />
                </>
              )}
            </section>
          )}

          <aside className="compact-sidebar">
            <section id="checkout" className="panel compact-checkout">
              <div className="eyebrow">PAYPAL INTEGRATION</div>
              <h3>Sandbox checkout</h3>

              <p>
                Test the existing PayPal payment lifecycle.
              </p>

              <div className="compact-product">
                <span>ResolveAI Demo Product</span>
                <strong>$10.00</strong>
              </div>

              {paymentError && (
                <div className="inline-error" role="alert">
                  {paymentError}
                </div>
              )}

              <button
                className="button button-paypal"
                onClick={handlePayment}
                disabled={
                  paymentState === "loading" ||
                  paymentState === "redirecting"
                }
              >
                {paymentState === "loading"
                  ? "Creating order…"
                  : paymentState === "redirecting"
                    ? "Redirecting…"
                    : "PayPal · Continue to checkout →"}
              </button>

              <small>Sandbox only · No live payment</small>
            </section>

            <section className="panel compact-trust">
              <div className="eyebrow">SAFETY BY DESIGN</div>
              <h3>Human oversight</h3>

              <p>
                Provider evidence, actual merchant records, simulated
                merchant state, and AI interpretation remain separate.
              </p>

              <p>
                Recovery actions require fresh provider verification
                and an authenticated operator's approval. The backend
                enforces operator authentication before approval and
                execution.
              </p>
            </section>
          </aside>
        </div>

        {operator && !authChecking && (
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
        )}

        <footer className="dashboard-footer">
          <span>
            ResolveAI · Payment intelligence with human oversight
          </span>
          <span>PayPal Sandbox + Local AI</span>
        </footer>
      </main>
    </div>
  );
}
