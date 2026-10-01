# Security and privacy

## Data boundaries

- Projects, source photos, presets and recovery data are stored locally.
- The bundled cutout model runs on the local machine.
- Online AI sends the content needed for the selected task to the configured provider. Image privacy settings apply to image transmission; they do not make an online text conversation offline.
- API keys use Windows DPAPI encryption tied to the current user. DPAPI does not establish hardware-backed or compromise-proof protection.
- MCP is disabled by default and uses an authenticated loopback server. Its stdio adapter connects to that server.

See [storage](docs/STORAGE.md), [provider configuration](docs/PROVIDERS.md), and [MCP](docs/MCP.md) for the implementation boundaries.

## Sharing projects and reports

Projects can retain model names, conversation and editing history. Review that metadata before sharing. Do not include API keys, MCP tokens, private photos, or local credential files in issues and pull requests.

Release binaries are currently unsigned. Compare release checksums with the published checksum file.

## Reporting a vulnerability

Use the repository's private GitHub security reporting option if available. Include the affected version, reproduction steps, impact, and a minimal sample without credentials or private media. If private reporting has not been enabled, open an issue requesting a private contact channel without publishing exploit details or secrets.

Security documentation describes implemented boundaries; it does not claim a complete security audit.
