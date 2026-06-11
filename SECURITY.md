# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ |

## Reporting a Vulnerability

Please report security issues to security@agentai-platform.com.
Do not open public issues for security vulnerabilities.

## Security Features

- **AES-256-GCM encryption**: All API keys stored encrypted (config.json)
- **Path traversal sandbox**: safeResolve() prevents directory traversal
- **CORS whitelist**: Configurable allowed origins
- **Prompt injection scanning**: 20+ Chinese/English regex patterns
- **Circuit breaker**: 30% failure rate auto-fuse
- **Cost guard**: Daily spending cap ($5 default)
- **Zero telemetry**: No data leaves the device
