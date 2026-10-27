# End User Licence Agreement (EULA) — [Platform Name]

> **Draft for the hackathon build. This is not legal advice and it is not a substitute for a lawyer.**
> Review it with a lawyer before any commercial launch, paid use, or use with real customer data.
> For the hackathon demo, it is written to be honest about the Muse-only model split, data handling, and limits — which is exactly what judges and reviewers need to see.

**Effective date:** 27 October 2026
**Provider:** [Your name / team name] ("Provider", "we", "us")
**Platform:** [Platform Name] ("Platform")
**User:** the person or team using the Platform ("you")

By using the Platform, you agree to this EULA. If you do not agree, do not use the Platform.

## 1. Licence

We grant you a non-exclusive, non-transferable, revocable licence to use the Platform for its intended purpose, as described in DOCUMENTATION.md, during the hackathon and, if we continue the Platform after it, under the terms in force at that time.

You may not:
- Copy, resell, sublicense, or redistribute the Platform as your own product without our written permission.
- Remove copyright, licence, or model-attribution notices.
- Reverse-engineer the Platform to extract API keys, private capsules, or another user's data.
- Use the Platform to break the law, to harass, defame, or deceive, to create malware, or to generate content you do not have the right to create.

We may suspend or terminate access if you breach this EULA, if your use creates a security risk, or if a third-party service we depend on (including Meta Model API) suspends our account.

## 2. Ownership

- The Platform's code, documentation, knowledge-capsule structure, and branding are owned by the Provider, except for third-party components used under their own licences.
- Your content — inputs you provide, capsules you create, and outputs generated for you — remains yours, subject to Section 3 (how it is processed by Meta) and Section 8 (hackathon disclosure).
- You warrant that content you upload is yours, or that you have permission to use it, and that it does not infringe anyone else's rights. Do not upload code, images, or data you do not own or have a licence for.

## 3. How your data is processed — the model split (read this section)

This Platform uses **only Muse models on the Meta Model API**. No other AI provider processes your requests.

### 3.1 Contributor tier — public / demo data only

- Model: `muse-spark-1.3-contributor`
- Meta may use prompts and completions sent to this tier to improve its products, including training future models.
- We send data to this tier **only** when it is classified as public or demo data, or when you have explicitly consented to training use for that exact data.
- We will never send private, proprietary, personal, or NDA-covered data to this tier.

### 3.2 Standard tier — private data

- Model: `muse-spark-1.3`
- Standard is labelled by Meta as "not used to improve our products." It is not used for training.
- We send private data only to this tier.
- "Not used for training" does not mean "not retained, logged, or reviewed at all." Meta's own terms govern retention, logging, and abuse monitoring, and you should review those terms before sending highly sensitive material through either tier.

### 3.3 Other Muse models

- `muse-image-1.0` — image generation / editing, on demand only.
- `sam-3.1` — segmentation, on demand only.
- `muse-voice-transcribe-1.0` — transcription, on demand only.
- No Muse Wonder model is used by default. If it is ever used for a single task, we will label that task and its cost in advance.

### 3.4 Your choices

- You can ask us which model was used for a request. The Platform logs the model ID for each request.
- You can ask us to delete your private capsules. We will delete them from the Platform, subject to legal retention duties and to copies already processed by Meta under its own terms (which we cannot retract).
- If you are unsure whether data is private, treat it as private and tell us. We will route it to Standard.

### 3.5 What we do not do

- We do not sell your personal data.
- We do not send your data to any non-Muse AI provider.
- We do not store API keys in the public repo, in browser code, or in demo videos.
- We do not promise that model output is accurate, complete, or fit for a particular purpose. Verify important outputs before acting on them, especially before any irreversible action.

## 4. Knowledge capsules

Capsules are classified at creation as `public`, `internal`, `private`, or `secret`:

- `secret` capsules (credentials, keys, personal identifiers) are never sent to any model. If you enter a secret into a capsule, redact it immediately and rotate the secret.
- `private` capsules are routed to Standard only.
- `public` / `internal` capsules may be routed to Contributor, as described in Section 3.1.

You are responsible for classifying capsules you create correctly. If you misclassify private data as public, the Platform cannot undo a training disclosure that has already happened.

## 5. Acceptable use and safety

You must not use the Platform to:
- Generate or distribute illegal, hateful, harassing, or deceptive content.
- Attempt to extract another user's data, API keys, or private capsules.
- Bypass rate limits, cost controls, or security checks.
- Present model output as human work, verified fact, or legal / medical / financial advice without independent verification.
- Use the Platform for safety-critical decisions (medical treatment, legal action, financial trading, control of physical systems) without a qualified human in the loop.

We may filter, refuse, or log requests that appear to violate this section or Meta's terms.

## 6. Third-party terms

Your use of the Platform is also subject to Meta's Meta Model API terms and the Meta Global AI Developer Hackathon Official Rules, where applicable. If those terms conflict with this EULA on data processing by Meta, Meta's terms govern Meta's processing, and this EULA governs our Platform.

Meta Model API pricing, rate limits, and data terms change from time to time. The prices and limits in MODEL-SPLIT.md were current at the time of writing (27 October 2026) and must be re-checked against Meta's pricing page before commercial use.

## 7. Availability, cost, and no warranty

- The Platform is provided "as is" and "as available", without warranties of any kind, including merchantability, fitness for a particular purpose, or non-infringement.
- During the hackathon, the Platform runs on a limited API budget ($150 in hackathon credits, plus interim card spend). If that budget is exhausted, the Platform may stop, slow down, or switch bulk work to cheaper, cached paths. We will show budget status where practicable.
- We do not guarantee uptime, accuracy, or that the Platform will meet your requirements. Model output can be wrong, incomplete, or out of date. You are responsible for checking it before you rely on it.

## 8. Hackathon disclosure

If you use the Platform as part of the Meta Global AI Developer Hackathon 2026:

- Submissions shared during the event are not treated as confidential by the organisers.
- Organisers receive a broad licence to use, publish, and modify submitted material, as set out in the Official Rules. Do not submit material through the Platform that you cannot share on those terms.
- Winners' names and likenesses may be used in publicity, as set out in the Official Rules.
- This EULA does not override the Official Rules. If there is a conflict on hackathon submissions, the Official Rules govern the submission.

## 9. Liability

To the maximum extent permitted by law:
- Our total liability for any claim arising from the Platform is limited to the amount you paid us for the Platform in the 12 months before the claim, or $100 if you paid nothing.
- We are not liable for indirect, incidental, consequential, or punitive damages, loss of profits, loss of data, or loss of business opportunity.
- Nothing in this EULA limits liability that cannot be limited by law, including for fraud or wilful misconduct.

You agree to indemnify us against claims arising from your content, your misclassification of capsules, or your breach of this EULA, except where the claim arises from our own breach.

## 10. Termination

You may stop using the Platform at any time. We may suspend or terminate your access immediately if you breach this EULA, if your use creates a security or legal risk, or if we discontinue the Platform. On termination, your licence ends, and we will delete your private capsules on request, subject to Section 3.4 and to legal retention duties.

## 11. Changes

We may update this EULA. Material changes will be noted with a new effective date in this document. Continued use after a change means you accept the updated EULA. If you do not accept a change, stop using the Platform.

## 12. Governing law and contact

- Governing law: [State / Country — fill in before commercial use]
- Contact for EULA, privacy, or deletion requests: [Email — fill in before submission if you want judges to be able to reach you]

---

**User acknowledgement (for the demo / repo):**

By using [Platform Name], you acknowledge that:
1. You have read Section 3 and understand the Contributor vs Standard split.
2. You will not send private data to Contributor, and you will classify capsules correctly.
3. You understand that hackathon submissions are not confidential under the Official Rules.
