import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export namespace LocalProvider {
  export interface Config {
    baseURL: string
    apiKey: string
    model: string
  }

  export const DEFAULT_CONFIG: Config = {
    baseURL: "http://192.168.1.175:1234/v1",
    apiKey: "lm-studio",
    model: "local-model",
  }

  export function create(config: Config = DEFAULT_CONFIG) {
    const provider = createOpenAICompatible({
      name: "local-llm",
      baseURL: config.baseURL,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    })

    return provider.languageModel(config.model)
  }
}
