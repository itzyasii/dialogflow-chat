const SERVER_URL =
  import.meta.env.VITE_SERVER_URL?.trim() || "http://localhost:5000";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || `${SERVER_URL}/api/v1`;

export type ChatMessage = {
  id: string;
  senderRole: "client" | "server";
  text: string;
  source: "socket" | "webhook" | "api";
  dialogflow?: {
    intent?: string | null;
    action?: string | null;
    confidence?: number | null;
    responseId?: string | null;
    session?: string | null;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ChatUser = {
  id: string;
  externalId: string;
  role: "client" | "server";
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  lastSeenAt: string;
};

export type ChatState = {
  id: string;
  sessionId: string;
  status: "open" | "closed";
  lastMessageAt: string;
  clientUser: ChatUser;
  serverUser: ChatUser;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type BootstrapResponse = {
  token: string;
  user: ChatUser;
  chat: ChatState;
};

type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String(body.message || "Request failed")
        : "Request failed";
    throw new Error(message);
  }

  return body;
}

export async function bootstrapSession(input: {
  userId?: string;
  displayName: string;
  email?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/session/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const data = await parseResponse<ApiEnvelope<BootstrapResponse>>(response);
  return data.data;
}

export async function fetchChatHistory(clientUserId: string) {
  const response = await fetch(`${API_BASE_URL}/chats/${clientUserId}`);
  const data = await parseResponse<ApiEnvelope<ChatState>>(response);
  return data.data;
}

export async function simulateWebhookReply(input: {
  userId: string;
  text: string;
  intent?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/dialogflow/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      responseId: `simulated-${Date.now()}`,
      session: `projects/local-agent/sessions/${input.userId}`,
      queryResult: {
        queryText: input.text,
        action: "chat.simulatedReply",
        fulfillmentText: input.text,
        intentDetectionConfidence: 0.98,
        intent: {
          displayName: input.intent || "Frontend Simulation",
        },
        parameters: {},
      },
      originalDetectIntentRequest: {
        payload: {
          userId: input.userId,
        },
      },
    }),
  });

  return parseResponse<{
    fulfillmentText: string;
    fulfillmentMessages: Array<{ text: { text: string[] } }>;
    payload: {
      chatId: string;
      message: ChatMessage;
    };
  }>(response);
}

export { API_BASE_URL, SERVER_URL };
