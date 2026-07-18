# Security policy

This repository is a trust root for four business systems.

- Never commit credentials, production URLs, private keys, raw customer PII, or unredacted traces.
- Governance code, schemas, policies, reporters, workflows, and spine maps require CODEOWNER review.
- Reusable workflow callers must pin a full commit SHA and pass only named, least-privilege secrets.
- Candidate PR code must never run in a privileged `pull_request_target` job.
- Evidence artifacts have a default retention of 14 days and must be redacted before upload.
- A suspected false PASS, evidence forgery, or production-write attempt is a release-blocking incident.

Report security issues privately to the repository owner. Do not open a public issue containing
credentials, production data, or exploit details.
