import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.AI_API_KEY,

  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-OpenRouter-Title": "AI Website Builder",
  },

  timeout: 30000, // ⏱ hard stop (VERY IMPORTANT)
});

export default openai;