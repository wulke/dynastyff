// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
// @spec DFF-UI-010
// @spec DFF-UI-014
// @spec DFF-UI-015
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { App } from '../src/ui/App.js';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UI app scaffold', () => {
  test('renders the config screen with the expected default draft fields', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/config name/i)).toHaveValue('');
    expect(screen.getByLabelText(/team count/i)).toHaveValue(12);
    expect(screen.getByLabelText(/^rounds$/i)).toHaveValue(20);
    expect(screen.getByLabelText(/scoring format/i)).toHaveValue('ppr');
    expect(screen.getByLabelText(/^qb$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^rb$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/^wr$/i)).toHaveValue(3);
    expect(screen.getByLabelText(/^te$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^flex$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^sf$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^bn$/i)).toHaveValue(6);
    expect(screen.getByLabelText(/pick position/i)).toHaveValue(6);
    expect(screen.getByLabelText(/future pick years/i)).toHaveValue(3);
  });

  test('posts the current form values and transitions to drafting when a draft is created', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.type(screen.getByLabelText(/config name/i), 'Startup Lab');
    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '10');
    await user.selectOptions(screen.getByLabelText(/scoring format/i), 'half_ppr');
    await user.clear(screen.getByLabelText(/^wr$/i));
    await user.type(screen.getByLabelText(/^wr$/i), '4');
    await user.clear(screen.getByLabelText(/pick position/i));
    await user.type(screen.getByLabelText(/pick position/i), '3');
    await user.clear(screen.getByLabelText(/future pick years/i));
    await user.type(screen.getByLabelText(/future pick years/i), '2');
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/drafts',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Startup Lab',
          teamCount: 10,
          rounds: 20,
          scoringFormat: 'half_ppr',
          userPickPosition: 3,
          futurePickYears: 2,
          rosterConfig: {
            QB: 1,
            RB: 2,
            WR: 4,
            TE: 1,
            FLEX: 1,
            SF: 1,
            bench: 6,
          },
        }),
      }),
    );
    expect(
      screen.getByRole('heading', {
        name: /draft shell/i,
      }),
    ).toBeInTheDocument();
  });

  test('shows an error toast and remains on config when draft creation fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /draft creation failed\. check your config and try again\./i,
    );
    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  test('clamps out-of-range numeric values before posting the draft request', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '18');
    await user.clear(screen.getByLabelText(/^rounds$/i));
    await user.type(screen.getByLabelText(/^rounds$/i), '9');
    await user.clear(screen.getByLabelText(/pick position/i));
    await user.type(screen.getByLabelText(/pick position/i), '99');
    await user.clear(screen.getByLabelText(/future pick years/i));
    await user.type(screen.getByLabelText(/future pick years/i), '7');
    await user.clear(screen.getByLabelText(/^wr$/i));
    await user.type(screen.getByLabelText(/^wr$/i), '12');
    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      '/drafts',
      expect.objectContaining({
        body: JSON.stringify({
          name: '',
          teamCount: 16,
          rounds: 10,
          scoringFormat: 'ppr',
          userPickPosition: 16,
          futurePickYears: 5,
          rosterConfig: {
            QB: 1,
            RB: 2,
            WR: 8,
            TE: 1,
            FLEX: 1,
            SF: 1,
            bench: 6,
          },
        }),
      }),
    );
  });

  test('transitions from drafting to history on draft completion', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    await user.click(screen.getByRole('button', { name: /complete draft/i }));

    expect(
      screen.getByRole('heading', {
        name: /history shell/i,
      }),
    ).toBeInTheDocument();
  });

  test('transitions from history back to config when the user starts a new draft', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ draftId: 'draft-123' }), {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));
    await user.click(screen.getByRole('button', { name: /complete draft/i }));
    await user.click(screen.getByRole('button', { name: /new draft/i }));

    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });
});
