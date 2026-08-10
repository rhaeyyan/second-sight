import { describe, it, expect, vi } from 'vitest';
import { fetchPost, summarizeChannelHealth } from './route';

const MOCK_NOW = 1_760_000_000_000;

function embedHtml(text: string, datetime = '2024-01-01T00:00:00+00:00'): string {
  return `<div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div><time datetime="${datetime}">Jan 1</time>`;
}

function fakeResponse(status: number, body = ''): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('fetchPost', () => {
  it('parses text and date out of the embed HTML and reports found', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(200, embedHtml('Strike reported near border')));

    const result = await fetchPost('test-channel-found', 100, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'found', text: 'Strike reported near border', date: '2024-01-01T00:00:00+00:00' });
  });

  it('strips HTML tags and decodes entities from the message body', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      fakeResponse(200, embedHtml('Forces &amp; equipment moved<br>near the border &quot;overnight&quot;'))
    );

    const result = await fetchPost('test-channel-entities', 100, fetchImpl as unknown as typeof fetch);

    expect(result).toMatchObject({ status: 'found', text: 'Forces & equipment moved near the border "overnight"' });
  });

  it('reports not-found on a 404 (empty slot during binary search)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(404));

    const result = await fetchPost('test-channel-404', 999999, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'not-found' });
  });

  it('reports not-found when the response has no message text block', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(200, '<div>not an embed</div>'));

    const result = await fetchPost('test-channel-noblock', 1, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'not-found' });
  });

  it('reports rate-limited on a 429, not not-found', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(429));

    const result = await fetchPost('test-channel-429', 1, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('reports unavailable on other non-ok statuses', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(503));

    const result = await fetchPost('test-channel-503', 1, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('reports unavailable when the fetch throws (timeout/network)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network unreachable'));

    const result = await fetchPost('test-channel-throw', 1, fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({ status: 'unavailable' });
  });
});

describe('summarizeChannelHealth', () => {
  it('reports healthy when at least one post was found', () => {
    const health = summarizeChannelHealth(['found', 'not-found', 'not-found'], 'telegram:test', MOCK_NOW);
    expect(health).toEqual({ sourceId: 'telegram:test', status: 'healthy', lastAttemptAt: MOCK_NOW, lastSuccessAt: MOCK_NOW });
  });

  it('reports healthy when nothing new was found but the channel was reachable', () => {
    const health = summarizeChannelHealth(['not-found', 'not-found', 'not-found'], 'telegram:test', MOCK_NOW);
    expect(health.status).toBe('healthy');
  });

  it('reports rate-limited if any probe hit a 429, even if others succeeded', () => {
    const health = summarizeChannelHealth(['found', 'rate-limited', 'not-found'], 'telegram:test', MOCK_NOW);
    expect(health.status).toBe('rate-limited');
  });

  it('reports unavailable only when every probe failed to reach the channel at all', () => {
    const health = summarizeChannelHealth(['unavailable', 'unavailable', 'unavailable'], 'telegram:test', MOCK_NOW);
    expect(health.status).toBe('unavailable');
  });

  it('does not report unavailable if even one probe got a trustworthy answer', () => {
    const health = summarizeChannelHealth(['unavailable', 'unavailable', 'not-found'], 'telegram:test', MOCK_NOW);
    expect(health.status).toBe('healthy');
  });
});
