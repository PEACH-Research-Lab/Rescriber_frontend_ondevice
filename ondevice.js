// ondevice.js — Calls Ollama via the background service worker.
// Uses streaming via ports for progressive UI updates.

const DEFAULT_OLLAMA_MODEL = "llama3";

async function getOllamaModel() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["ollamaModel"], (result) => {
      resolve(result.ollamaModel || DEFAULT_OLLAMA_MODEL);
    });
  });
}

const DETECT_SYSTEM_PROMPT = `Find every piece of personally identifiable information (PII) in the user's message.

Rules:
1. "text" must be copied exactly from the message. Do not invent text.
2. Do NOT include empty results. Only return PII you actually found.
3. Capture every variant/abbreviation separately (e.g. "Vanderbilt University", "Vandy", "VU" are three separate results).

entity_type must be: NAME, EMAIL, PHONE_NUMBER, ADDRESS, SSN, IP_ADDRESS, URL, DRIVERS_LICENSE, PASSPORT_NUMBER, TAXPAYER_IDENTIFICATION_NUMBER, ID_NUMBER, USERNAME, KEYS, GEOLOCATION, AFFILIATION, DEMOGRAPHIC_ATTRIBUTE, TIME, HEALTH_INFORMATION, FINANCIAL_INFORMATION, EDUCATIONAL_RECORD

Example:
Input: "I study at MIT. Life at the Institute is great. I'm 20 years old."
Output: {"results":[{"entity_type":"AFFILIATION","text":"MIT"},{"entity_type":"AFFILIATION","text":"the Institute"},{"entity_type":"DEMOGRAPHIC_ATTRIBUTE","text":"20 years old"}]}`;

const CLUSTER_SYSTEM_PROMPT = `For the given message, find ALL segments of the message with the same contextual meaning as the given PII. Consider segments that are semantically related or could be inferred from the original PII or share a similar context or meaning. List all of them in a list, and each segment should only appear once in each list.  Please return only in JSON format. Each PII provided will be a key, and its value would be the list PIIs (include itself) that has the same contextual meaning.

  Example 1:
  Input:
  <message>I will be the valedictorian of my class. Please write me a presentation based on the following information: As a student at Vanderbilt University, I feel honored. The educational journey at Vandy has been nothing less than enlightening. The dedicated professors here at Vanderbilt are the best. As an 18 year old student at VU, the opportunities are endless.</message>
  <pii1>Vanderbilt University</pii1>
  <pii2>18 year old</pii2>
  <pii3>VU</pii3>
  Expected JSON output:
  {'Vanderbilt University': ['Vanderbilt University', 'Vandy', 'VU', 'Vanderbilt'], '18 year old':['18 year old'], 'VU':[ 'VU', 'Vanderbilt University', 'Vandy', 'Vanderbilt']}

  Example 2:
  Input:
  <message>Do you know Bill Gates and the company he founded, Microsoft? Can you send me an article about how he founded it to my email at jeremyKwon@gmail.com please?</message>
  <pii1>Bill Gates</pii1>
  <pii2>jeremyKwon@gmail.com</pii2>
  Expected JSON output:
  {'Bill Gates': ['Bill Gates', 'Microsoft'], 'jeremyKwon@gmail.com':['jeremyKwon@gmail.com']}`;

const ABSTRACT_SYSTEM_PROMPT = `Rewrite the text to abstract the protected information. For each protected item, return the original and its abstracted replacement. Do not change other parts of the text. Return ONLY a JSON in the following format: {"results": [{"protected": ORIGINAL_TEXT, "abstracted": REPLACEMENT_TEXT}]}`;

// Opens a streaming port to the background worker.
// Tokens accumulate synchronously; returns a handle for polling.
function openOllamaStream(messages, format = "json", model) {
  const state = { accumulated: "", done: false, error: null, stats: null };

  const port = chrome.runtime.connect({ name: "ollama-stream" });

  port.onMessage.addListener((msg) => {
    if (msg.type === "token") {
      state.accumulated += msg.content;
    } else if (msg.type === "done") {
      state.stats = msg.stats;
      state.done = true;
      port.disconnect();
    } else if (msg.type === "error") {
      state.error = msg.error;
      state.done = true;
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    state.done = true;
  });

  port.postMessage({ model, messages, format, options: { temperature: 0 } });

  return state;
}

// Polls a stream, calling onNewResults each time JSON parse yields more results.
// Uses setTimeout to yield to the browser so DOM updates paint between callbacks.
async function pollStreamForResults(state, parseResults, onNewResults) {
  let lastCount = 0;
  while (!state.done) {
    // Yield to browser — allows DOM to paint between callbacks
    await new Promise((r) => setTimeout(r, 100));

    if (onNewResults) {
      try {
        const results = parseResults(state.accumulated);
        if (results && results.length > lastCount) {
          lastCount = results.length;
          await onNewResults(results);
        }
      } catch {
        // Incomplete JSON, keep waiting
      }
    }
  }

  if (state.error) throw new Error(state.error);

  // Final parse after stream completes
  let finalResults;
  try {
    finalResults = parseResults(state.accumulated);
  } catch {
    finalResults = null;
  }

  // Fire one last callback if there are new results
  if (onNewResults && finalResults && finalResults.length > lastCount) {
    await onNewResults(finalResults);
  }

  return { content: state.accumulated, results: finalResults, stats: state.stats };
}

// Extract completed JSON objects from a partial/incomplete JSON stream.
// Finds each {...} that contains the expected keys, without needing the
// outer array or object to be closed yet.
function extractCompletedObjects(accumulated, requiredKeys) {
  const results = [];
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < accumulated.length; i++) {
    const ch = accumulated[i];
    if (ch === "{") {
      if (depth === 1) objStart = i; // inside the results array
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 1 && objStart !== -1) {
        const objStr = accumulated.slice(objStart, i + 1);
        try {
          const obj = JSON.parse(objStr);
          if (requiredKeys.every((k) => k in obj)) {
            results.push(obj);
          }
        } catch {
          // Incomplete object, skip
        }
        objStart = -1;
      }
    }
  }
  return results;
}

// --- Chunking for long messages ---
// ~4 chars per token on average, 6K tokens ≈ 24K chars.
// System prompt is ~300 tokens, so we budget ~5700 tokens ≈ 22800 chars for user text.
const MAX_CHUNK_CHARS = 22800;

function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];

  // Split by sentence boundaries: ., !, ?, or newline followed by space/newline/end
  const sentenceEnds = /(?<=[.!?\n])\s+/g;
  const sentences = text.split(sentenceEnds);

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + sentence;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// Non-streaming fallback (used for cluster)
async function callOllama(messages, format = "json") {
  const model = await getOllamaModel();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "ollama",
        endpoint: "/api/chat",
        payload: {
          model,
          messages,
          stream: false,
          format,
          options: { temperature: 0 },
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      }
    );
  });
}

export async function getOnDeviceResponseDetect(userMessage, onResultCallback) {
  console.log("[ondevice:detect] Input:", userMessage.slice(0, 200));
  const t0 = performance.now();
  const model = await getOllamaModel();
  const chunks = splitIntoChunks(userMessage);
  const allResults = [];

  console.log(`[ondevice:detect] Split into ${chunks.length} chunk(s)`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[ondevice:detect] Chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);

    const stream = openOllamaStream(
      [
        { role: "system", content: DETECT_SYSTEM_PROMPT },
        { role: "user", content: chunk },
      ],
      "json",
      model
    );

    const { results: chunkResults } = await pollStreamForResults(
      stream,
      (accumulated) => extractCompletedObjects(accumulated, ["entity_type", "text"]),
      // Progressive callback: merge chunk results with previous chunks
      (newChunkResults) => {
        if (onResultCallback) {
          onResultCallback([...allResults, ...newChunkResults]);
        }
      }
    );

    if (chunkResults && chunkResults.length > 0) {
      allResults.push(...chunkResults);
    }
  }

  const ms = (performance.now() - t0).toFixed(0);
  console.log(`[ondevice:detect] Done (${ms}ms): ${allResults.length} entities across ${chunks.length} chunk(s)`);
  return allResults;
}

export async function getOnDeviceResponseCluster(userMessageCluster) {
  console.log("[ondevice:cluster] Input:", userMessageCluster.slice(0, 200));
  const t0 = performance.now();

  const response = await callOllama([
    { role: "system", content: CLUSTER_SYSTEM_PROMPT },
    { role: "user", content: userMessageCluster },
  ]);

  const ms = (performance.now() - t0).toFixed(0);
  console.log(`[ondevice:cluster] Raw response (${ms}ms):`, response.message?.content);

  let content;
  try {
    content =
      typeof response.message.content === "string"
        ? response.message.content
        : JSON.stringify(response.message.content);
  } catch (e) {
    console.error("[ondevice:cluster] Parse failed:", e);
    return "{}";
  }
  return content;
}

export async function getOnDeviceAbstractResponse(
  originalMessage,
  currentMessage,
  abstractList,
  onResultCallback
) {
  const userPrompt = `Text: ${currentMessage}\nProtected information: ${abstractList.join(", ")}`;
  console.log("[ondevice:abstract] Input:", userPrompt.slice(0, 200));
  const t0 = performance.now();
  const model = await getOllamaModel();

  const stream = openOllamaStream(
    [
      { role: "system", content: ABSTRACT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    "json",
    model
  );

  const { content, results } = await pollStreamForResults(
    stream,
    (accumulated) => extractCompletedObjects(accumulated, ["protected", "abstracted"]),
    onResultCallback
  );

  const ms = (performance.now() - t0).toFixed(0);
  console.log(`[ondevice:abstract] Response (${ms}ms):`, content);
  console.log("[ondevice:abstract] Parsed results:", results);
}
