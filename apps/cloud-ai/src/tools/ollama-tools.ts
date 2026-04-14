// Re-export Ollama tools from the device module (local tool wrappers via bridge)
export {
  ollama_status,
  ollama_agent,
  ollama_chat,
  ollama_generate,
  ollama_vision,
  ollama_embeddings,
  ollama_models,
} from './device/ollama';

