// @spec DFF-UI-040
// @spec DFF-UI-041
// @spec DFF-UI-042
// @spec DFF-UI-043
// @spec DFF-UI-044
// @spec DFF-UI-045
// @spec DFF-UI-046
// @spec DFF-UI-047
// @spec DFF-UI-048
// @spec DFF-UI-081
// @spec DFF-UI-085
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useDraftContext } from '../context/DraftContext.js';

type AdvisorPanelProps = {
  draftId: string;
  isOpen: boolean;
};

type AdvisorTab = 'advise' | 'grill';

type AdviceResponse = {
  recommendation: string;
  keyFactors: string[];
  caveats: string[];
};

type ChatMessage = {
  id: string;
  role: 'user' | 'advisor';
  content: string;
};

const ADVISOR_ERROR_MESSAGE = 'Advisor unavailable. Try again.';

// @spec DFF-UI-043
// @spec DFF-UI-044
function isAdviceResponse(payload: unknown): payload is AdviceResponse {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<AdviceResponse>;
  return (
    typeof candidate.recommendation === 'string' &&
    Array.isArray(candidate.keyFactors) &&
    candidate.keyFactors.every((factor) => typeof factor === 'string') &&
    Array.isArray(candidate.caveats) &&
    candidate.caveats.every((caveat) => typeof caveat === 'string')
  );
}

// @spec DFF-UI-047
function parseChatMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as { message?: unknown; response?: unknown };

  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return candidate.message;
  }

  if (typeof candidate.response === 'string' && candidate.response.trim()) {
    return candidate.response;
  }

  return null;
}

// @spec DFF-UI-047
// @spec DFF-UI-048
function createMessageId(role: ChatMessage['role']): string {
  return `${role}-${crypto.randomUUID()}`;
}

// @spec DFF-UI-040
// @spec DFF-UI-041
// @spec DFF-UI-042
// @spec DFF-UI-043
// @spec DFF-UI-044
// @spec DFF-UI-045
// @spec DFF-UI-046
// @spec DFF-UI-047
// @spec DFF-UI-048
// @spec DFF-UI-081
// @spec DFF-UI-085
export function AdvisorPanel({ draftId, isOpen }: AdvisorPanelProps) {
  const { draftState, showToast } = useDraftContext();
  const [activeTab, setActiveTab] = useState<AdvisorTab>('advise');
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [isAdviceLoading, setIsAdviceLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftReasoning, setDraftReasoning] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const resetVersionRef = useRef(0);
  const yourTurnVersionRef = useRef(0);

  const advisorResetVersion = draftState?.advisorResetVersion ?? 0;
  const yourTurnVersion = draftState?.yourTurnVersion ?? 0;

  useEffect(() => {
    if (yourTurnVersionRef.current === yourTurnVersion) {
      return;
    }

    yourTurnVersionRef.current = yourTurnVersion;
    setAdvice(null);
  }, [yourTurnVersion]);

  useEffect(() => {
    if (resetVersionRef.current === advisorResetVersion) {
      return;
    }

    resetVersionRef.current = advisorResetVersion;
    setMessages([]);
    setDraftReasoning('');
    setIsChatLoading(false);

    void (async () => {
      try {
        await fetch(`/drafts/${draftId}/advisor/chat`, {
          method: 'DELETE',
        });
      } catch {
        showToast(ADVISOR_ERROR_MESSAGE);
      }
    })();
  }, [advisorResetVersion, draftId, showToast]);

  async function handleAdviseMe() {
    if (isAdviceLoading) {
      return;
    }

    setIsAdviceLoading(true);

    try {
      const response = await fetch(`/drafts/${draftId}/advisor/advise`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Advisor request failed.');
      }

      const payload = await response.json();

      if (!isAdviceResponse(payload)) {
        throw new Error('Advisor payload was invalid.');
      }

      setAdvice(payload);
    } catch {
      showToast(ADVISOR_ERROR_MESSAGE);
    } finally {
      setIsAdviceLoading(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = draftReasoning.trim();

    if (!message || isChatLoading) {
      return;
    }

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createMessageId('user'),
        role: 'user',
        content: message,
      },
    ]);
    setDraftReasoning('');
    setIsChatLoading(true);

    try {
      const response = await fetch(`/drafts/${draftId}/advisor/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok) {
        throw new Error('Advisor chat failed.');
      }

      const payload = await response.json();
      const advisorMessage = parseChatMessage(payload);

      if (!advisorMessage) {
        throw new Error('Advisor chat payload was invalid.');
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: createMessageId('advisor'),
          role: 'advisor',
          content: advisorMessage,
        },
      ]);
    } catch {
      showToast(ADVISOR_ERROR_MESSAGE);
    } finally {
      setIsChatLoading(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex justify-end">
      <aside
        data-testid="advisor-panel"
        className="pointer-events-auto flex h-[calc(100%-2rem)] w-[23.75rem] translate-x-0 flex-col overflow-hidden rounded-md border border-default bg-surface-raised shadow-sm transition-transform duration-200 ease-out"
      >
        <div className="border-b border-default px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Draft Companion</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <h2 className="font-condensed text-xl font-bold tracking-tight text-primary">Advisor</h2>
            <div className="rounded border border-default px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              Live
            </div>
          </div>
          <div role="tablist" aria-label="Advisor modes" className="mt-3 grid grid-cols-2 gap-1 border-b border-default">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'advise'}
              onClick={() => {
                setActiveTab('advise');
              }}
              className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === 'advise'
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              Advise Me
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'grill'}
              onClick={() => {
                setActiveTab('grill');
              }}
              className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === 'grill'
                  ? 'bg-accent text-accent-fg'
                  : 'text-muted hover:text-secondary'
              }`}
            >
              Grill Me
            </button>
          </div>
        </div>

        {activeTab === 'advise' ? (
          <div className="flex flex-1 flex-col px-3 py-2">
            <button
              type="button"
              onClick={() => {
                void handleAdviseMe();
              }}
              disabled={isAdviceLoading}
              className="inline-flex items-center justify-center gap-2 self-start rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-80"
            >
              Advise Me
            </button>

            {isAdviceLoading ? (
              <div className="mt-3 inline-flex items-center gap-2 rounded border border-default bg-surface px-3 py-2 text-sm text-secondary">
                <span className="h-2.5 w-2.5 animate-pulse rounded bg-accent" />
                <span>Getting recommendation…</span>
              </div>
            ) : null}

            {advice ? (
              <div className="mt-3 space-y-3 overflow-y-auto pr-1">
                <section className="rounded-md border border-default bg-surface p-3">
                  <h3 className="font-condensed text-lg font-semibold text-primary">Recommendation</h3>
                  <p className="mt-2 text-sm font-semibold text-primary">{advice.recommendation}</p>
                </section>

                <section className="rounded-md border border-default bg-surface p-3">
                  <h3 className="font-condensed text-lg font-semibold text-primary">Key Factors</h3>
                  <ul className="mt-2 space-y-1 text-sm leading-5 text-secondary">
                    {advice.keyFactors.map((factor) => (
                      <li key={factor} className="rounded bg-app px-2 py-1">
                        {factor}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-md border border-default bg-surface p-3">
                  <h3 className="font-condensed text-lg font-semibold text-primary">Caveats</h3>
                  <ul className="mt-2 space-y-1 text-sm leading-5 text-secondary">
                    {advice.caveats.map((caveat) => (
                      <li key={caveat} className="rounded bg-app px-2 py-1">
                        {caveat}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              <div className="space-y-2">
                {messages.length === 0 ? (
                  <div className="rounded-md border border-dashed border-default bg-surface px-3 py-3 text-sm leading-5 text-muted">
                    Pressure-test your draft plan. The advisor will challenge assumptions and surface missed trade-offs.
                  </div>
                ) : null}

                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`rounded-md px-3 py-2 text-sm leading-5 ${
                      message.role === 'user'
                        ? 'ml-8 border border-accent bg-accent/10 text-primary'
                        : 'mr-8 border border-default bg-surface text-primary'
                    }`}
                  >
                    <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                      {message.role === 'user' ? 'You' : 'Advisor'}
                    </p>
                    <p>{message.content}</p>
                  </article>
                ))}

                {isChatLoading ? (
                  <div className="mr-8 rounded-md border border-default bg-surface px-3 py-2 text-sm text-secondary">
                    <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
                      Advisor
                    </p>
                    <div className="inline-flex items-center gap-1" aria-label="Advisor is thinking">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <form onSubmit={(event) => void handleChatSubmit(event)} className="border-t border-default px-3 py-2">
              <label htmlFor="advisor-chat-input" className="sr-only">
                Share your reasoning
              </label>
              <textarea
                id="advisor-chat-input"
                value={draftReasoning}
                onChange={(event) => {
                  setDraftReasoning(event.target.value);
                }}
                placeholder="Share your reasoning..."
                rows={3}
                className="w-full resize-none rounded border border-default bg-app px-3 py-2 text-sm text-primary outline-none transition placeholder:text-muted focus:border-strong"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-wide text-muted">Current pick only</p>
                <button
                  type="submit"
                  disabled={isChatLoading || !draftReasoning.trim()}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        )}
      </aside>
    </div>
  );
}
