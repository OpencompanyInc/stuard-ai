-- Per-VM unique secret: eliminates shared global VM_TOKEN_SECRET
-- Each VM gets its own cryptographically random HMAC secret at provisioning.
-- If one VM is compromised, only that VM's secret is leaked — not all VMs.

ALTER TABLE public.cloud_engines
  ADD COLUMN IF NOT EXISTS vm_secret TEXT;

-- vm_secret is sensitive — only readable by service_role (never exposed to user JWTs)
COMMENT ON COLUMN public.cloud_engines.vm_secret IS
  'Per-VM HMAC signing key (hex, 64 chars). Generated at provision time. Never exposed to end users.';
