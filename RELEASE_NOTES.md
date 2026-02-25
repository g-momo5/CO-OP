# Release Notes

## v1.0.12
- Sales summary moved to its own screen with action card from home.
- Added month/year range filters (dropdowns) defaulting to current year; includes both fuel and oil products.
- Pivoted summary table: products as rows, months as columns, totals per product, horizontal scroll when wide.
- Click a month to expand daily quantities for that month; detail table scrolls horizontally.
- Showing products even when sales are zero to keep the grid consistent.

Next steps to publish:
1) Commit and push: `git commit -am "chore: release v1.0.12" && git push origin main`.
2) Tag and push tag: `git tag v1.0.12 && git push origin v1.0.12`.
3) GitHub Actions release workflow will build and publish artifacts.
