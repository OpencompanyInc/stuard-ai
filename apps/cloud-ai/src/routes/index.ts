import type { IncomingMessage, ServerResponse } from 'http';
import { handleWebhooks } from './webhooks';
import { handleHealth } from './health';
import { handleCredits } from './credits';
import { handleOAuthClaimRoute } from './integrations/oauth-claim';
import { handleGithubRoutes } from './integrations/github';
import { handleGoogleRoutes } from './integrations/google';
import { handleOutlookRoutes } from './integrations/outlook';
import { handleDiscordRoutes } from './integrations/discord';
import { handleRedditRoutes } from './integrations/reddit';
import { handleXRoutes } from './integrations/x';
import { handleTelnyxRoutes } from './integrations/telnyx';
import { handleMetaRoutes } from './integrations/meta';
import { handleWhatsAppRoutes } from './integrations/whatsapp';
import {
  DISCORD_INTEGRATION_ENABLED,
  META_INTEGRATION_ENABLED,
  OUTLOOK_INTEGRATION_ENABLED,
  REDDIT_INTEGRATION_ENABLED,
  WHATSAPP_INTEGRATION_ENABLED,
} from '../../../../shared/integration-flags';
import { handleProfileRoutes } from './integrations/profiles';
import { handleCalendarRoutes } from './calendar';
import { handleInferenceRoutes } from './inference';
import { handleBetaRoutes } from './beta';
import { handleOpsRoutes } from './ops';
import { handleMarketplaceRoutes } from './marketplace';
import { handleToolsRoutes } from './tools';
import { handleKnowledgeRoutes } from './knowledge';
import { handleMemoryRoutes } from './memory-routes';
import { handleModelsRoutes } from './models';
import { handleSharedSpacesRoutes } from './shared-spaces';
import { handleMCPRoutes } from './mcp';
import { handleFileIndexRoutes } from './file-index';
import { handlePreferencesRoutes } from './preferences';
import { handleCloudEngineRoutes } from './cloud-engine';
import { handleCloudStorageRoutes } from './cloud-storage';
import { handleStorageRoutes } from './storage';
import { handleCloudFilesRoutes } from './cloud-files';
import { handleCloudPreviewRoutes, handleCloudPreviewFallback } from './cloud-preview';
import { handleCloudMonitoringRoutes } from './cloud-monitoring';
import { handleCloudSnapshotsRoutes } from './cloud-snapshots';
import { handleCloudDeploysRoutes } from './cloud-deploys';
import { handleCloudAdminRoutes } from './cloud-admin';
import { handleVMRelayRoutes } from './vm-relay';
import { handleVMAgentRoutes } from './vm-agent-routes';
import { handleDesktopToolRelayRoutes } from './desktop-tool-relay';
import { handleProactiveRoutes } from './proactive';
import { handleServerlessChatRoutes } from './serverless-chat';
import { handleBillingRoutes } from './billing';
import { handleAccountRoutes } from './account';
import { handlePolarWebhook } from './polar-webhook';
import { handleByokRoutes } from './byok';
import { handleIntegrationsDraftRoutes } from './integrations-draft';
import { handleIntegrationsAssistRoutes } from './integrations-assist';
import { handleIntegrationsInstalledRoutes } from './integrations-installed';

export async function handleHttpRoutes(req: IncomingMessage, res: ServerResponse, parsedUrl: URL): Promise<boolean> {
  if (await handlePolarWebhook(req, res, parsedUrl)) return true;
  if (await handleWebhooks(req, res, parsedUrl)) return true;
  if (handleHealth(req, res, parsedUrl)) return true;
  if (await handleModelsRoutes(req, res, parsedUrl)) return true;
  if (await handleCredits(req, res, parsedUrl)) return true;
  if (await handleBillingRoutes(req, res, parsedUrl)) return true;
  if (await handleAccountRoutes(req, res, parsedUrl)) return true;
  if (await handleBetaRoutes(req, res, parsedUrl)) return true;
  if (await handleOpsRoutes(req, res, parsedUrl)) return true;
  if (await handleOAuthClaimRoute(req, res, parsedUrl)) return true;
  if (await handleGithubRoutes(req, res, parsedUrl)) return true;
  if (await handleGoogleRoutes(req, res, parsedUrl)) return true;
  if (OUTLOOK_INTEGRATION_ENABLED && await handleOutlookRoutes(req, res, parsedUrl)) return true;
  if (DISCORD_INTEGRATION_ENABLED && await handleDiscordRoutes(req, res, parsedUrl)) return true;
  if (REDDIT_INTEGRATION_ENABLED && await handleRedditRoutes(req, res, parsedUrl)) return true;
  if (await handleXRoutes(req, res, parsedUrl)) return true;
  if (await handleTelnyxRoutes(req, res, parsedUrl)) return true;
  if (META_INTEGRATION_ENABLED && await handleMetaRoutes(req, res, parsedUrl)) return true;
  if (WHATSAPP_INTEGRATION_ENABLED && await handleWhatsAppRoutes(req, res, parsedUrl)) return true;
  if (await handleProfileRoutes(req, res, parsedUrl)) return true;
  if (await handleCalendarRoutes(req, res, parsedUrl)) return true;
  if (await handleInferenceRoutes(req, res, parsedUrl)) return true;
  if (await handleMarketplaceRoutes(req, res, parsedUrl)) return true;
  if (await handleToolsRoutes(req, res, parsedUrl)) return true;
  if (await handleKnowledgeRoutes(req, res, parsedUrl)) return true;
  if (await handleMemoryRoutes(req, res, parsedUrl)) return true;
  if (await handleSharedSpacesRoutes(req, res, parsedUrl)) return true;
  if (await handleMCPRoutes(req, res, parsedUrl)) return true;
  if (await handleFileIndexRoutes(req, res, parsedUrl)) return true;
  if (await handlePreferencesRoutes(req, res, parsedUrl)) return true;
  if (await handleByokRoutes(req, res, parsedUrl)) return true;
  if (await handleIntegrationsDraftRoutes(req, res, parsedUrl)) return true;
  if (await handleIntegrationsAssistRoutes(req, res, parsedUrl)) return true;
  if (await handleIntegrationsInstalledRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudEngineRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudStorageRoutes(req, res, parsedUrl)) return true;
  if (await handleStorageRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudFilesRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudPreviewRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudMonitoringRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudSnapshotsRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudDeploysRoutes(req, res, parsedUrl)) return true;
  if (await handleCloudAdminRoutes(req, res, parsedUrl)) return true;
  if (await handleVMRelayRoutes(req, res, parsedUrl)) return true;
  if (await handleVMAgentRoutes(req, res, parsedUrl)) return true;
  if (await handleDesktopToolRelayRoutes(req, res, parsedUrl)) return true;
  if (await handleProactiveRoutes(req, res, parsedUrl)) return true;
  if (await handleServerlessChatRoutes(req, res, parsedUrl)) return true;
  // Last-resort: route /<absolute-path> requests from preview iframes (via
  // Referer or per-port cookie) to the active dev server. Must stay last so
  // it never shadows a real cloud-ai route.
  if (await handleCloudPreviewFallback(req, res, parsedUrl)) return true;
  return false;
}
