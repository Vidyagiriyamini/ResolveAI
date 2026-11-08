# ResolveAI

**Smarter payments. Safer recovery.**

ResolveAI is an AI-assisted payment investigation and reconciliation platform built to help payment operations teams investigate discrepancies between PayPal payment evidence and merchant-side payment records.

It combines verified payment evidence, deterministic discrepancy detection, AI-assisted explanations, and human-controlled simulated recovery in one operations workbench.

## Key Features

- **PayPal Sandbox integration:** Retrieve orders and captures using PayPal REST APIs.
- **Evidence verification:** Independently verify payment details before investigation.
- **Deterministic discrepancy detection:** Identify mismatches between PayPal and merchant-side records.
- **AI-assisted investigation:** Use local Ollama with Llama 3.2 to explain verified evidence.
- **Validated AI reports:** Validate AI output and use a deterministic fallback when AI is unavailable or its response is unsuitable.
- **Operations dashboard:** Review payment activity, incidents, investigations, and reconciliation proposals.
- **Interactive operations workbench:** AG Grid Community supports sorting, filtering, pagination, row selection, and CSV export.
- **Operator authentication:** Protect investigation and reconciliation workflows with authenticated sessions.
- **PayPal webhooks:** Verify webhook signatures and record supported events.
- **Human-approved recovery:** Review and approve eligible simulated reconciliation actions.
- **Audit trail:** Record important investigation and reconciliation events.

## How It Works

1. **Verify:** Retrieve PayPal payment evidence and independently verify the relevant payment details.
2. **Detect:** Apply deterministic rules to identify discrepancies between PayPal and merchant-side records.
3. **Investigate:** Generate an AI-assisted explanation based on verified evidence, including possible explanations, missing evidence, and recommended next steps.
4. **Review:** An authenticated operator reviews the investigation and eligible reconciliation proposal.
5. **Approve:** The operator explicitly approves the simulated recovery action.
6. **Audit:** Record the outcome and relevant actions in the audit trail.

## Operations Workbench

ResolveAI provides an operator-focused interface for reviewing payment operations:

- Dashboard overview of payment and investigation activity.
- Investigation and incident review.
- Reconciliation proposal review and status tracking.
- Searchable, sortable, and filterable data grids.
- Pagination and CSV export.
- Clear separation between verified payment evidence and AI-generated analysis.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 6 |
| Operations grid | AG Grid Community |
| Backend | Node.js 20, Express 5 |
| Database | SQLite, better-sqlite3 |
| Payment integration | PayPal REST APIs (Sandbox) |
| AI | Ollama, Llama 3.2 |
| Testing | Automated Node.js test suites |

## Safety and Human Oversight

ResolveAI is designed around controlled payment operations:

- PayPal integration is configured for Sandbox use.
- Deterministic application logic—not AI—determines payment status and detects discrepancies.
- AI investigation requires verified PayPal evidence.
- AI output is validated, with a deterministic fallback when necessary.
- Reconciliation requires authenticated operator approval.
- Reconciliation updates simulated merchant records only.
- Idempotency safeguards help prevent duplicate simulated execution.
- No automatic refunds, second charges, or production merchant updates are performed.

## Local Setup

### Prerequisites

- Node.js 20 or later
- npm
- PayPal Sandbox application credentials
- Ollama is optional; it is required for local live AI inference.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/Vidyagiriyamini/ResolveAI.git
   cd ResolveAI
   ```

2. Install dependencies:

   ```bash
   npm install
   npm install --prefix client
   ```

3. Create a local `.env` file from `.env.example`.

4. Configure the required PayPal Sandbox credentials, operator credentials, session secret, and other environment settings.

5. Optionally install Ollama and download the model:

   ```bash
   ollama pull llama3.2
   ```

6. Build the frontend:

   ```bash
   npm run build
   ```

7. Start the application:

   ```bash
   npm start
   ```

The application runs at `http://localhost:3000` by default. Database migrations run during startup.

**Security:** Never commit `.env`, credentials, session secrets, or local database files to the repository.

## Testing and Health Checks

Run the automated test suites:

```bash
npm test
```

Build the frontend:

```bash
npm run build
```

Application health endpoint:

```text
http://localhost:3000/api/health
```

Database health endpoint:

```text
http://localhost:3000/api/health/database
```

## Current Limitations

- PayPal integration uses Sandbox, not live payment processing.
- Local AI inference requires Ollama to be available on the machine hosting the application.
- A cloud deployment cannot access a developer's local Ollama instance without additional infrastructure.
- Cloud deployment requires appropriate environment configuration and persistent database storage.
- Merchant reconciliation is simulated; it does not update a real external merchant system.
- PayPal webhook registration requires a deployed HTTPS endpoint and PayPal Dashboard configuration.

## License

MIT License. See the `LICENSE` file.