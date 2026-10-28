import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { normalizeBaseURL } from "../shared/profile-schema.js";
import type { ModelConnection } from "../shared/profiles.js";

/** Direct provider only: no Gateway, redirects, profile switching or hidden fallback. */
export function createProfileModel(
  profile: ModelConnection,
  fetchImpl: typeof fetch = fetch,
) {
  const baseURL = normalizeBaseURL(profile.baseURL);
  const origin = new URL(baseURL).origin;
  const guardedFetch: typeof fetch = async (input, options) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.origin !== origin || !url.href.startsWith(`${baseURL}/`))
      throw new Error("Unexpected provider URL");
    return fetchImpl(input, { ...options, redirect: "error" });
  };
  // https://ai-sdk.dev/providers/openai-compatible-providers/custom-providers
  return createOpenAICompatible({
    name: profile.id,
    baseURL,
    apiKey: profile.apiKey,
    fetch: guardedFetch,
  }).chatModel(profile.modelId);
}
