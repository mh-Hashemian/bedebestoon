import { TelegramNotifyService } from './telegram-notify.service';

/**
 * Transport-level tests: the service must shape the sendMessage request
 * correctly and NEVER throw into the caller's request path.
 */
describe('TelegramNotifyService', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  function makeService(
    opts: { telegramId?: bigint | null; token?: string } = {},
  ) {
    const prismaMock = {
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ select }: { select?: object }) => {
            if (select && 'telegramId' in select) {
              return Promise.resolve(
                opts.telegramId === null
                  ? null
                  : { telegramId: opts.telegramId ?? 424242n },
              );
            }
            return Promise.resolve({
              firstName: 'محمد',
              lastName: 'هاشمیان',
            });
          }),
      },
    };
    const configMock = {
      get: jest.fn((key: string) =>
        key === 'BOT_TOKEN' ? (opts.token ?? 'test-token') : undefined,
      ),
    };
    const service = new TelegramNotifyService(
      prismaMock as never,
      configMock as never,
    );
    return { service, prismaMock };
  }

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('sends a DM with an open-app button', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { service } = makeService();
    await service.notifyUser('u2', 'سلام');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const body = JSON.parse(init.body) as {
      chat_id: number;
      text: string;
      reply_markup: {
        inline_keyboard: { web_app: { url: string } }[][];
      };
    };
    expect(body.chat_id).toBe(424242);
    expect(body.text).toBe('سلام');
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toContain(
      'bedebestoon.onrender.com',
    );
  });

  it('retries plain when the button form is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const { service } = makeService();
    await service.notifyUser('u2', 'متن');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body2 = JSON.parse(
      (fetchMock.mock.calls[1][1] as { body: string }).body,
    ) as { reply_markup?: unknown };
    expect(body2.reply_markup).toBeUndefined();
  });

  it('swallows network failures', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { service } = makeService();
    await expect(service.notifyUser('u2', 'x')).resolves.toBeUndefined();
  });

  it('does nothing without a bot token', async () => {
    const { service } = makeService({ token: '' });
    await service.notifyUser('u2', 'x');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown user', async () => {
    const { service } = makeService({ telegramId: null });
    await service.notifyUser('ghost', 'x');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves a user's display name", async () => {
    const { service } = makeService();
    await expect(service.nameOf('u1')).resolves.toBe('محمد هاشمیان');
  });
});
