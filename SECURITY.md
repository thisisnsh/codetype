# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainers directly at [security@example.com]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 1 week
- **Resolution**: Depends on complexity, typically 2-4 weeks

### Scope

Security concerns include:
- Data leakage (usernames, stats, room codes)
- WebSocket vulnerabilities
- Code injection in WebView
- Extension permission escalation
- Cloudflare Worker vulnerabilities

### Out of Scope

- Denial of service attacks
- Social engineering
- Issues in dependencies (report to respective projects)

## Security Best Practices

When using CodeType:

1. **Multiplayer**: Room codes are temporary and expire after 2 hours
2. **Usernames**: Don't use personally identifiable information
3. **Workspace Code**: The extension only reads code, never modifies it
4. **Network**: All communication uses HTTPS/WSS

## Acknowledgments

We thank security researchers who help keep CodeType safe. Responsible disclosure will be acknowledged in our changelog (with permission).
