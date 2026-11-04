# ResolveAI

**Smarter payments. Safer recovery.**

ResolveAI is an AI-assisted payment investigation and reconciliation platform. It identifies discrepancies between PayPal payment evidence and merchant-side payment records, explains verified evidence, and supports controlled recovery.

## Features
- PayPal Sandbox Orders and Captures integration.
- Independent PayPal payment-evidence verification.
- Deterministic payment discrepancy detection.
- AI investigation using local Ollama and Llama 3.2.
- AI report validation and deterministic fallback.
- Operator authentication and session management.
- PayPal webhook signature verification and event recording.
- Human-approved, idempotent simulated reconciliation.
- SQLite persistence and audit events.

## How It Works
1. ResolveAI obtains and verifies PayPal payment evidence.
2. Deterministic rules detect payment discrepancies.
3. AI explains verified evidence, possible causes, missing evidence, and next steps.
4. An authenticated operator reviews and approves an eligible reconciliation.
5. The simulated merchant record is updated and the action is audited.

## Technology
- Frontend: React 19 and Vite 6.
- Backend: Node.js 20 and Express 5.
- Database: SQLite with better-sqlite3.
- Payments: PayPal REST APIs (Sandbox).
- AI: Ollama with Llama 3.2.

## Safety Boundaries
- PayPal integration is configured for Sandbox use.
- AI does not determine payment status or detect discrepancies.
- AI investigation requires verified PayPal evidence.
- Reconciliation requires authenticated operator approval.
- Reconciliation updates simulated merchant records only.
- No automatic refund, second charge, or production merchant update is performed.

## Local Setup
Prerequisites: Node.js 20+, npm, PayPal Sandbox credentials. Ollama is optional.

1. Clone this repository: `git clone https://github.com/Vidyagiriyamini/ResolveAI.git`
2. Enter the project folder: `cd ResolveAI`
3. Install dependencies: `npm install` and `npm install --prefix client`.
4. Copy `.env.example` to `.env` and configure your PayPal Sandbox credentials, operator password, and session secret.
5. Optionally install Ollama and run `ollama pull llama3.2`.
6. Build the frontend: `npm run build`.
7. Start the application: `npm start`.

The server runs at `http://localhost:3000` by default. Startup runs the database migrations.

Never commit `.env` or share credentials. Keep all secrets private.

## Testing
- Run automated tests with `npm test`.
- Build the frontend with `npm run build`.
- Health endpoint: `http://localhost:3000/api/health`.
- Database health: `http://localhost:3000/api/health/database`.

## Current Limitations
- PayPal integration uses Sandbox, not live payment processing.
- Live local AI requires Ollama on the machine hosting the application.
- Cloud deployment requires separate environment and persistent database configuration.
- Merchant reconciliation is simulated and does not modify a real external merchant system.
- Webhook registration requires a deployed HTTPS endpoint and PayPal Dashboard configuration.

## License
MIT License. See the `LICENSE` file.
