# Test layout

This folder separates automated tests from manual smoke scripts.

- `accounting/`: automated `node:test` coverage for accounting calculations.
- `land/`: automated `node:test` coverage for land domain and service logic.
- `shifts/`: automated `node:test` coverage for shift correction cascade logic.
- `smoke/`: manual Electron/process smoke scripts. These are intentionally not included in `npm test`.

Run the automated suite with:

```sh
npm test
```
