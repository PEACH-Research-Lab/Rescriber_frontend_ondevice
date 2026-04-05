#!/usr/bin/env python3
"""Quick test script for Ollama PII detection, clustering, and abstraction.

Usage:
  python3 test_ollama.py                          # detect with default example
  python3 test_ollama.py detect "My name is John"  # detect with custom message
  python3 test_ollama.py cluster                   # cluster with default example
  python3 test_ollama.py abstract                  # abstract with default example
"""

import json
import sys
import time
import urllib.request

MODEL = "llama3"
#MODEL = "gemma3:1b"
BASE = "http://localhost:11434/api/chat"

# --- Prompts (same as ondevice.js) ---

DETECT_SYSTEM = """Extract all personally identifiable information (PII) from the user's message. Do NOT answer the message.

PII types: NAME, USERNAME, ADDRESS, IP_ADDRESS, URL, SSN, PHONE_NUMBER, EMAIL, DRIVERS_LICENSE, PASSPORT_NUMBER, TAXPAYER_IDENTIFICATION_NUMBER, ID_NUMBER, KEYS (passwords/API keys), GEOLOCATION (cities/countries/places), AFFILIATION (organizations/schools/companies), DEMOGRAPHIC_ATTRIBUTE (age/ethnicity/nationality/gender/religion), TIME (dates/durations), HEALTH_INFORMATION (medical conditions/allergies/treatments), FINANCIAL_INFORMATION (accounts/salary/financial status), EDUCATIONAL_RECORD (degrees/transcripts).

Rules:
- "text" must be a verbatim substring from the message. Never paraphrase or reword.
- Be comprehensive: include all PII, even if not uniquely identifying.
- Use minimum possible units (e.g. "Jennie" not "my friend Jennie").

Example input: "My friend Alice is studying in Japan. She is 25 years old, is allergic to peanuts, and works at Samsung."
Example output: {"results": [{"entity_type": "NAME", "text": "Alice"}, {"entity_type": "GEOLOCATION", "text": "Japan"}, {"entity_type": "DEMOGRAPHIC_ATTRIBUTE", "text": "25 years old"}, {"entity_type": "HEALTH_INFORMATION", "text": "allergic to peanuts"}, {"entity_type": "AFFILIATION", "text": "Samsung"}]}

Return ONLY JSON: {"results": [{"entity_type": TYPE, "text": EXACT_TEXT_FROM_MESSAGE}]}"""

CLUSTER_SYSTEM = """For the given message, find ALL segments of the message with the same contextual meaning as the given PII. Consider segments that are semantically related or could be inferred from the original PII or share a similar context or meaning. List all of them in a list, and each segment should only appear once in each list. Please return only in JSON format. Each PII provided will be a key, and its value would be the list PIIs (include itself) that has the same contextual meaning."""

ABSTRACT_SYSTEM = """Replace each protected item with a vaguer, more general description that fits naturally as a drop-in replacement. Do not add extra words.
- Names → role/relation ("Jennie"→"a friend")
- Places → broader region ("Korea"→"East Asia", "Mountain View"→"a city in California")
- Ages → range ("20 years old"→"in our early twenties")
- Health → general ("allergic to alcohol"→"has a health concern")
- Other → generalize to category

Return ONLY: {"results": [{"protected": ORIGINAL, "abstracted": REPLACEMENT}]}"""

# --- Default test messages ---

DEFAULT_MESSAGES = {
    "detect": "My friend Jennie and I are study abroad in Korea, and this year we are 20 years old. The upperclassmen invited us to hang out and they might drink alcohol. But Jennie is actually allergic to alcohol so she is not comfortable with that, how should we reply in just three lines?",
    "cluster": (
        "<message>Hi, my name is John Smith. I work at Google in Mountain View, CA. "
        "My email is john.smith@gmail.com. Call me Johnny if you want.</message>\n"
        "<pii1>John Smith</pii1>\n<pii2>Google</pii2>\n<pii3>john.smith@gmail.com</pii3>"
    ),
    "abstract": (
        "Text: My friend Jennie and I are study abroad in Korea, and this year we are 20 years old. "
        "The upperclassmen invited us to hang out and they might drink alcohol. But Jennie is actually "
        "allergic to alcohol so she is not comfortable with that, how should we reply in just three lines?\n"
        "Protected information: Jennie, Korea, 20 years old, allergic to alcohol"
    ),
}

SYSTEM_PROMPTS = {
    "detect": DETECT_SYSTEM,
    "cluster": CLUSTER_SYSTEM,
    "abstract": ABSTRACT_SYSTEM,
}


def call_ollama(system_prompt, user_message):
    payload = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_ctx": 4096},
    }).encode()

    req = urllib.request.Request(
        BASE,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    t0 = time.time()
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    elapsed = time.time() - t0

    return data, elapsed


def main():
    task = sys.argv[1] if len(sys.argv) > 1 else "detect"
    if task not in SYSTEM_PROMPTS:
        print(f"Usage: python3 {sys.argv[0]} [detect|cluster|abstract] [custom message]")
        sys.exit(1)

    user_msg = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MESSAGES[task]
    system_prompt = SYSTEM_PROMPTS[task]

    print(f"=== Task: {task} | Model: {MODEL} ===")
    print(f"--- User message ---")
    print(user_msg)
    print(f"\n--- Calling Ollama... ---")

    try:
        data, elapsed = call_ollama(system_prompt, user_msg)
    except Exception as e:
        print(f"Error: {e}")
        print("Is Ollama running? Try: curl http://localhost:11434/api/tags")
        sys.exit(1)

    # Parse and display response
    content_str = data.get("message", {}).get("content", "")
    print(f"\n--- Response ({elapsed:.1f}s) ---")

    try:
        parsed = json.loads(content_str)
        print(json.dumps(parsed, indent=2))
    except json.JSONDecodeError:
        print(f"Raw (not valid JSON): {content_str}")

    # Timing stats from Ollama
    total_dur = data.get("total_duration", 0) / 1e9
    prompt_tokens = data.get("prompt_eval_count", 0)
    eval_tokens = data.get("eval_count", 0)
    eval_dur = data.get("eval_duration", 0) / 1e9

    print(f"\n--- Stats ---")
    print(f"Prompt tokens: {prompt_tokens}")
    print(f"Output tokens: {eval_tokens}")
    print(f"Total duration: {total_dur:.1f}s")
    if eval_dur > 0 and eval_tokens > 0:
        print(f"Generation speed: {eval_tokens / eval_dur:.1f} tok/s")


if __name__ == "__main__":
    main()
