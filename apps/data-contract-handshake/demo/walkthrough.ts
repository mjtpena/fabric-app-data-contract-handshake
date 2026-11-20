import type { DemoScript } from '@x10/shared/demo';

const NEW_TITLE = 'Hash the email column';

/** "YYYY-MM-DD" for an <input type="date">, `days` from today in local time. */
function dayInput(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const script: DemoScript = {
  title: 'Data Contract Handshake: every schema change as a train, every consumer team as a station',
  persona: 'demo-admin',
  scenes: [
    {
      id: 'hook',
      say: [
        'Schema changes break reports when the teams downstream never read the email.',
        'This Fabric app draws every data contract as a transit line, and every consumer team as a station on it.',
      ],
      async run(h) {
        await h.goto('/', 'demo-admin');
        await h.pause(1500);
        await h.spotlight(h.page.getByTestId('metro-map'), 3000);
        await h.hover(h.page.locator('[data-testid="map-station"][data-station="Marketing Insights"]').getByTestId('station-marker'));
        await h.pause(1500);
      },
    },
    {
      id: 'trains',
      say: [
        "Each change notice is a train at its producer's terminal, and it departs on the effective date.",
        'Amber pulses are signals still travelling to teams that have not answered yet.',
      ],
      async run(h) {
        await h.hover(h.page.getByTestId('train-body').first());
        await h.pause(2500);
        await h.spotlight(h.page.getByTestId('next-departure'), 2500);
      },
    },
    {
      id: 'lenses',
      say: [
        'Lenses repaint the same map.',
        'By change type, breaking changes run red; by departure, the trains count down to their date.',
      ],
      async run(h) {
        const lenses = h.page.getByRole('radiogroup', { name: 'Lens' });
        await h.click(lenses.getByRole('radio', { name: /Type/ }));
        await h.pause(2500);
        await h.click(lenses.getByRole('radio', { name: /Departs/ }));
        await h.pause(2500);
      },
    },
    {
      id: 'today',
      say: [
        'The Today panel ranks what needs attention, and one click flies the map to it.',
        'This breaking rename departs in five days, and two stations still show a pending signal.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /Final call: Rename order_total/ }));
        await h.pause(1500);
        await h.spotlight(h.page.getByTestId('focus-card'), 3500);
      },
    },
    {
      id: 'view-as',
      say: ['View as one consumer team, and only the lines that stop at its station stay lit.'],
      async run(h) {
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Team' }));
        await h.select(h.page.getByLabel('Team'), 'Marketing Insights');
        await h.pause(3000);
      },
    },
    {
      id: 'departures',
      say: ['The departures board lists every running service, with a signal lamp for each team that has to answer.'],
      async run(h) {
        await h.goto('/departures');
        // let every flap settle on camera before the spotlight
        await h.page.waitForFunction(() => !document.querySelector('[data-settled="false"]'), undefined, { timeout: 8000 });
        await h.pause(1200);
        await h.spotlight(h.page.getByTestId('departures-board'), 3500);
      },
    },
    {
      id: 'timetable',
      say: [
        'Now I am the producer, and I need to hash the email column on the customer dimension.',
        'The preview shows the row exactly as it will appear on the board.',
      ],
      async run(h) {
        await h.goto('/lines', 'demo-producer');
        await h.click(h.page.getByRole('link', { name: 'Customer dimension' }));
        await h.click(h.page.getByRole('button', { name: 'Announce a change' }));
        await h.type(h.page.getByLabel('Title'), NEW_TITLE);
        await h.click(h.page.getByRole('radiogroup', { name: 'Change type' }).getByText('Breaking', { exact: true }));
        await h.fill(
          h.page.getByLabel('Description'),
          'email is replaced by email_hash (SHA-256) so the warehouse holds no raw addresses. Join on email_hash instead.',
        );
        await h.fill(h.page.getByLabel('Effective date'), dayInput(10));
        await h.spotlight(h.page.getByRole('complementary', { name: 'Preview' }), 2500);
        await h.click(h.page.getByRole('button', { name: 'Save draft' }));
        await h.pause(800);
      },
    },
    {
      id: 'publish',
      say: ['Publishing sets a pending signal at every station on the line, exactly once, even if it is retried.'],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: 'Publish' }));
        await h.click(h.page.getByRole('dialog').getByRole('button', { name: 'Publish' }));
        await h.scrollTo(h.page.getByTestId('route-strip'));
        await h.spotlight(h.page.getByTestId('route-strip'), 3000);
      },
    },
    {
      id: 'object',
      say: [
        'In the marketing signal box, Chen cannot take this change yet and objects with a note.',
        'The service is now held at the signal until the producer responds.',
      ],
      async run(h) {
        await h.goto('/inbox', 'demo-marketing');
        const item = h.page.getByTestId('inbox-item').filter({ hasText: NEW_TITLE });
        await h.click(item.getByRole('button', { name: 'Object for Marketing Insights' }));
        const dialog = h.page.getByRole('dialog');
        await h.type(dialog.getByLabel('Objection note'), 'Our audience exports match on raw email. We need two more weeks.');
        await h.click(dialog.getByRole('button', { name: 'Record objection' }));
        await h.goto('/departures');
        await h.page.waitForFunction(() => !document.querySelector('[data-settled="false"]'), undefined, { timeout: 8000 });
        await h.pause(800);
        await h.spotlight(h.page.getByTestId('departure-row').filter({ hasText: NEW_TITLE }), 3000);
      },
    },
    {
      id: 'takeaway',
      say: ['Every consumer shakes hands before the train leaves, and everyone can see who has not.'],
      async run(h) {
        await h.goto('/');
        await h.pause(4000);
      },
    },
  ],
};
