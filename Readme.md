
System Overview & Classification
Project Identity: Full-stack MERN Tool-Calling AI Agent powered by a Hybrid RAG pipeline and Attribute-Based Access Control (ABAC) (evolved from an initial RBAC implementation).

Core Tech Stack:

Backend: Node.js, Express.js, MongoDB Atlas, Mongoose, OpenAI SDK (routed to Google Gemini's OpenAI-compatible endpoint gemini-2.5-flash / gemini-3.5-flash-lite after replacing rate-limited openrouter/free), @xenova/transformers, @johnhenry/semantic-chunker, pino, pino-http.

Frontend: React.js, Tailwind CSS, Server-Sent Events (SSE) token streaming, dynamic 3-domain category selector (portfolio_data, company_data, stranger_things), and session category indicators.

Network Hardening: Node.js IPv4 DNS/socket overrides (dns.setDefaultResultOrder("ipv4first") and net.setDefaultAutoSelectFamily(false)) applied across seed scripts, moderation, and server entrypoints to prevent dual-stack IPv6 undici fetch failed timeouts.

Phase 1: Offline Ingestion & Attribute Tagging (seedRag.js, seedAbac.js)
Sanitization & Semantic Chunking: Raw documents are cleaned via cleanText.js and split using @johnhenry/semantic-chunker (zScoreThreshold: 1.0, maxChunkSize: 1000, overlap: 1).

Local Embedding Generation: Chunks are encoded into 384-dimensional float vectors using Xenova/all-MiniLM-L6-v2 (mean pooling, L2 normalized). Access-control metadata remains un-embedded as queryable BSON fields.

Resource Attribute Schemas (Knowledge Collection):

Legacy Domains (portfolio_data, stranger_things): Tagged with category and visibility ("public" vs. "private" via [SECRET] markers).

Multi-Department Domain (company_data): Tagged with category: "company_data", department ("public", "engineering", "finance", "hr"), and clearanceRequired (1 = Basic, 2 = Confidential, 3 = Restricted).

Seeded Test Identities (User Collection, Password: Test@1234):

ali.eng@company.com — role: "user", department: "engineering", clearanceLevel: 2

sara.fin@company.com — role: "user", department: "finance", clearanceLevel: 2

usman.hr@company.com — role: "user", department: "hr", clearanceLevel: 1

Admin accounts (role: "admin") bypass department/clearance restrictions within a category.

Phase 2: Zero-Trust ABAC & Hybrid Retrieval (abacPolicy.js, rag.service.js)
Tamper-Proof Subject Resolution: The protect middleware validates the HTTP-only JWT cookie and fetches authoritative user attributes (_id, role, department, clearanceLevel) directly from MongoDB—never trusting client request bodies.

Policy Engine (buildAbacFilter): Evaluates Subject (role, department, clearanceLevel), Resource (category, department, clearanceRequired / visibility), and Environment (optional 09:00–17:00 business-hours restriction) to compile a single MongoDB MQL filter ($and, $or, $eq, $lte).

Atlas Search Indexes:

vector_index: 384-dim cosine vector path (embedding) with explicit "type": "filter" paths on metadata.category, metadata.visibility, metadata.department, and metadata.clearanceRequired.

text_index: Full-text lexical index on content.

Parallel Dual-Branch Retrieval (Zero-Trust Database Boundary):

Branch A (Dense Vector Search): $vectorSearch applies filter: abacFilter before vector similarity scoring, preventing unauthorized data leaks and Top-K starvation.

Branch B (Sparse Keyword Search): $search runs lexical matching immediately followed by $match: abacFilter so RRF never merges unauthorized chunks.

Fusion & Re-Ranking:

Reciprocal Rank Fusion (rrf.js): Merges top 10 dense and top 10 sparse candidates into a unified ranking.

Cross-Encoder Re-Ranking: Xenova/ms-marco-MiniLM-L-6-v2 (q8 quantized) jointly scores (queryText, chunkContent) pairs and returns the top 3 (FINAL_RESULT_LIMIT = 3) authorized chunks.

Phase 3: Agentic ReAct Loop, Tool RBAC & Guardrails (ai.service.js, tool.service.js, moderation.service.js)
Recursive ReAct Streaming Loop (processStream): Streams LLM responses via SSE. When Gemini emits tool_calls, the backend intercepts the stream, executes the authorized function via executeTool, appends the tool message to currentMessages, and recursively re-invokes the stream for final synthesis.

Role-Gated Tool Schemas (getToolsByRole):

Standard Users (user): getGithubStats, getWeather.

Admins (admin): getGithubStats, getWeather, getSystemStatus, and getAllUsers (queries User.find({}, "-password").lean() to strip password hashes).

Prompt Architecture & Domain Routing (DOMAIN_CONFIG):

Dynamically maps portfolio_data, company_data, and stranger_things to isolated domain descriptions, focus areas, and out-of-bounds rejection messages.

Tool Priority Rule (Section 3): Explicitly instructs the LLM to evaluate and trigger available tools before applying domain-restriction rejections.

Strict Refusal Protocol (Method C): When ABAC blocks retrieval and <context> is empty, the model outputs "I don't have this information." without guessing or leaking restricted knowledge.

Gemini Message Compliance: Conversation summaries are merged into a single system prompt, and assistant tool_calls messages use content: "" instead of null to prevent 400 Bad Request errors.

Input Moderation (moderation.service.js): Configured with a 5-second AbortSignal.timeout and fail-open fallback ({ flagged: false }) so transient network timeouts do not crash chatController.

Phase 4: Observability & Production Trade-offs (logger.js)
Structured Logging (pino & pino-http):

Generates unique X-Request-Id correlation headers per request and attaches userId and userRole context.

Uses child loggers (module: "rag", "tool-execution", "abac-policy") with performance.now() latency tracking.

Redacts req.headers.authorization, req.headers.cookie, res.headers['set-cookie'], *.password, *.token, and API keys.

Restricts pino-pretty worker threads strictly to NODE_ENV !== "production" so Vercel serverless functions output clean JSON stdout without cold-start penalties or dropped logs.

Known Scale Bottleneck: Running local @xenova/transformers inference (bi-encoder + cross-encoder) inside serverless functions (such as Vercel) introduces cold-start latency and CPU overhead; scaling to high concurrency requires offloading embeddings and re-ranking to dedicated external APIs or a standalone inference service.
