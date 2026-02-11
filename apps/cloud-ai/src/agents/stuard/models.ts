import { buildProviderModel } from '../../utils/models';
import { getDefaultModelForCategory } from '../../pricing';
import type { ModelChoice } from '../../router/model-router';

export function getModel(model: ModelChoice, modelId?: string) {
  let selectedModel: any;
  const override = typeof modelId === 'string' && modelId.trim() ? buildProviderModel(modelId) : null;
  
  if (override) {
    selectedModel = override;
  } else {
    // Use the new pricing system to get the default model for the category
    const defaultId = getDefaultModelForCategory(model as any);
    selectedModel = buildProviderModel(defaultId);
    
    // Fallback if buildProviderModel failed for some reason
    if (!selectedModel) {
      if (model === 'fast') {
        selectedModel = buildProviderModel('deepseek/deepseek-chat');
      } else if (model === 'balanced') {
        selectedModel = buildProviderModel('xai/grok-4-1-fast');
      } else {
        selectedModel = buildProviderModel('google/gemini-2.5-pro');
      }
    }
  }
  
  return selectedModel;
}

export function getAgentName(model: ModelChoice): string {
  return model === 'smart' ? 'cloud-ai-deep' : 'cloud-ai-balanced';
}

export function getEffort(model: ModelChoice, effort?: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  return effort || (model === 'smart' ? 'high' : 'medium');
}

