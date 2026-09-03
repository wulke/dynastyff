// @spec DFF-DEVY-040
// @spec DFF-DEVY-041
// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';

import { DevyView } from '../src/ui/components/DevyView.js';

afterEach(cleanup);

const players = [
  { id: 'a', name: 'Alpha QB', position: 'QB' as const, school: 'Georgia', schoolCode: 'UGA', draftYear: 2028, valueSuperflex: 9000, valueOneQb: 8000 },
  { id: 'b', name: 'Bravo WR', position: 'WR' as const, school: 'Ohio State', schoolCode: 'OSU', draftYear: 2027, valueSuperflex: 8000, valueOneQb: 9000 },
];

// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
test('DevyView distinguishes college data and filters/sorts it client-side', async () => {
  const user = userEvent.setup();
  render(<DevyView players={players} />);

  expect(screen.getByText(/college devy values/i)).toBeInTheDocument();
  expect(screen.getAllByText('DEVY')).toHaveLength(2);
  expect(screen.getByRole('row', { name: /1Alpha QB/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /1qb/i }));
  expect(screen.getByRole('row', { name: /1Bravo WR/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'WR' }));
  expect(screen.queryByText('Alpha QB')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', { name: /school/i }), 'Ohio');
  expect(screen.getByText('Bravo WR')).toBeInTheDocument();
});

// @spec DFF-DEVY-045
test('DevyView renders an empty state for an empty snapshot array', () => {
  render(<DevyView players={[]} />);
  expect(screen.getByText(/no devy players are available/i)).toBeInTheDocument();
});
