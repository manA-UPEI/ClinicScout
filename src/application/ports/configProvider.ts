/** Single point of truth for environment-derived configuration. */
export interface ConfigProvider {
  geminiApiKey(): string | null;
  /** Resolved with the pinned default already applied. */
  geminiModel(): string;
  isGeminiConfigured(): boolean;
}
