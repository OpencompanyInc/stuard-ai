# Stuard Workflow Marketplace

Features
- Listings: title, tagline, long description, categories, tags, version, changelog
- Pricing: free, one-time, subscription, usage-based
- Trials & refunds
- Ratings & reviews with verified usage
- Trust: code signing, security scan results, permissions requested, spend caps
- Revenue split & payouts
- TOS, licenses (MIT, Apache-2.0, CC, Custom)

APIs
- POST /workflows (publish draft)
- POST /workflows/{id}/release (sign & release)
- GET /workflows (search/filter)
- GET /workflows/{id}
- POST /purchases
- GET /users/{id}/library
- POST /reviews
- GET /security/report/{workflowId}

Governance
- Submission guidelines, prohibited content, data-handling rules
- Security review tiers: automated scan -> curated review -> enterprise cert
- Dispute and takedown process
