import assert from "node:assert/strict";
import test from "node:test";
import {
  createTranslationGenerator,
  translationErrorDetails,
  translateChatBatch,
  type TranslationGenerator,
} from "./messageTranslation.ts";

test("detects source language, preserves same-language messages, and bounds request batches", async () => {
  const requestSizes: number[] = [];
  const generateContent: TranslationGenerator = async (request) => {
    const input = JSON.parse(request.contents[0]?.parts[0]?.text ?? "[]") as Array<{
      index: number;
      text: string;
    }>;
    requestSizes.push(input.length);
    const output = input.map(({ index, text }) => ({
      index,
      sourceLanguage: text === "already english" ? "en" : "ar",
      translatedText: text === "already english" ? null : `translated:${text}`,
    }));
    return { text: JSON.stringify(output) };
  };

  const results = await translateChatBatch(
    Array.from({ length: 13 }, (_, index) => ({
      content: index === 0 ? "already english" : `message-${index}`,
      sourceLanguageHint: "vi" as const,
    })),
    "en",
    generateContent,
  );
  assert.deepEqual(requestSizes, [12, 1]);
  assert.equal(results.get(0)?.sourceLanguage, "en");
  assert.equal(results.get(0)?.translatedText, null);
  assert.equal(results.get(12)?.sourceLanguage, "ar");
  assert.equal(results.get(12)?.translatedText, "translated:message-12");
});

test("translation reads GEMINI_API_KEY and uses the Gemini SDK", async () => {
  let configuredApiKey = "";
  let configuredTimeout = 0;
  const generateContent = createTranslationGenerator(
    { GEMINI_API_KEY: " direct-test-key " },
    (config) => {
      configuredApiKey = config.apiKey;
      configuredTimeout = config.httpOptions.timeout;
      return {
        models: {
          generateContent: async (request) => {
            const input = JSON.parse(request.contents[0]?.parts[0]?.text ?? "[]") as Array<{
              index: number;
            }>;
            return {
              text: JSON.stringify(input.map(({ index }) => ({
                index,
                sourceLanguage: "en",
                translatedText: "translated",
              }))),
            };
          },
        },
      };
    },
  );

  const results = await translateChatBatch([{ content: "hello" }], "ar", generateContent);
  assert.equal(configuredApiKey, "direct-test-key");
  assert.equal(configuredTimeout, 12_000);
  assert.equal(results.get(0)?.translatedText, "translated");
});

test("translation fails explicitly when GEMINI_API_KEY is absent", async () => {
  const previous = {
    AI_INTEGRATIONS_GEMINI_BASE_URL: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    AI_INTEGRATIONS_GEMINI_API_KEY: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  try {
    delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      translateChatBatch([{ content: "مرحبا" }], "en"),
      /Gemini translation is not configured/,
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("retries a transient Gemini error and returns its translation", async () => {
  let attempts = 0;
  const generateContent: TranslationGenerator = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("synthetic transient failure");
    return {
      text: JSON.stringify([{
        index: 0,
        sourceLanguage: "en",
        translatedText: "تمت الترجمة",
      }]),
    };
  };

  const results = await translateChatBatch([{ content: "synthetic message" }], "ar", generateContent);
  assert.equal(attempts, 2);
  assert.equal(results.get(0)?.translatedText, "تمت الترجمة");
});

test("uses the current stable Flash model first and falls back to the prior model", async () => {
  const models: string[] = [];
  const generateContent: TranslationGenerator = async (request) => {
    models.push(request.model);
    if (request.model === "gemini-3.8-flash") {
      throw Object.assign(new Error("private message text must not be logged"), {
        status: 404,
        code: "MODEL_NOT_FOUND",
      });
    }
    return {
      text: JSON.stringify([{
        index: 0,
        sourceLanguage: "en",
        translatedText: "مرحبا",
      }]),
    };
  };

  const results = await translateChatBatch([{ content: "private message text" }], "ar", generateContent);

  assert.deepEqual(models, ["gemini-3.8-flash", "gemini-2.5-flash"]);
  assert.equal(results.get(0)?.translatedText, "مرحبا");
});

test("translation failures expose useful safe diagnostics without logging message text", async () => {
  const privateText = "secret contract conversation";
  const generateContent: TranslationGenerator = async (request) => {
    throw Object.assign(new Error(privateText), {
      status: 503,
      code: "UPSTREAM_UNAVAILABLE",
    });
  };

  await assert.rejects(
    translateChatBatch([{ content: privateText }], "ar", generateContent),
    (error: unknown) => {
      const details = translationErrorDetails(error);
      const serialized = JSON.stringify(details);
      assert.equal(details.provider, "gemini");
      assert.equal(details.failureCode, "GEMINI_TRANSLATION_UNAVAILABLE");
      assert.equal(serialized.includes(privateText), false);
      assert.equal(serialized.includes("UPSTREAM_UNAVAILABLE"), true);
      assert.equal(serialized.includes("gemini-3.8-flash"), true);
      assert.equal(serialized.includes("gemini-2.5-flash"), true);
      return true;
    },
  );
});

test("does not retry authentication failures against other models", async () => {
  const models: string[] = [];
  const generateContent: TranslationGenerator = async (request) => {
    models.push(request.model);
    throw Object.assign(new Error("invalid API key"), {
      status: 403,
      code: "PERMISSION_DENIED",
    });
  };

  await assert.rejects(
    translateChatBatch([{ content: "hello" }], "ar", generateContent),
    (error: unknown) => {
      const details = translationErrorDetails(error);
      assert.equal(details.failureCode, "GEMINI_TRANSLATION_UNAVAILABLE");
      assert.deepEqual(models, ["gemini-3.8-flash"]);
      return true;
    },
  );
});