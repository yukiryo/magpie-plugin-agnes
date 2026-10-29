# Agnes provider 0.2.0

## Design

Keep this repository as the single maintained distribution. Preserve the
`opencode-agnes-auth` package name, `agnes` provider id, repository-hosted icon,
MIT notices, API-key sign-in, and the billing endpoint used to validate keys.

Merge the locally verified native media adapter and current model metadata.
The package remains dependency-free ESM. Images use the documented nested
`extra_body` fields; image picker aliases map back to real Agnes API ids.
Videos use the real `video_id` and model inside restart-safe task ids and
require Magpie 0.1.2077 or later. Download requests carry no provider key.
Thinking is an on/off switch. The public model list is not proof that a key
is valid and must not be used as the usage hook's key check.

Do not advertise balances, promotional prices, live account generation, or
unsupported video uploads as verified. Keep old user account files outside
the implementation and all validation.

## Implementation plan

- [x] Add regression tests for current metadata, native image aliases, streams,
  thinking, expired keys, and a public catalog that accepts an invalid key.
- [x] Merge the provider and tested media adapter; preserve billing key checks.
- [x] Preserve package identity, bump to 0.2.0, and include the new runtime file.
- [x] Update Chinese installation and usage instructions, changelog, and agent
  maintenance guidance; add Windows/Linux checks on Node 22 and 24.
- [x] Verify the full suite, upstream plugin shape checker, exact npm package,
  and isolated Magpie loading; obtain independent code review.
- [ ] Push an integration branch, run GitHub checks, and merge into main.

## Review focus

- A public `/models` result must never make a rejected key look valid.
- Magpie's multipart image model aliases must become real upstream ids.
- File downloads must not inherit authorization, cookies, or redirects.
- Video task ids must work after restart without relying on an in-memory map.
- CI and docs must work without dependencies, credentials, or paid generation.

## Progress

Baseline: clean repository at b5aac47 on the isolated local clone. Existing
19 tests passed in the comparison review. Implementation branch:
`maintain/agnes-0.2.0`. No edits to running Magpie account configuration.

Local verification: 92 tests passed, hook checks passed, package contains both
runtime modules and the existing icon. The Windows installer loaded 8 models
in isolated Magpie 0.1.2075 configuration, including correct image API ids.
No real account or paid generation was used. Independent review found no
reproduced material defects. The community's upstream hook checker passed.
Remote CI precedes merging into main.
