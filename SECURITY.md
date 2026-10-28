# Security Policy - ZeroWasteIN

## API Key and Secret Management

- **Server-Side Only Execution**: All provider API keys (`JARVISLABS_API_KEY`, `GEMINI_API_KEY`) reside exclusively in server-side runtime environments (Vercel Serverless Functions).
- **No Client Exposure**: Client applications (`apps/web`) are strictly forbidden from accessing secret environment variables. No secrets are prefixed with `VITE_` or embedded into client bundles.
- **Automated Validation**: CI and automated test suites verify that no source code or build artifact in `apps/web` contains references to server secrets.
- **Repository Hygiene**: Local `.env` files are excluded in `.gitignore` and must never be committed to source control.

## Data Logging and Privacy Restrictions

- **Zero Image Persistence**: User photos and images uploaded for waste classification are processed in volatile memory only and are **never** written to disk, databases, or object storage.
- **Request Body Privacy**: Full HTTP request bodies containing raw base64 image data or file buffers are **never** logged to server stdout, runtime logs, or telemetry services.
- **Log Sanitization**: Application logs record only anonymized event metadata (e.g., classification latency, assigned waste stream, HTTP status code, non-sensitive error classification).
- **No Face or PII Collection**: Citizens are instructed to photograph only inanimate waste items. Photos containing human faces, documents, or personal identifiable information (PII) must not be retained or used for training.

## Network and Browser Security

- **Strict Content Security Policy (CSP)**: The web client enforces `default-src 'self'` with no inline scripts and restricted connect-src.
- **Hardware Permissions Policy**: Device camera access is restricted strictly to origin (`camera=(self)`); microphone and geolocation are disabled.
