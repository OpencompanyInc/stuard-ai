import { buildProviderModel } from '../../utils/models';
import { getDefaultModelForCategory } from '../../pricing';
import type { ModelChoice } from '../../router/model-router';

export function getModel(model: ModelChoice, modelId?: string) {
  const trimmedId = typeof modelId === 'string' ? modelId.trim() : '';
  const override = trimmedId ? buildProviderModel(trimmedId) : null;
  if (override) return override;

  const defaultId = getDefaultModelForCategory(model as any);
  const selected = buildProviderModel(defaultId);
  if (selected) return selected;

  // Final defense: pick something we know is always wired up. Avoid OpenAI
  // here so a depleted OpenAI quota can't take down a whole tier.
  if (model === 'fast') {
    return buildProviderModel('google/gemini-3.1-flash-lite-preview');
  }
  if (model === 'balanced') {
    return (
      buildProviderModel('xai/grok-4-1-fast') ||
      buildProviderModel('google/gemini-3.1-flash-lite-preview')
    );
  }
  if (model === 'research') {
    return (
      buildProviderModel('perplexity/sonar-pro') ||
      buildProviderModel('google/gemini-3.1-pro-preview')
    );
  }
  return (
    buildProviderModel('google/gemini-3.1-pro-preview') ||
    buildProviderModel('google/gemini-3.1-flash-lite-preview')
  );
}

export function getAgentName(model: ModelChoice): string {
  return model === 'smart' ? 'cloud-ai-deep' : 'cloud-ai-balanced';
}

export function getEffort(model: ModelChoice, effort?: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  return effort || (model === 'smart' ? 'high' : 'medium');
}

