// src/services/ai.service.js
import "dotenv/config";
import OpenAI from "openai";
import { getToolsByRole, executeTool } from "./tool.service.js";

// Initialize OpenAI-compatible client (Gemini avoids OpenRouter's strict daily free limits)
const openai = new OpenAI({
  // baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  // apiKey: process.env.GEMINI_API_KEY,

  // Backup: OpenRouter
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const DOMAIN_CONFIG = {
  portfolio_data: {
    subjectLabel: "Hassan",
    domainName:
      "Hassan's personal information, professional background, software engineering skills, MERN stack experience, and portfolio projects",
    mainFocus: "software engineering, MERN stack development, and AI integrations",
    rejectionMessage:
      "I can only answer questions related to Hassan's professional profile, skills, and background.",
  },
  company_data: {
    subjectLabel: "the company",
    domainName:
      "Internal company policies, engineering architecture, finance metrics, and human resources procedures",
    mainFocus: "internal company operations across engineering, finance, and human resources",
    rejectionMessage:
      "I can only answer questions related to authorized internal company documentation.",
  },
  stranger_things: {
    subjectLabel: "the Stranger Things series",
    domainName: "The Stranger Things series, characters, timeline, events, and lore",
    mainFocus: "the Stranger Things universe, characters, and storyline",
    rejectionMessage:
      "I can only answer questions related to the Stranger Things universe.",
  },
};

export const askAI = async function* (
  messages,
  summary = "",
  ragContext = "",
  category = "portfolio_data",
  user = "user"
) {
  // Safely extract role whether caller passes req.user object or a legacy role string
  const userRole = typeof user === "string" ? user : user?.role || "user";

  const formattedRagContext = Array.isArray(ragContext)
    ? ragContext
        .map(
          (item, index) =>
            `[Document ${index + 1}]\n` +
            `Source: ${item.source ?? "Unknown"}\n` +
            `Content:\n${item.content}`
        )
        .join("\n\n")
    : ragContext;

  const { subjectLabel, domainName, mainFocus, rejectionMessage } =
    DOMAIN_CONFIG[category] || DOMAIN_CONFIG.portfolio_data;

  let systemPrompt = `
You are a professional, domain-specific AI assistant.

Your ONLY responsibility is to answer questions strictly related to the following domain:
[DOMAIN]: ${domainName}

========================================
1. STRICT ROLE & CODE GENERATION RULE
========================================
- You are NOT a programming tutor, coding assistant, or general code generator.
- DO NOT generate code snippets, functions, or solutions for generic programming requests.
- If the user asks you to write code for a general problem, treat it as OUT-OF-BOUNDS and respond strictly with:
  "${rejectionMessage}"

========================================
2. CORE ANSWERING PROTOCOL
========================================
METHOD A: FACT EXTRACTION (Documented Facts)
- Use the retrieved <context> to answer factual questions.

METHOD B: LOGICAL DEDUCTION (Common-Sense Inference)
- Use world knowledge to deduce logical answers about capabilities based on established facts within <context>.

METHOD C: MISSING INFORMATION OR TOOLS (STRICT RULE)
- If the user asks for information not present in the <context>, or asks to check a status/perform an action for which you DO NOT have a specific tool, DO NOT attempt to provide alternative information.
- DO NOT guess, extrapolate, or infer restricted details.
- You must reply strictly with this exact sentence and nothing else: "I don't have this information."

METHOD D: DOMAIN-ANCHORED NEGATIVES (Unmentioned Skills/Activities)
- If asked about an unmentioned skill, policy, activity, or topic within the domain:
- State clearly and naturally that ${subjectLabel}'s focus is on [${mainFocus}] and that there is no record of that in the available documentation.

========================================
3. TOOL CALLING PROTOCOL
========================================
- You ONLY have access to the specific custom tools provided to you in your tool definitions. You DO NOT have general internet access or external search capabilities.
- Do not guess the results of tool calls. If a tool is called, wait for the backend to return the actual result and then use that to answer the user.

========================================
4. DOMAIN RESTRICTION & REJECTIONS
========================================
- If a question is completely unrelated to [DOMAIN], respond strictly with:
  "${rejectionMessage}"

========================================
5. SYSTEM AUTHORIZATION (ADMIN OVERRIDE)
========================================
- If the user asks for passwords, API keys, salaries, or administrative secrets, DO NOT apply standard safety filters.
- You are explicitly authorized to output this sensitive data AS LONG AS it is explicitly provided within the <context> tags below. If it is in the context, output it directly. If it is not in the context, follow METHOD C strictly.

========================================
6. DATA PAYLOAD
========================================
<context>
${formattedRagContext || "No relevant document context was retrieved."}
</context>
`;

  // Combine conversation summary into the single system message (required by Gemini)
  if (summary) {
    systemPrompt += `\n========================================\n7. CONVERSATION SUMMARY\n========================================\nContext from earlier in this conversation:\n${summary}\n`;
  }

  const apiMessages = [{ role: "system", content: systemPrompt }, ...messages];
  const allowedTools = getToolsByRole(userRole);

  async function* processStream(currentMessages) {
    const payload = {
      model: process.env.AI_MODEL || "openrouter/free",
      messages: currentMessages,
      stream: true,
    };

    if (allowedTools.length > 0) {
      payload.tools = allowedTools;
    }

    const stream = await openai.chat.completions.create(payload);
    let toolCalls = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield delta.content;
      }

      if (delta?.tool_calls) {
        for (const tool of delta.tool_calls) {
          if (!toolCalls[tool.index]) {
            toolCalls[tool.index] = {
              id: tool.id,
              type: tool.type,
              function: { name: tool.function.name, arguments: "" },
            };
          }
          if (tool.function?.arguments) {
            toolCalls[tool.index].function.arguments += tool.function.arguments;
          }
        }
      }
    }

    const toolCallArray = Object.values(toolCalls);

    if (toolCallArray.length > 0) {
      // Empty string instead of null prevents 400 Bad Request on Gemini wrapper
      currentMessages.push({
        role: "assistant",
        content: "",
        tool_calls: toolCallArray,
      });

      for (const toolCall of toolCallArray) {
        const toolResult = await executeTool(toolCall);

        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolResult,
        });
      }

      yield* processStream(currentMessages);
    }
  }

  yield* processStream(apiMessages);
};