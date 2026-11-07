# Translate known changed-field names in rebuild review

Owner choice relayed by Coordinator27: “Yes; fix the 2 names next (Recommended).” The current Settings/wizard/native preview approval covers #3558 only; this follow-up requires its own opened light/dark comparison and explicit publication approval.

Display Summary, Availability and exact known sibling section names from docs/notion-profile-template.md and the fictional demo in en/de/fr/it/es/ro/ru. Use an exact allowlist only inside the existing private rebuild projection. Preserve canonical documents, change strings/group IDs/order, actions, costs and unknown/raw headings. No shared runtime, renderer, parsing, storage, model, account or live-state changes.

Tier 1: named rebuild/copy unit tests and the existing fictional review preview in light/dark. No new states or suites. Separate PR through exact-head READY; owner merges.

## Progress

### 1. Implement and verify display-only names

- [x] Add regression proving known names translate while canonical strings and unknown headings remain exact. (proof: desktop/test/unit/main/rebuild-field-names.test.js)
- [x] Implement the bounded known-name projection and all seven catalogs; pass targeted tests. (proof: desktop/test/unit/main/rebuild-field-names.test.js)

### 2. Obtain separate preview approval

- [ ] Open existing review light/dark comparisons and obtain owner publication approval.

### 3. Ship and supervise

- [ ] Publish separate PR and resolve checks/review through exact-head READY.
