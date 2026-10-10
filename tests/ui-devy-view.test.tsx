// @spec DFF-DEVY-040
// @spec DFF-DEVY-041
// @spec DFF-DEVY-042
// @spec DFF-DEVY-043
// @spec DFF-DEVY-044
// @spec DFF-DEVY-045
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

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

// @spec DFF-DVR-004
// @spec DFF-DVR-005
// @spec DFF-DVR-007
test('DevyView shows the owning Sleeper team or an unowned indicator when ownership is provided', () => {
  render(<DevyView players={players} ownership={{ a: 'Trev Squad' }} />);

  expect(screen.getByText('Owner')).toBeInTheDocument();
  expect(screen.getByText('Trev Squad')).toBeInTheDocument();
  expect(screen.getByText('Unowned')).toBeInTheDocument();
});

// @spec DFF-DVR-006
test('DevyView shows an unknown indicator for every row when ownership is unavailable', () => {
  render(<DevyView players={players} ownership={null} />);

  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.queryByText('Unowned')).not.toBeInTheDocument();
});

// @spec DFF-DVR-007
// @spec DFF-DVR-014
test('DevyView hides owner and notes columns when neither prop is provided', () => {
  render(<DevyView players={players} />);

  expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /notes:/i })).not.toBeInTheDocument();
});

// @spec DFF-DVR-008
// @spec DFF-DVR-009
// @spec DFF-DVR-010
test('DevyView opens the notes modal, saves a note, and highlights noted rows', async () => {
  const user = userEvent.setup();
  const onSaveNote = vi.fn(async () => {});
  render(<DevyView players={players} ownership={{ a: 'Trev Squad' }} notes={{ a: 'Saved note' }} onSaveNote={onSaveNote} />);

  // Row 'a' has a saved note → highlighted; row 'b' does not.
  const noted = screen.getByRole('button', { name: /notes: alpha qb/i });
  expect(noted.className).toContain('text-accent');
  expect(screen.getByRole('button', { name: /notes: bravo wr/i }).className).not.toContain('text-accent');

  await user.click(screen.getByRole('button', { name: /notes: bravo wr/i }));

  const dialog = screen.getByRole('dialog', { name: /notes: bravo wr/i });
  expect(dialog).toBeInTheDocument();

  await user.type(screen.getByRole('textbox', { name: /note/i }), 'Elite YAC, watch 2027 camp');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(onSaveNote).toHaveBeenCalledWith('b', 'Elite YAC, watch 2027 camp');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// @spec DFF-DVR-011
test('DevyView prefills the modal with the saved note and deletes it via the delete button', async () => {
  const user = userEvent.setup();
  const onSaveNote = vi.fn(async () => {});
  render(<DevyView players={players} notes={{ a: 'Saved note' }} onSaveNote={onSaveNote} />);

  await user.click(screen.getByRole('button', { name: /notes: alpha qb/i }));
  expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('Saved note');

  await user.click(screen.getByRole('button', { name: /delete/i }));

  expect(onSaveNote).toHaveBeenCalledWith('a', '');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

// @spec DFF-DVR-008
test('DevyView closes the notes modal on cancel without saving', async () => {
  const user = userEvent.setup();
  const onSaveNote = vi.fn(async () => {});
  render(<DevyView players={players} onSaveNote={onSaveNote} />);

  await user.click(screen.getByRole('button', { name: /notes: alpha qb/i }));
  await user.type(screen.getByRole('textbox', { name: /note/i }), 'draft text');
  await user.click(screen.getByRole('button', { name: /cancel/i }));

  expect(onSaveNote).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
