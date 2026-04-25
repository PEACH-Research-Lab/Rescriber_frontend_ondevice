import { dlog } from "./debug.js";

async function getApiKey() {
  const { openaiApiKey } = await new Promise((resolve, reject) => {
    chrome.storage.sync.get(["openaiApiKey"], (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });

  if (!openaiApiKey) {
    console.error("No API key available");
    return [];
  }
  return openaiApiKey;
}
export async function getCloudResponseDetect(userMessageDetect) {
  const url = "https://api.openai.com/v1/chat/completions";
  const systemPromptDetect = `You an expert in cybersecurity and data privacy. You are now tasked to detect PII from the given text, using the following taxonomy only:

  ADDRESS
  IP_ADDRESS
  URL
  SSN
  PHONE_NUMBER
  EMAIL
  DRIVERS_LICENSE
  PASSPORT_NUMBER
  TAXPAYER_IDENTIFICATION_NUMBER
  ID_NUMBER
  NAME
  USERNAME
  
  KEYS: Passwords, passkeys, API keys, encryption keys, and any other form of security keys.
  GEOLOCATION: Places and locations, such as cities, provinces, countries, international regions, or named infrastructures (bus stops, bridges, etc.). 
  AFFILIATION: Names of organizations, such as public and private companies, schools, universities, public institutions, prisons, healthcare institutions, non-governmental organizations, churches, etc. 
  DEMOGRAPHIC_ATTRIBUTE: Demographic attributes of a person, such as native language, descent, heritage, ethnicity, nationality, religious or political group, birthmarks, ages, sexual orientation, gender and sex. 
  TIME: Description of a specific date, time, or duration. 
  HEALTH_INFORMATION: Details concerning an individual's health status, medical conditions, treatment records, and health insurance information. 
  FINANCIAL_INFORMATION: Financial details such as bank account numbers, credit card numbers, investment records, salary information, and other financial statuses or activities. 
  EDUCATIONAL_RECORD: Educational background details, including academic records, transcripts, degrees, and certification.
    
    For the given message that a user sends to a chatbot, identify all the personally identifiable information using the above taxonomy only, and the entity_type should be selected from the all-caps categories.
    Note that the information should be related to a real person not in a public context, but okay if not uniquely identifiable.
    Result should be in its minimum possible unit.
    Return me ONLY a json in the following format: {"results": [{"entity_type": YOU_DECIDE_THE_PII_TYPE, "text": PART_OF_MESSAGE_YOU_IDENTIFIED_AS_PII]}`;
  const headers = {
    "Content-Type": "application/json",
  };

  const body = JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPromptDetect },
      { role: "user", content: userMessageDetect },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
    seed: 40,
    top_p: 0.0000000000000000000001,
  });

  const apiKey = await getApiKey();

  headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
    });
    if (!response.ok) {
      // If the response is not OK, log the status and the response body
      const errorText = await response.text();
      console.error(
        "Bad Request:",
        response.status,
        response.statusText,
        errorText
      );
      return [];
    }

    const data = await response.json();
    const content = JSON.parse(data.choices[0].message.content);
    return content.results;
  } catch (error) {
    console.error("Error fetching OpenAI response:", error);
    return [];
  }
}

export async function getCloudResponseCluster(userMessageCluster) {
  const apiKey = await getApiKey();
  const url = "https://api.openai.com/v1/chat/completions";
  const systemPromptCluster = `For the given message, find ALL segments of the message with the same contextual meaning as the given PII. Consider segments that are semantically related or could be inferred from the original PII or share a similar context or meaning. List all of them in a list, and each segment should only appear once in each list.  Please return only in JSON format. Each PII provided will be a key, and its value would be the list PIIs (include itself) that has the same contextual meaning.

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

  const requestBody = {
    messages: [
      {
        role: "system",
        content: systemPromptCluster,
      },
      { role: "user", content: userMessageCluster },
    ],
    model: "gpt-3.5-turbo-0125",
    response_format: { type: "json_object" },
    temperature: 0,
    seed: 40,
    top_p: 0.0000000000000000000001,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Network response was not ok: ${response.statusText}, ${errorText}`
      );
    }

    const data = await response.json();
    dlog(
      `cloud model clustering result chars=${
        (data.choices[0].message.content || "").length
      }`
    );
    return data.choices[0].message.content;
  } catch (error) {
    console.error("There has been a problem with your fetch operation:", error);
  }
}

export async function getCloudAbstractResponse(
  originalMessage,
  currentMessage,
  abstractList
) {
  const url = "https://api.openai.com/v1/chat/completions";
  const systemPrompt = `Rewrite the text to abstract the protected information, and don't change other parts, directly return the text in JSON format: {"text": REWRITE_TEXT}`;
  const userPrompt = `Text: ${currentMessage}\nProtected information: ${abstractList.join(
    ", "
  )}`;

  const headers = {
    "Content-Type": "application/json",
  };

  const body = JSON.stringify({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });

  const apiKey = await getApiKey();

  headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: body,
    });

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error fetching OpenAI response:", error);
    return null;
  }
}
