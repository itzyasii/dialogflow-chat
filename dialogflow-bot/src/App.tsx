import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { bootstrapSession, SERVER_URL } from "./lib/chatClient";
import type { ChatMessage, ChatState } from "./lib/chatClient";

const STORAGE_KEY = "dialogflow-chat-session";

type SessionState = {
  token: string;
  userId: string;
  displayName: string;
  email: string;
};

type SocketStatus = "booting" | "connecting" | "connected" | "disconnected";

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
  if (status === "connected") return "Online";
  if (status === "connecting") return "Connecting";
  if (status === "disconnected") return "Offline";
  return bootMessage;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as SessionState;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function App() {
  const socketRef = useRef<Socket | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(false);
  const isBootingRef = useRef(false);

  const [session, setSession] = useState<SessionState | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("booting");
  const [bootMessage, setBootMessage] = useState("Preparing chat...");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

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

  const resetSession = () => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;

    window.localStorage.removeItem(STORAGE_KEY);
    setSession(null);
    setChat(null);
    setComposerValue("");
    setNameValue("");
    setEmailValue("");
    setErrorMessage("");
    setSocketStatus("disconnected");
    setBootMessage("Waiting for your details...");
  };

  useEffect(() => {
    isMountedRef.current = true;

    const boot = async () => {
      if (isBootingRef.current) {
        return;
      }

      try {
        isBootingRef.current = true;
        setBootMessage("Checking for an existing session...");

        const storedSession = readStoredSession();

        if (!storedSession?.userId) {
          setBootMessage("Waiting for your details...");
          setSocketStatus("disconnected");
          return;
        }

        setNameValue(storedSession.displayName || "");
        setEmailValue(storedSession.email || "");

        const bootstrap = await bootstrapSession({
          userId: storedSession.userId,
          displayName: storedSession.displayName || "Guest User",
          email: storedSession.email,
        });

        if (!isMountedRef.current) {
          return;
        }

        const nextSession = {
          token: bootstrap.token,
          userId: bootstrap.user.externalId,
          displayName: bootstrap.user.displayName || storedSession.displayName,
          email: bootstrap.user.email || storedSession.email || "",
        };

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
        setChat(bootstrap.chat);
        setNameValue(nextSession.displayName);
        setEmailValue(nextSession.email);
        setSocketStatus("connecting");
        setBootMessage("Chat ready");
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        resetSession();
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to restore your session",
        );
      } finally {
        isBootingRef.current = false;
      }
    };

    void boot();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      auth: {
        token: session.token,
      },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketStatus("connected");
      setErrorMessage("");
      socket.emit("chat:join", {
        userId: session.userId,
        profile: {
          displayName: session.displayName,
          email: session.email,
        },
      });
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
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [chat?.messages]);

  const handleSend = async (messageText: string) => {
    const trimmedMessage = messageText.trim();

    if (
      !trimmedMessage ||
      !session ||
      !socketRef.current ||
      isSending ||
      socketStatus !== "connected"
    ) {
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
            email: session.email,
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

  const handleStartSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const displayName = nameValue.trim();
    const email = emailValue.trim().toLowerCase();

    if (!displayName) {
      setErrorMessage("Please enter your name to start the chat.");
      return;
    }

    if (!email || !isValidEmail(email)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsCreatingSession(true);
    setErrorMessage("");
    setSocketStatus("booting");
    setBootMessage("Creating your chat session...");

    try {
      const bootstrap = await bootstrapSession({
        displayName,
        email,
      });

      const nextSession = {
        token: bootstrap.token,
        userId: bootstrap.user.externalId,
        displayName: bootstrap.user.displayName || displayName,
        email: bootstrap.user.email || email,
      };

      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setChat(bootstrap.chat);
      setNameValue(nextSession.displayName);
      setEmailValue(nextSession.email);
      setSocketStatus("connecting");
      setBootMessage("Chat ready");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to create session",
      );
      setSocketStatus("disconnected");
    } finally {
      setIsCreatingSession(false);
    }
  };

  const latestMessageAt = chat?.lastMessageAt
    ? `${formatDate(chat.lastMessageAt)} at ${formatTime(chat.lastMessageAt)}`
    : "No messages yet";
  const sessionReady = Boolean(session);

  return (
    <div className="app-shell">
      <section className="chat-card">
        <header className="chat-card-header">
          <div>
            <p className="chat-kicker">Support Chat</p>
            <h1>How can we help?</h1>
            <p className="chat-subcopy">
              Start a conversation with our assistant and keep your session tied
              to your name and email.
            </p>
          </div>

          <div className="chat-card-meta">
            <div className={`status-pill ${socketStatus}`}>
              <span className="status-dot" />
              <span>{statusLabel(socketStatus, bootMessage)}</span>
            </div>
            {sessionReady ? (
              <button
                className="ghost-button"
                type="button"
                onClick={resetSession}
              >
                New session
              </button>
            ) : null}
          </div>
        </header>

        {session ? (
          <div className="session-bar">
            <div>
              <strong>{session.displayName}</strong>
              <span>{session.email}</span>
            </div>
            <p>Last activity: {latestMessageAt}</p>
          </div>
        ) : null}

        <div className="message-stream" ref={streamRef}>
          {!sessionReady ? (
            <section className="welcome-panel">
              <div className="welcome-copy">
                <h2>Before we begin</h2>
                <p>
                  Enter your name and email to create your chat session and keep
                  the conversation connected to the backend.
                </p>
              </div>

              <form className="intake-form" onSubmit={handleStartSession}>
                <label className="field">
                  <span>Name</span>
                  <input
                    type="text"
                    placeholder="Your full name"
                    value={nameValue}
                    onChange={(event) => setNameValue(event.target.value)}
                  />
                </label>

                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={emailValue}
                    onChange={(event) => setEmailValue(event.target.value)}
                  />
                </label>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={isCreatingSession}
                >
                  {isCreatingSession ? "Creating session..." : "Start chat"}
                </button>
              </form>
            </section>
          ) : null}

          {errorMessage ? <div className="system-banner">{errorMessage}</div> : null}

          {sessionReady && !chat?.messages.length ? (
            <div className="empty-state">
              <h2>Chat is ready</h2>
              <p>Send a message below to start the conversation.</p>
            </div>
          ) : null}

          {chat?.messages.map((message) => (
            <article
              className={`message ${message.senderRole === "server" ? "bot" : "user"}`}
              key={message.id}
            >
              <div className="message-meta">
                <span className="author">
                  {message.senderRole === "server" ? "Support Bot" : "You"}
                </span>
                <span>{formatTime(message.createdAt)}</span>
              </div>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <textarea
            placeholder={
              sessionReady
                ? "Write your message..."
                : "Start a session to begin chatting..."
            }
            rows={1}
            value={composerValue}
            onChange={(event) => setComposerValue(event.target.value)}
            disabled={!sessionReady}
          />
          <button
            className="primary-button send-button"
            type="submit"
            disabled={!sessionReady || isSending || socketStatus !== "connected"}
          >
            {isSending ? "Sending..." : "Send"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default App;
