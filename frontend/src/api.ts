/**
 * API Configuration and Utilities
 * 
 * This module provides API configuration and utility functions for communicating
 * with the backend server. It includes model fetching capabilities and fallback
 * configurations for offline scenarios.
 * 
 * @author Research Team
 */

/**
 * Base URL for API requests
 * Uses environment variable if available, otherwise defaults to current origin
 */
export const API_BASE =
  process.env.REACT_APP_API_BASE_URL || window.location.origin;

/**
 * Interface representing a model provider with its available models
 */
export interface ModelProvider {
  /** Name of the model provider (e.g., "OpenAI", "Anthropic") */
  provider: string;
  /** Array of model names available from this provider */
  models: string[];
}

/**
 * Fetch available models from the backend API
 * 
 * Retrieves the list of available language models from the backend server.
 * If the API call fails, returns a fallback list of commonly available models.
 * 
 * @returns Promise that resolves to an array of ModelProvider objects
 * @throws Error if the API request fails and no fallback is available
 */
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
    // This ensures the application remains functional even when the backend is unavailable
    return [
      {
        provider: "OpenAI",
        models: ["openai-gpt-5", "openai-gpt-5-mini", "openai-gpt-5-nano", "openai-gpt-4o", "openai-gpt-4.1", "openai-o3", "openai-o4-mini"]
      },
      {
        provider: "Salesforce", 
        models: ["anthropic-claude-3.7-sonnet", "deepseek-r1", "my-finetuned"]
      }
    ];
  }
};