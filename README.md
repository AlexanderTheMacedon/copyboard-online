# CopyBoard Online

Local-first clipboard and file workspace for the browser.

## Structure

- index.html — application shell
- src/styles/app.css — application styles
- src/js/app.js — main application logic
- src/js/config/constants.js — configuration and limits
- src/js/utils/format.js — formatting helpers
- src/js/utils/files.js — file helpers
- src/js/ui/toast.js — toast UI

CopyBoard uses native ES modules and requires no build step.

## Local development

    python3 -m http.server 8000

Open http://localhost:8000

The remaining large feature domains in app.js are intentionally kept together until they can be extracted with explicit interfaces without changing runtime behavior.
