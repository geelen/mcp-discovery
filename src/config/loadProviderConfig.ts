import { readFile } from "fs/promises";
import type { ProvidersFile, ProviderConfig } from "../types/index.js";

export async function loadProvidersFile(path: string): Promise<ProvidersFile> {
  const fileContent = await readFile(path, "utf-8");
  return JSON.parse(fileContent);
}

export function getProviderConfig(providers: ProvidersFile, providerKey: string): ProviderConfig {
  const config = providers[providerKey];
  if (!config) {
    throw new Error(`Provider '${providerKey}' not found in providers.json`);
  }
  return config;
}

export function getApiKey(providerConfig: ProviderConfig): string {
  const apiKey = process.env[providerConfig.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Environment variable ${providerConfig.apiKeyEnv} is not set`);
  }
  return apiKey;
}
