# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Welcome page with 6 core competitive advantages display
- Web search tools: `web_search` + `web_fetch`
- Cross-conversation memory: auto-summarize & carry context
- AI super-awareness: auto-discover & create skills
- AES-256-GCM encrypted config storage
- Gateway auto-start with Vite dev server
- 12 built-in tools (image/video/search/skill creation)
- Chinese zodiac Dragon SVG icon & desktop icons
- VSCode extension with SSE streaming
- QQ Bot with official SDK support
- Onboarding 5-step wizard
- Plan request form

### Fixed
- Input lag: input state isolated with useMemo
- AI reply hidden by tool summaries
- Duplicate command execution with sendingRef lock
- Path traversal vulnerability with safeResolve sandbox
- CSS dark theme for antd Modal/Message/Dropdown
- CORS blocked for 127.0.0.1
- Gateway spawn ENOENT on Windows
