# Changelog

All notable changes to this project are documented in this file.

## [Production] 2026-07-29 — AI Pins resilient text-generation fallback

**Status:** Production Completed  
**Commit:** `10160f75503eb749acb3c4e803013d75f215eccb`

- Added resilient text-generation fallback for AI Pins.
- AI-first workflow preserved.
- Temporary provider failures now fall back to local article-based pin copy.
- Existing AI image fallback remains unchanged.
- Permanent provider/configuration errors still stop the workflow.
- Writer, Images, and other AI modules were not affected.
- No database migrations required.
- Released in commit: `10160f75503eb749acb3c4e803013d75f215eccb`
