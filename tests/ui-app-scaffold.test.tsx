// @spec DFF-UI-001
// @spec DFF-UI-002
// @spec DFF-UI-003
// @spec DFF-UI-004
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';

import { App } from '../src/ui/App.js';

afterEach(() => {
  cleanup();
});

describe('UI app scaffold', () => {
  test('renders the config screen on initial load', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: /config screen/i,
      }),
    ).toBeInTheDocument();
  });

  test('transitions from config to drafting when a draft is created', async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole('button', { name: /start draft/i }));

    expect(
      screen.getByRole('heading', {
        name: /draft shell/i,
      }),
    ).toBeInTheDocument();
  });

  test('transitions from drafting to history on draft completion', async () => {
    const user = userEvent.setup();

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
