import { describe, it, expect, vi, afterEach } from 'vitest';
import { callMetaChat } from './meta';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODEL_API_KEY;
});

function stubFetch(body: string, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })));
}

describe('callMetaChat failure classification (fetch stubbed, MOCKED ONLY)', () => {
  it('malformed provider JSON is INVALID_PROVIDER_RESPONSE, not NETWORK_ERROR', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-real';
    stubFetch('not json{');
    const r = await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('INVALID_PROVIDER_RESPONSE');
  });
  it('429 is RATE_LIMIT, 401 is AUTH_OR_ENTITLEMENT, 500 is PROVIDER_5XX', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-real';
    stubFetch('{}', 429);
    expect((await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] })).error).toBe('RATE_LIMIT:429');
    stubFetch('{}', 401);
    expect((await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] })).error).toBe('AUTH_OR_ENTITLEMENT:401');
    stubFetch('{}', 500);
    expect((await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] })).error).toBe('PROVIDER_5XX:500');
  });
  it('valid response computes cost from usage and returns content', async () => {
    process.env.MODEL_API_KEY = 'test-key-not-real';
    stubFetch(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 1000000, completion_tokens: 1000000, total_tokens: 2000000 } }));
    const r = await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('hello');
    expect(r.estimatedCostUsd).toBeCloseTo(5.5, 6);
  });
  it('no key configured fails closed without calling the network', async () => {
    delete process.env.MODEL_API_KEY;
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    vi.stubGlobal('fetch', fetchSpy);
    const r = await callMetaChat({ model: 'muse-spark-1.3', dataClass: 'public', messages: [{ role: 'user', content: 'hi' }] });
    expect(r.error).toBe('MODEL_API_KEY_NOT_CONFIGURED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
