export const API_BASE =
  process.env.REACT_APP_API_BASE_URL || window.location.origin;

export interface ModelProvider {
  provider: string;
  models: string[];
}

export const fetchModels = async (): Promise<ModelProvider[]> => {
  try {
    const response = await fetch(`${API_BASE}/get-models`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch models:', error);
    // Return fallback models if API fails
    return [
      {
        provider: "OpenAI",
        models: ["openai-gpt-5", "openai-gpt-5-mini", "openai-gpt-5-nano", "openai-gpt-4o", "openai-gpt-4.1", "openai-o3", "openai-o4-mini"]
      },
      {
        provider: "Salesforce", 
        models: ["anthropic-claude-3.7-sonnet", "deepseek-r1", "SFR-Tableau-Finetuned"]
      }
    ];
  }
};