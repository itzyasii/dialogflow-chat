import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import {
  API_BASE_URL,
  bootstrapSession,
  fetchChatHistory,
  SERVER_URL,
  simulateWebhookReply,
} from "./lib/chatClient";
import type { ChatMessage, ChatState } from "./lib/chatClient";

const STORAGE_KEY = "dialogflow-chat-session";
const DISPLAY_NAME = "Ayesha";

type SessionState = {
  token: string;
  userId: string;
  displayName: string;
};

type SocketStatus = "booting" | "connecting" | "connected" | "disconnected";

type ActivityCard = {
  label: string;
  value: string;
  detail: string;
};

type QuickAction = {
  label: string;
  prompt: string;
  simulatedReply: string;
};

const quickActions: QuickAction[] = [
  {
    label: "Track order",
    prompt: "I want to track my order status.",
    simulatedReply: "I can help with that. Please share your order number so I can look it up.",
  },
  {
    label: "Refund policy",
    prompt: "Explain the refund policy for late deliveries.",
    simulatedReply: "Refunds are available for eligible delayed deliveries. I can walk you through the policy or start a request.",
  },
  {
    label: "Store hours",
    prompt: "What are your support hours today?",
    simulatedReply: "Support is available from 9:00 AM to 9:00 PM local time today.",
  },
  {
    label: "Talk to support",
    prompt: "Please connect me with a human support agent.",
    simulatedReply: "I can escalate this to a support specialist. Please hold while I capture a brief summary.",
  },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dedupeMessages(messages: ChatMessage[]) {
  const seen = new Map<string, ChatMessage>();
  for (const message of messages) {
    seen.set(message.id, message);
  }

  return Array.from(seen.values()).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const [session, setSession] = useState<SessionState | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("booting");
  const [bootMessage, setBootMessage] = useState("Preparing your chat workspace...");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const mergeMessages = useEffectEvent((incoming: ChatMessage[]) => {
    setChat((currentChat) => {
      if (!currentChat) {
        return currentChat;
      }

      return {
        ...currentChat,
        messages: dedupeMessages([...currentChat.messages, ...incoming]),
        lastMessageAt:
          incoming[incoming.length - 1]?.createdAt || currentChat.lastMessageAt,
      };
    });
  });

  useEffect(() => {
    const boot = async () => {
      try {
        setBootMessage("Starting a client session with the backend...");

        const storedSession = window.localStorage.getItem(STORAGE_KEY);
        const parsedSession = storedSession
          ? (JSON.parse(storedSession) as SessionState)
          : null;

        const bootstrap = await bootstrapSession({
          userId: parsedSession?.userId,
          displayName: parsedSession?.displayName || DISPLAY_NAME,
        });

        const nextSession = {
          token: bootstrap.token,
          userId: bootstrap.user.externalId,
          displayName: bootstrap.user.displayName || DISPLAY_NAME,
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
        setChat(bootstrap.chat);
        setBootMessage("Session ready. Connecting live updates...");
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to bootstrap session",
        );
        setSocketStatus("disconnected");
      }
    };

    void boot();
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    setSocketStatus("connecting");

    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      auth: {
        token: session.token,
      },
    });

    socketRef.current = socket;

    socket.on("connect", async () => {
      setSocketStatus("connected");
      setErrorMessage("");
      socket.emit("chat:join", {
        userId: session.userId,
        profile: {
          displayName: session.displayName,
        },
      });

      try {
        const history = await fetchChatHistory(session.userId);
        setChat(history);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to refresh chat history",
        );
      }
    });

    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
    });

    socket.on("socket:error", (payload: { message?: string }) => {
      setErrorMessage(payload.message || "Socket error");
    });

    socket.on(
      "chat:joined",
      (payload: { sessionId: string; messages: ChatMessage[] }) => {
        setChat((currentChat) =>
          currentChat
            ? {
                ...currentChat,
                sessionId: payload.sessionId || currentChat.sessionId,
                messages: dedupeMessages([
                  ...currentChat.messages,
                  ...payload.messages,
                ]),
              }
            : currentChat,
        );
      },
    );

    socket.on(
      "chat:message:created",
      (payload: { message: ChatMessage; sessionId: string }) => {
        setChat((currentChat) =>
          currentChat
            ? {
                ...currentChat,
                sessionId: payload.sessionId || currentChat.sessionId,
              }
            : currentChat,
        );
        mergeMessages([payload.message]);
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [mergeMessages, session]);

  useEffect(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [chat?.messages]);

  const handleSend = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage || !session || !socketRef.current) {
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    await new Promise<void>((resolve) => {
      socketRef.current?.emit(
        "chat:message:send",
        {
          text: trimmedMessage,
          profile: {
            displayName: session.displayName,
          },
        },
        (ack: { ok: boolean; error?: { message?: string } }) => {
          if (!ack?.ok) {
            setErrorMessage(ack?.error?.message || "Unable to send message");
          } else {
            setComposerValue("");
          }
          setIsSending(false);
          resolve();
        },
      );
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSend(composerValue);
  };

  const handleQuickAction = async (action: QuickAction) => {
    setComposerValue(action.prompt);
    await handleSend(action.prompt);
  };

  const handleSimulateWebhook = async () => {
    if (!session) {
      return;
    }

    setIsSimulating(true);
    setErrorMessage("");

    try {
      const latestUserMessage = [...(chat?.messages || [])]
        .reverse()
        .find((message) => message.senderRole === "client");

      const fallbackReply =
        quickActions.find((action) => action.prompt === latestUserMessage?.text)
          ?.simulatedReply ||
        "Webhook received. Dialogflow fulfillment is connected and ready to reply.";

      await simulateWebhookReply({
        userId: session.userId,
        text: fallbackReply,
        intent: latestUserMessage ? "Frontend Simulation Follow-up" : "Initial Simulation",
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to simulate webhook",
      );
    } finally {
      setIsSimulating(false);
    }
  };

  const activityCards: ActivityCard[] = [
    {
      label: "Socket status",
      value:
        socketStatus === "connected"
          ? "Connected"
          : socketStatus === "connecting"
            ? "Connecting"
            : socketStatus === "booting"
              ? "Booting"
              : "Disconnected",
      detail:
        socketStatus === "connected"
          ? "Real-time chat events are flowing through Socket.IO."
          : "Live updates will resume automatically when the socket reconnects.",
    },
    {
      label: "Messages stored",
      value: String(chat?.messages.length || 0),
      detail: "These messages come from MongoDB-backed chat history.",
    },
    {
      label: "Webhook endpoint",
      value: "/api/v1/dialogflow/webhook",
      detail: "Trigger Dialogflow fulfillment and replies will appear in this stream.",
    },
  ];

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Dialogflow ES Workspace</p>
          <h1>Conversational Console</h1>
          <p className="subcopy">
            Frontend and backend are now wired together through REST bootstrap,
            Mongo-backed chat history, and a live Socket.IO message stream.
          </p>
        </div>

        <div className="topbar-status">
          <div className="status-pill">
            <span className={`status-dot ${socketStatus}`} />
            {socketStatus === "connected" ? "Realtime connected" : bootMessage}
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={handleSimulateWebhook}
            disabled={!session || isSimulating}
          >
            {isSimulating ? "Simulating..." : "Simulate webhook reply"}
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel overview-panel">
          <section className="hero-card">
            <p className="section-label">Live integration</p>
            <h2>Client chat, backend persistence, and webhook replies now share one flow.</h2>
            <p>
              The frontend bootstraps a session from the server, joins a private
              socket room, and listens for Dialogflow fulfillment responses in real time.
            </p>

            <div className="hero-metrics">
              <div>
                <strong>{chat?.messages.length || 0}</strong>
                <span>Total messages</span>
              </div>
              <div>
                <strong>{chat?.sessionId || "Pending"}</strong>
                <span>Session key</span>
              </div>
            </div>
          </section>

          <section className="stack">
            <div className="section-header">
              <h3>Runtime diagnostics</h3>
              <span>Live</span>
            </div>

            <div className="activity-list">
              {activityCards.map((item) => (
                <article className="activity-card" key={item.label}>
                  <p>{item.label}</p>
                  <strong>{item.value}</strong>
                  <span>{item.detail}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="stack">
            <div className="section-header">
              <h3>Quick prompts</h3>
              <span>Send through socket</span>
            </div>

            <div className="quick-actions">
              {quickActions.map((action) => (
                <button
                  className="quick-action"
                  key={action.label}
                  type="button"
                  onClick={() => void handleQuickAction(action)}
                  disabled={isSending || socketStatus !== "connected"}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="panel chat-panel">
          <div className="chat-header">
            <div>
              <p className="section-label">Conversation stream</p>
              <h2>{chat?.clientUser.displayName || DISPLAY_NAME}</h2>
            </div>

            <div className="chat-badges">
              <span>{session?.userId || "No user"}</span>
              <span>{SERVER_URL}</span>
              <span>{API_BASE_URL}</span>
            </div>
          </div>

          <div className="message-stream" ref={streamRef}>
            {errorMessage ? (
              <article className="message system">
                <div className="message-meta">
                  <span className="author">System</span>
                </div>
                <p>{errorMessage}</p>
              </article>
            ) : null}

            {!chat?.messages.length ? (
              <article className="message system">
                <div className="message-meta">
                  <span className="author">System</span>
                </div>
                <p>
                  Send a message to store it in MongoDB, then use the webhook simulation
                  button or Dialogflow itself to push a server reply back into this chat.
                </p>
              </article>
            ) : null}

            {chat?.messages.map((message) => (
              <article
                className={`message ${message.senderRole === "server" ? "bot" : "user"}`}
                key={message.id}
              >
                <div className="message-meta">
                  <span className="author">
                    {message.senderRole === "server" ? "Bot" : "Customer"}
                  </span>
                  <span>{formatTime(message.createdAt)}</span>
                  <span className="source-badge">{message.source}</span>
                </div>

                <p>{message.text}</p>

                {message.senderRole === "server" && message.dialogflow?.intent ? (
                  <div className="intent-chip">
                    Intent: {message.dialogflow.intent}
                    {typeof message.dialogflow.confidence === "number"
                      ? ` (${Math.round(message.dialogflow.confidence * 100)}%)`
                      : ""}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer-field">
              <span>Test the bot</span>
              <textarea
                placeholder="Type a customer message and send it through the backend socket..."
                rows={3}
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
              />
            </label>

            <div className="composer-actions">
              <div className="composer-options">
                <button
                  type="button"
                  onClick={() => void handleSimulateWebhook()}
                  disabled={!session || isSimulating}
                >
                  {isSimulating ? "Sending webhook..." : "Trigger webhook"}
                </button>
              </div>

              <button
                className="primary-button"
                type="submit"
                disabled={isSending || socketStatus !== "connected"}
              >
                {isSending ? "Sending..." : "Send test message"}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel insights-panel">
          <section className="stack">
            <div className="section-header">
              <h3>Integration checklist</h3>
              <span>Current app flow</span>
            </div>

            <div className="knowledge-grid">
              <article className="knowledge-card">
                <h4>1. Bootstrap</h4>
                <p>
                  `POST /api/v1/session/bootstrap` creates a client identity,
                  returns a JWT, and loads existing chat history.
                </p>
              </article>

              <article className="knowledge-card">
                <h4>2. Realtime chat</h4>
                <p>
                  The browser joins its user room and sends messages through
                  `chat:message:send`, with persistence handled by the backend.
                </p>
              </article>

              <article className="knowledge-card">
                <h4>3. Fulfillment</h4>
                <p>
                  Dialogflow webhook replies, or the simulation button, are stored
                  and emitted back to the same user room.
                </p>
              </article>
            </div>
          </section>

          <section className="stack transcript-card">
            <div className="section-header">
              <h3>Setup reminders</h3>
              <span>Before demoing</span>
            </div>

            <ul>
              <li>Set `VITE_SERVER_URL` if the backend is not running on `http://localhost:5000`.</li>
              <li>Keep ngrok pointed at the backend and use `/api/v1/dialogflow/webhook` in Dialogflow ES.</li>
              <li>Include the same client UUID as `originalDetectIntentRequest.payload.userId` for live webhook routing.</li>
              <li>Make sure MongoDB is running so bootstrap and history retrieval can persist chat data.</li>
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
