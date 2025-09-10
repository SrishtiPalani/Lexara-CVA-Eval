export const models = [
   { value: "openai-gpt-5",           label: "OpenAI: GPT-5" },
   { value: "openai-gpt-5-mini",      label: "OpenAI: GPT-5 Mini" },
   { value: "openai-gpt-5-nano",      label: "OpenAI: GPT-5 Nano" },
   { value: "openai-gpt-4.1",         label: "OpenAI: GPT-4.1" },
   { value: "openai-gpt-4o",          label: "OpenAI: GPT-4o" },
   { value: "openai-o3",              label: "OpenAI: o3" },
   { value: "openai-o4-mini",         label: "OpenAI: o4-mini" },
   { value: "deepseek-r1",            label: "DeepSeek: R1"},
   { value: "anthropic-claude-3.7-sonnet", label: "Anthropic: Claude 3.7 Sonnet" }, 
   { value: "anthropic-claude-opus-4",     label: "Anthropic: Claude Opus 4" }, 
   // Salesforce EinsteinTableauGPT via LLM Gateway
   { value: "SFR-Tableau-Finetuned", label: "SFR-Tableau-Finetuned" }
];

// strongest to weakest models for judge suggestion
export const modelFamily: Record<string,string> = {
  "openai-gpt-5"                : "openai",
  "openai-gpt-5-mini"           : "openai",
  "openai-gpt-5-nano"           : "openai",
  "openai-gpt-4o"               : "openai",
  "openai-gpt-4.1"              : "openai",
  "openai-o3"                   : "openai",
  "openai-o4-mini"              : "openai",
  "anthropic-claude-3.7-sonnet" : "anthropic",
  "anthropic-claude-opus-4"     : "anthropic",
  "deepseek-r1"                 : "deepseek",
  "SFR-Tableau-Finetuned"       : "salesforce",
};

export const judgeStrengthOrder: readonly string[] = [
  "anthropic-claude-opus-4",
  "openai-gpt-5",
  "openai-gpt-5-mini",
  "anthropic-claude-3.7-sonnet",
  "openai-gpt-4.1",
  "openai-gpt-4o",
  "openai-o3",
  "openai-o4-mini",
  "deepseek-r1",
];

export const modelNameMap: Record<string, string> =
  Object.fromEntries(models.map(({ value, label }) => [value, label]));
  
  // Mapping of test case file names to titles and difficulty levels using MAPPINGS
export const testCaseMapping: Record<string, {
  title: string;
  difficulty: string;
  domain: string;
  datasource: string;
}> = {
  "demo_tests-tc.v2.yaml":  { title: "Tableau Conference Registrations", difficulty: "Easy", domain: "Customer Support", datasource: "demo_tests-ds.v2.yaml" },
  "superstore-testcases.yaml":  { title: "Superstore", difficulty: "Easy", domain: "Retail", datasource: "superstore-datasource.yaml" }
};
  
  
  