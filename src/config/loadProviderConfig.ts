import { readFile } from "fs/promises";
import type { ProvidersFile, ProviderConfig } from "../types/index.js";

export async function loadProvidersFile(path: string): Promise<ProvidersFile> {
  const fileContent = await readFile(path, "utf-8");
  return JSON.parse(fileContent);
}

export function getProviderConfig(providers: ProvidersFile, providerKey: string): ProviderConfig {
  const config = providers[providerKey];
  if (!config) {
    const availableProviders = Object.keys(providers).join(", ");
    throw new Error(
      `Provider '${providerKey}' not found in providers.json\n` +
      `       Available providers: ${availableProviders}`
    );
  }
  return config;
}

export function getApiKey(providerConfig: ProviderConfig): string {
  const apiKey = process.env[providerConfig.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Environment variable ${providerConfig.apiKeyEnv} is not set\n` +
      `       Please set it with: export ${providerConfig.apiKeyEnv}=your_api_key`
    );
  }
  return apiKey;
}
