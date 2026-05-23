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
        className="pointer-events-auto flex h-[calc(100%-2rem)] w-[23.75rem] flex-col overflow-hidden rounded-[1.75rem] border border-stone-700/80 bg-stone-950/95 shadow-2xl shadow-black/40"
      >
        <div className="border-b border-stone-800 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Draft Companion</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-stone-50">Advisor</h2>
            <div className="rounded-full border border-stone-700 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-400">
              Live
            </div>
          </div>
          <div role="tablist" aria-label="Advisor modes" className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-stone-900 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'advise'}
              onClick={() => {
                setActiveTab('advise');
              }}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === 'advise'
                  ? 'bg-amber-300 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800'
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
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === 'grill'
                  ? 'bg-amber-300 text-stone-950'
                  : 'text-stone-300 hover:bg-stone-800'
              }`}
            >
              Grill Me
            </button>
          </div>
        </div>

        {activeTab === 'advise' ? (
          <div className="flex flex-1 flex-col px-5 py-5">
            <button
              type="button"
              onClick={() => {
                void handleAdviseMe();
              }}
              disabled={isAdviceLoading}
              className="inline-flex items-center justify-center gap-2 self-start rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-80"
            >
              Advise Me
            </button>

            {isAdviceLoading ? (
              <div className="mt-4 inline-flex items-center gap-3 rounded-2xl border border-stone-800 bg-stone-900/80 px-4 py-3 text-sm text-stone-300">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />
                <span>Getting recommendation…</span>
              </div>
            ) : null}

            {advice ? (
              <div className="mt-5 space-y-5 overflow-y-auto pr-1">
                <section className="rounded-[1.25rem] border border-stone-800 bg-stone-900/70 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">Recommendation</h3>
                  <p className="mt-3 text-base font-semibold text-stone-50">{advice.recommendation}</p>
                </section>

                <section className="rounded-[1.25rem] border border-stone-800 bg-stone-900/70 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">Key Factors</h3>
                  <ul className="mt-3 space-y-3 text-sm leading-6 text-stone-200">
                    {advice.keyFactors.map((factor) => (
                      <li key={factor} className="rounded-2xl bg-stone-950/60 px-3 py-2">
                        {factor}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-[1.25rem] border border-stone-800 bg-stone-900/70 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-stone-400">Caveats</h3>
                  <ul className="mt-3 space-y-3 text-sm leading-6 text-stone-200">
                    {advice.caveats.map((caveat) => (
                      <li key={caveat} className="rounded-2xl bg-stone-950/60 px-3 py-2">
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
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-3">
                {messages.length === 0 ? (
                  <div className="rounded-[1.25rem] border border-dashed border-stone-700 bg-stone-900/60 px-4 py-5 text-sm leading-6 text-stone-400">
                    Pressure-test your draft plan. The advisor will challenge assumptions and surface missed trade-offs.
                  </div>
                ) : null}

                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`rounded-[1.25rem] px-4 py-3 text-sm leading-6 ${
                      message.role === 'user'
                        ? 'ml-8 border border-amber-300/20 bg-amber-300/10 text-amber-100'
                        : 'mr-8 border border-stone-800 bg-stone-900/80 text-stone-100'
                    }`}
                  >
                    <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
                      {message.role === 'user' ? 'You' : 'Advisor'}
                    </p>
                    <p>{message.content}</p>
                  </article>
                ))}

                {isChatLoading ? (
                  <div className="mr-8 rounded-[1.25rem] border border-stone-800 bg-stone-900/80 px-4 py-3 text-sm text-stone-300">
                    <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-stone-500">
                      Advisor
                    </p>
                    <div className="inline-flex items-center gap-2">
                      <span>Advisor is thinking…</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <form onSubmit={(event) => void handleChatSubmit(event)} className="border-t border-stone-800 px-5 py-4">
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
                className="w-full resize-none rounded-[1.25rem] border border-stone-700 bg-stone-900/80 px-4 py-3 text-sm text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-300"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.2em] text-stone-500">Current pick only</p>
                <button
                  type="submit"
                  disabled={isChatLoading || !draftReasoning.trim()}
                  className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
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
