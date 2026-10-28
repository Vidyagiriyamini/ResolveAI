import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [paymentStatus, setPaymentStatus] = useState("ready");
  const [errorMessage, setErrorMessage] = useState("");
  const [paymentResult, setPaymentResult] = useState(null);

  const isSuccessPage = window.location.pathname === "/success";

  useEffect(() => {
    if (!isSuccessPage) return;

    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("token");

    if (!orderId) {
      setPaymentStatus("error");
      setErrorMessage("PayPal did not return an order ID.");
      return;
    }

    let cancelled = false;

    async function capturePayment() {
      try {
        setPaymentStatus("loading");
        setErrorMessage("");

        const response = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/capture`,
          { method: "POST" }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || "PayPal payment capture failed."
          );
        }

        if (!cancelled) {
          setPaymentResult(data);
          setPaymentStatus("completed");
        }
      } catch (error) {
        if (!cancelled) {
          setPaymentStatus("error");
          setErrorMessage(
            error.message || "Unable to confirm payment."
          );
        }
      }
    }

    capturePayment();

    return () => {
      cancelled = true;
    };
  }, [isSuccessPage]);

  async function handlePayment() {
    try {
      setPaymentStatus("loading");
      setErrorMessage("");

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not create the PayPal order."
        );
      }

      if (!data.approvalUrl) {
        throw new Error("PayPal did not return an approval link.");
      }

      window.location.href = data.approvalUrl;
    } catch (error) {
      setPaymentStatus("ready");
      setErrorMessage(
        error.message || "Unable to connect to PayPal."
      );
    }
  }

  if (isSuccessPage) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="/">
            <span className="brand-icon">R</span>
            <span>
              Resolve<span className="brand-accent">AI</span>
            </span>
          </a>
          <span className="sandbox-badge">
            <span className="status-dot" />
            Sandbox environment
          </span>
        </header>

        <main className="main-content">
          <section className="checkout-card">
            {paymentStatus === "loading" && (
              <>
                <h1>Confirming your payment…</h1>
                <p>Please wait while ResolveAI verifies the result with PayPal.</p>
              </>
            )}

            {paymentStatus === "completed" && paymentResult && (
              <>
                <h1>Payment successful!</h1>
                <p>Your $10.00 USD Sandbox payment is confirmed.</p>
                <p>
                  <strong>Order status:</strong>{" "}
                  {paymentResult.orderStatus}
                </p>
                <p>
                  <strong>Capture status:</strong>{" "}
                  {paymentResult.captureStatus}
                </p>
                <p>
                  <strong>Capture ID:</strong>{" "}
                  {paymentResult.captureId}
                </p>
                <button
                  className="pay-button"
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  Return to ResolveAI
                </button>
              </>
            )}

            {paymentStatus === "error" && (
              <>
                <h1>Payment not yet confirmed</h1>
                <p>{errorMessage}</p>
                <p>
                  Check the backend terminal before trying again.
                  Do not create another payment just to retry confirmation.
                </p>
                <button
                  className="pay-button"
                  onClick={() => window.location.href = "/"}
                >
                  Return to ResolveAI
                </button>
              </>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-icon">R</span>
          <span>
            Resolve<span className="brand-accent">AI</span>
          </span>
        </a>
        <span className="sandbox-badge">
          <span className="status-dot" />
          Sandbox environment
        </span>
      </header>

      <main className="main-content">
        <section className="intro">
          <p className="eyebrow">SMARTER PAYMENTS. SAFER RECOVERY.</p>
          <h1>
            Payments made simple.
            <br />
            <span>Problems resolved intelligently.</span>
          </h1>
          <p className="intro-copy">
            Experience a secure test payment. ResolveAI will help
            merchants investigate and resolve payment issues with AI.
          </p>
        </section>

        <section className="checkout-card">
          <div className="card-heading">
            <div>
              <p className="muted-label">ORDER SUMMARY</p>
              <h2>Demo purchase</h2>
            </div>
            <span className="order-icon">↗</span>
          </div>

          <div className="product-row">
            <div className="product-icon">✦</div>
            <div className="product-details">
              <strong>ResolveAI Demo Product</strong>
              <span>Sandbox test transaction</span>
            </div>
            <strong>$10.00</strong>
          </div>

          <div className="total-row">
            <span>Total</span>
            <strong>$10.00 USD</strong>
          </div>

          <div className="payment-section">
            <p className="muted-label">PAYMENT METHOD</p>
            <div className="paypal-placeholder">
              <span className="paypal-mark">P</span>
              <div>
                <strong>PayPal Sandbox</strong>
                <span>Secure test checkout</span>
              </div>
              <span className="secure-label">Secure</span>
            </div>

            <button
              className="pay-button"
              onClick={handlePayment}
              disabled={paymentStatus === "loading"}
            >
              {paymentStatus === "loading"
                ? "Connecting to PayPal..."
                : "Continue to PayPal"}
              <span>→</span>
            </button>

            <p className="helper-text">
              Sandbox test only. No real money will be charged.
            </p>

            {errorMessage && (
              <p className="notice" role="alert">
                {errorMessage}
              </p>
            )}
          </div>
        </section>

        <section className="features">
          <div>
            <span className="feature-icon">⌁</span>
            <strong>Payment visibility</strong>
            <p>Track payment and order states.</p>
          </div>
          <div>
            <span className="feature-icon">✧</span>
            <strong>AI investigation</strong>
            <p>Understand payment issues faster.</p>
          </div>
          <div>
            <span className="feature-icon">✓</span>
            <strong>Safe recovery</strong>
            <p>Verify outcomes before resolving incidents.</p>
          </div>
        </section>

        <footer>
          ResolveAI · Hackathon prototype · PayPal Sandbox
        </footer>
      </main>
    </div>
  );
}

export default App;
