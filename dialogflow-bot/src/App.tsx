import './App.css'

type Message = {
  id: number
  author: 'bot' | 'user' | 'system'
  text: string
  time: string
  chips?: string[]
}

type Activity = {
  label: string
  value: string
  detail: string
}

const messages: Message[] = [
  {
    id: 1,
    author: 'system',
    text: 'Session initialized for support agent routing in Dialogflow ES.',
    time: '09:41',
  },
  {
    id: 2,
    author: 'bot',
    text: 'Hello Ayesha, I can help with orders, refunds, store hours, and handoff to a live agent. What would you like to do?',
    time: '09:42',
    chips: ['Track order', 'Start refund', 'Talk to support'],
  },
  {
    id: 3,
    author: 'user',
    text: 'I need to reschedule a delivery for tomorrow morning.',
    time: '09:43',
  },
  {
    id: 4,
    author: 'bot',
    text: 'I found order #DF-2048 scheduled for April 23. I can move it to 1:00 PM to 3:00 PM or 5:00 PM to 7:00 PM.',
    time: '09:43',
    chips: ['1:00 PM - 3:00 PM', '5:00 PM - 7:00 PM'],
  },
  {
    id: 5,
    author: 'user',
    text: 'Please switch it to the evening slot and send me a confirmation text.',
    time: '09:44',
  },
  {
    id: 6,
    author: 'bot',
    text: 'Done. Your delivery is now set for April 23, 5:00 PM to 7:00 PM. A confirmation SMS has been triggered to the number ending in 2217.',
    time: '09:44',
  },
]

const activity: Activity[] = [
  {
    label: 'Intent match',
    value: 'Delivery.Reschedule',
    detail: 'Confidence 0.94 with fulfillment webhook success',
  },
  {
    label: 'Fallback rate',
    value: '1.8%',
    detail: 'Healthy trend over the last 7 days',
  },
  {
    label: 'Avg response',
    value: '1.2s',
    detail: 'Webhook latency remains inside SLA',
  },
]

const quickActions = [
  'Order status',
  'Refund policy',
  'Store hours',
  'Escalate to human',
]

const knowledgeCards = [
  {
    title: 'Agent Health',
    text: '24 intents, 6 entities, webhook online, sentiment capture enabled.',
  },
  {
    title: 'Handoff Logic',
    text: 'Escalate automatically after 2 fallbacks or when urgency sentiment is high.',
  },
  {
    title: 'Training Notes',
    text: 'Recent phrases improved delivery and billing coverage for multilingual prompts.',
  },
]

function App() {
  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Dialogflow ES Workspace</p>
          <h1>Conversational Console</h1>
        </div>

        <div className="topbar-status">
          <div className="status-pill">
            <span className="status-dot" />
            Agent online
          </div>
          <button className="ghost-button" type="button">
            Publish draft
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel overview-panel">
          <section className="hero-card">
            <p className="section-label">Customer support bot</p>
            <h2>Designed to answer quickly, clarify intent, and escalate gracefully.</h2>
            <p>
              A focused control surface for monitoring sessions, reviewing intents,
              and shaping a more trustworthy chatbot experience.
            </p>

            <div className="hero-metrics">
              <div>
                <strong>92%</strong>
                <span>Containment</span>
              </div>
              <div>
                <strong>4.8/5</strong>
                <span>CSAT</span>
              </div>
            </div>
          </section>

          <section className="stack">
            <div className="section-header">
              <h3>Live diagnostics</h3>
              <span>Updated now</span>
            </div>

            <div className="activity-list">
              {activity.map((item) => (
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
              <span>One-tap actions</span>
            </div>

            <div className="quick-actions">
              {quickActions.map((action) => (
                <button className="quick-action" key={action} type="button">
                  {action}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="panel chat-panel">
          <div className="chat-header">
            <div>
              <p className="section-label">Conversation preview</p>
              <h2>Delivery support flow</h2>
            </div>

            <div className="chat-badges">
              <span>Webhook active</span>
              <span>SMS enabled</span>
              <span>English</span>
            </div>
          </div>

          <div className="message-stream">
            {messages.map((message) => (
              <article className={`message ${message.author}`} key={message.id}>
                <div className="message-meta">
                  <span className="author">
                    {message.author === 'bot'
                      ? 'Bot'
                      : message.author === 'user'
                        ? 'Customer'
                        : 'System'}
                  </span>
                  <span>{message.time}</span>
                </div>

                <p>{message.text}</p>

                {message.chips ? (
                  <div className="chips">
                    {message.chips.map((chip) => (
                      <button key={chip} type="button">
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <form className="composer">
            <label className="composer-field">
              <span>Test the bot</span>
              <textarea
                placeholder="Type a user message to simulate intent detection and fulfillment..."
                rows={3}
              />
            </label>

            <div className="composer-actions">
              <div className="composer-options">
                <button type="button">Attach context</button>
                <button type="button">Inject payload</button>
              </div>

              <button className="primary-button" type="submit">
                Send test message
              </button>
            </div>
          </form>
        </section>

        <aside className="panel insights-panel">
          <section className="stack">
            <div className="section-header">
              <h3>Knowledge hub</h3>
              <span>Bot readiness</span>
            </div>

            <div className="knowledge-grid">
              {knowledgeCards.map((card) => (
                <article className="knowledge-card" key={card.title}>
                  <h4>{card.title}</h4>
                  <p>{card.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="stack transcript-card">
            <div className="section-header">
              <h3>Experience checklist</h3>
              <span>Human-centered</span>
            </div>

            <ul>
              <li>Clear welcome copy with guided choices</li>
              <li>Visible confidence and fallback monitoring</li>
              <li>Fast escalation path to a live support team</li>
              <li>Responsive layout for desktop and tablet review</li>
            </ul>
          </section>

          <section className="stack mini-chart">
            <div className="section-header">
              <h3>Intent distribution</h3>
              <span>Today</span>
            </div>

            <div className="bars">
              <div>
                <label>Orders</label>
                <span style={{ width: '82%' }} />
              </div>
              <div>
                <label>Billing</label>
                <span style={{ width: '54%' }} />
              </div>
              <div>
                <label>Refunds</label>
                <span style={{ width: '36%' }} />
              </div>
              <div>
                <label>Fallbacks</label>
                <span style={{ width: '12%' }} />
              </div>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App
