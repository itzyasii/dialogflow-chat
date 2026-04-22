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

type QuickAction = {
  label: string;
  prompt: string;
  simulatedReply: string;
};

const quickActions: QuickAction[] = [
  {
    label: "Track order",
    prompt: "I want to track my order status.",
    simulatedReply:
      "I can help with that. Please share your order number so I can look it up.",
  },
  {
    label: "Refund policy",
    prompt: "Explain the refund policy for late deliveries.",
    simulatedReply:
      "Refunds are available for eligible delayed deliveries. I can walk you through the policy or start a request.",
  },
  {
    label: "Store hours",
    prompt: "What are your support hours today?",
    simulatedReply:
      "Support is available from 9:00 AM to 9:00 PM local time today.",
  },
  {
    label: "Escalate",
    prompt: "Please connect me with a human support agent.",
    simulatedReply:
      "I can escalate this to a support specialist. Please hold while I capture a brief summary.",
  },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
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

function statusLabel(status: SocketStatus, bootMessage: string) {
  if (status === "connected") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "disconnected") return "Disconnected";
  return bootMessage;
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const [session, setSession] = useState<SessionState | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("booting");
  const [bootMessage, setBootMessage] = useState("Preparing your workspace...");
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
        setBootMessage("Starting a secure client session...");

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
        setBootMessage("Session ready");
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to bootstrap session",
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
          error instanceof Error
            ? error.message
            : "Unable to refresh chat history",
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
        intent: latestUserMessage
          ? "Frontend Simulation Follow-up"
          : "Initial Simulation",
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to simulate webhook",
      );
    } finally {
      setIsSimulating(false);
    }
  };

  const totalMessages = chat?.messages.length || 0;
  const latestMessageAt = chat?.lastMessageAt
    ? `${formatDate(chat.lastMessageAt)} at ${formatTime(chat.lastMessageAt)}`
    : "No messages yet";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Customer Support Chatbot</p>
          <h1>CSR Assistant Console</h1>
          <p className="subcopy">
            A production-style support workspace powered by session bootstrap,
            persistent chat history, real-time messaging, and Dialogflow webhook
            responses.
          </p>
        </div>

        <div className="topbar-actions">
          <div className={`status-pill ${socketStatus}`}>
            <span className="status-dot" />
            <span>{statusLabel(socketStatus, bootMessage)}</span>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={handleSimulateWebhook}
            disabled={!session || isSimulating}
          >
            {isSimulating ? "Sending..." : "Trigger webhook"}
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <section className="surface primary-summary">
            <p className="section-label">Session Overview</p>
            <h2>{chat?.clientUser.displayName || DISPLAY_NAME}</h2>
            <div className="summary-list">
              <div>
                <span>Status</span>
                <strong>{chat?.status || "open"}</strong>
              </div>
              <div>
                <span>Messages</span>
                <strong>{totalMessages}</strong>
              </div>
              <div>
                <span>Last activity</span>
                <strong>{latestMessageAt}</strong>
              </div>
            </div>
          </section>

          <section className="surface">
            <div className="surface-header">
              <h3>Quick actions</h3>
              <span>Send instantly</span>
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
                  <strong>{action.label}</strong>
                  <span>{action.prompt}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="surface">
            <div className="surface-header">
              <h3>Connection details</h3>
              <span>Current environment</span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Client ID</dt>
                <dd>{session?.userId || "Pending"}</dd>
              </div>
              <div>
                <dt>API</dt>
                <dd>{API_BASE_URL}</dd>
              </div>
              <div>
                <dt>Socket</dt>
                <dd>{SERVER_URL}</dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className="chat-shell surface">
          <div className="chat-header">
            <div>
              <p className="section-label">Live Conversation</p>
              <h2>Support session</h2>
            </div>
            <div className="header-meta">
              <span className="meta-chip">Webhook ready</span>
              <span className="meta-chip">Mongo persisted</span>
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
                  Start the conversation below. User messages go through the
                  backend socket, and server replies can arrive through the
                  Dialogflow webhook flow.
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
                    {message.senderRole === "server" ? "Assistant" : "Customer"}
                  </span>
                  <span>{formatTime(message.createdAt)}</span>
                  <span className="source-badge">{message.source}</span>
                </div>
                <p>{message.text}</p>
                {message.senderRole === "server" && message.dialogflow?.intent ? (
                  <div className="intent-chip">
                    {message.dialogflow.intent}
                    {typeof message.dialogflow.confidence === "number"
                      ? ` • ${Math.round(message.dialogflow.confidence * 100)}%`
                      : ""}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="composer-field">
              <span>Message</span>
              <textarea
                placeholder="Type a customer message..."
                rows={3}
                value={composerValue}
                onChange={(event) => setComposerValue(event.target.value)}
              />
            </label>
            <div className="composer-actions">
              <p className="composer-hint">
                Messages are stored in MongoDB and broadcast through Socket.IO.
              </p>
              <button
                className="primary-button"
                type="submit"
                disabled={isSending || socketStatus !== "connected"}
              >
                {isSending ? "Sending..." : "Send message"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

export default App;
