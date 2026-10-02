// @spec DFF-UI-193
// @spec DFF-UI-194
// @spec DFF-UI-195
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  DraftConfigScreen,
  configDefaults,
  type ConfigFormState,
} from '../src/ui/components/DraftConfigScreen.js';

const fetchMock = vi.fn<typeof fetch>();

// @spec DFF-UI-193
// @spec DFF-UI-194
function ConfigScreenHarness() {
  const [config, setConfig] = useState<ConfigFormState>(configDefaults);

  return (
    <DraftConfigScreen
      config={config}
      isSubmitting={false}
      onConfigChange={setConfig}
      onStartDraft={async () => undefined}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Sleeper Config Screen import', () => {
  // @spec DFF-UI-193
  // @spec DFF-UI-194
  test('pre-fills imported settings from a full Sleeper URL, derives rounds from roster slots, and keeps the form editable', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response(JSON.stringify({
      teamCount: 10,
      scoringFormat: 'half_ppr',
      tePremiumTier: 'tep',
      rosterConfig: {
        QB: 1,
        RB: 2,
        WR: 3,
        TE: 1,
        FLEX: 1,
        SF: 1,
        bench: 9,
      },
    }), { status: 200 })));

    render(<ConfigScreenHarness />);

    await user.type(screen.getByLabelText(/sleeper league id or url/i), 'https://sleeper.app/leagues/123456789012345678?season=2026');
    await user.click(screen.getByRole('button', { name: /import sleeper settings/i }));

    expect(fetchMock).toHaveBeenCalledWith('/league-imports/sleeper/123456789012345678');
    expect(await screen.findByLabelText(/team count/i)).toHaveValue(10);
    expect(screen.getByLabelText(/scoring format/i)).toHaveValue('half_ppr');
    expect(screen.getByLabelText(/te premium/i)).toHaveValue('tep');
    expect(screen.getByLabelText(/^qb$/i)).toHaveValue(1);
    expect(screen.getByLabelText(/^bn$/i)).toHaveValue(9);
    expect(screen.getByLabelText(/rounds/i)).toHaveValue(18);

    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '12');

    expect(screen.getByLabelText(/team count/i)).toHaveValue(12);
  });

  // @spec DFF-UI-195
  test('shows an import error and preserves manual configuration when Sleeper fetch fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'not found' }), { status: 404 })));

    render(<ConfigScreenHarness />);
    await user.type(screen.getByLabelText(/sleeper league id or url/i), '123456789012345678');
    await user.click(screen.getByRole('button', { name: /import sleeper settings/i }));

    expect(await screen.findByText(/could not import sleeper league settings/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/team count/i)).toHaveValue(12);

    await user.clear(screen.getByLabelText(/team count/i));
    await user.type(screen.getByLabelText(/team count/i), '10');

    expect(screen.getByLabelText(/team count/i)).toHaveValue(10);
  });
});
