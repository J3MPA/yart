import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Review } from './types.ts';
import { createServer } from './server.ts';
import { TestRepo } from './test-repo.ts';

const FOUR_LINES = 'alpha\nbeta\ngamma\ndelta\n';

let repo: TestRepo;
let app: Hono;
let base: string;

beforeEach(() => {
  repo = new TestRepo();
  repo.write('a.txt', FOUR_LINES);
  base = repo.commit('base');
  repo.write('a.txt', 'alpha\nTARGET\ngamma\ndelta\n');
  repo.commit('change');
  app = createServer({ repo_path: repo.path });
});

afterEach(() => {
  repo.dispose();
});

const post = async (path: string, body?: unknown): Promise<Response> => {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

const patch = async (path: string, body: unknown): Promise<Response> => {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
};

const openReview = async (): Promise<Review> => {
  const response = await post('/api/reviews', { base });
  return (await response.json()) as Review;
};

const openReviewWithThread = async (): Promise<{ review: Review; thread_id: string }> => {
  const created = await openReview();
  const response = await post(`/api/reviews/${created.id}/threads`, {
    path: 'a.txt',
    line: 2,
    body: 'why this?',
  });
  const review = (await response.json()) as Review;
  return { review, thread_id: review.threads[0]?.id as string };
};

describe('health', () => {
  it('reports the repository it is serving', async () => {
    const body = (await (await app.request('/health')).json()) as { repo_path: string };
    expect(body.repo_path).toBe(repo.path);
  });
});

describe('POST /api/reviews', () => {
  it('creates a review and returns 201', async () => {
    const response = await post('/api/reviews', { base });
    expect(response.status).toBe(201);
    const review = (await response.json()) as Review;
    expect(review.files.map((file) => file.path)).toEqual(['a.txt']);
  });

  it('rejects a missing base', async () => {
    expect((await post('/api/reviews', {})).status).toBe(400);
  });

  it('reports an unknown revision as a bad request, not a server error', async () => {
    expect((await post('/api/reviews', { base: 'no-such-rev' })).status).toBe(400);
  });
});

describe('GET /api/reviews', () => {
  it('lists created reviews', async () => {
    const created = await openReview();
    const listed = (await (await app.request('/api/reviews')).json()) as Review[];
    expect(listed.map((review) => review.id)).toContain(created.id);
  });

  it('returns the review by id', async () => {
    const created = await openReview();
    const response = await app.request(`/api/reviews/${created.id}`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as Review).id).toBe(created.id);
  });

  it('returns 404 for an unknown review', async () => {
    expect((await app.request('/api/reviews/nope')).status).toBe(404);
  });
});

describe('GET /api/reviews/:id/file', () => {
  it('returns both sides of a file', async () => {
    const created = await openReview();
    const response = await app.request(`/api/reviews/${created.id}/file?path=a.txt`);
    const body = (await response.json()) as { base_content: string; head_content: string };
    expect(body.base_content).toBe(FOUR_LINES);
    expect(body.head_content).toBe('alpha\nTARGET\ngamma\ndelta\n');
  });

  it('requires a path', async () => {
    const created = await openReview();
    expect((await app.request(`/api/reviews/${created.id}/file`)).status).toBe(400);
  });

  it('returns 404 for a file outside the review', async () => {
    const created = await openReview();
    const response = await app.request(`/api/reviews/${created.id}/file?path=nope.txt`);
    expect(response.status).toBe(404);
  });
});

describe('threads', () => {
  it('creates a thread anchored to the commented line', async () => {
    const { review } = await openReviewWithThread();
    expect(review.threads[0]?.context.line).toBe('TARGET');
    expect(review.threads[0]?.anchor_state).toBe('current');
  });

  it('rejects a thread with no body', async () => {
    const created = await openReview();
    const response = await post(`/api/reviews/${created.id}/threads`, {
      path: 'a.txt',
      line: 2,
      body: '   ',
    });
    expect(response.status).toBe(400);
  });

  it('rejects a thread with no line', async () => {
    const created = await openReview();
    const response = await post(`/api/reviews/${created.id}/threads`, { path: 'a.txt', body: 'x' });
    expect(response.status).toBe(400);
  });

  it('appends a comment to a thread', async () => {
    const { review, thread_id } = await openReviewWithThread();
    const response = await post(`/api/reviews/${review.id}/threads/${thread_id}/comments`, {
      body: 'fixed it',
      author: 'agent',
    });
    expect(response.status).toBe(201);
    const updated = (await response.json()) as Review;
    expect(updated.threads[0]?.comments).toHaveLength(2);
  });

  it('resolves a thread', async () => {
    const { review, thread_id } = await openReviewWithThread();
    const response = await patch(`/api/reviews/${review.id}/threads/${thread_id}`, {
      status: 'resolved',
    });
    expect(((await response.json()) as Review).threads[0]?.status).toBe('resolved');
  });

  it('rejects an unknown thread status', async () => {
    const { review, thread_id } = await openReviewWithThread();
    const response = await patch(`/api/reviews/${review.id}/threads/${thread_id}`, {
      status: 'maybe',
    });
    expect(response.status).toBe(400);
  });
});

describe('the review loop', () => {
  it('submits, advances, and re-anchors in one round trip', async () => {
    const { review, thread_id } = await openReviewWithThread();

    const submitted = (await (await post(`/api/reviews/${review.id}/submit`)).json()) as Review;
    expect(submitted.status).toBe('submitted');

    // The agent responds by inserting a line above the commented one.
    repo.write('a.txt', 'inserted\nalpha\nTARGET\ngamma\ndelta\n');
    repo.commit('agent responds');

    const advanced = (await (
      await post(`/api/reviews/${review.id}/advance`, { head: 'HEAD' })
    ).json()) as Review;

    expect(advanced.status).toBe('open');
    expect(advanced.rounds).toHaveLength(2);

    const thread = advanced.threads.find((candidate) => candidate.id === thread_id);
    expect(thread?.anchor_state).toBe('shifted');
    expect(thread?.anchor?.line).toBe(3);
    expect(thread?.comments[0]?.body).toBe('why this?');
  });

  it('outdates a thread when the agent rewrites the commented line', async () => {
    const { review } = await openReviewWithThread();
    repo.write('a.txt', 'alpha\nREWRITTEN\ngamma\ndelta\n');
    repo.commit('agent rewrites');

    const advanced = (await (
      await post(`/api/reviews/${review.id}/advance`, {})
    ).json()) as Review;

    expect(advanced.threads[0]?.anchor_state).toBe('outdated');
    expect(advanced.threads[0]?.context.line).toBe('TARGET');
  });
});

describe('DELETE /api/reviews/:id', () => {
  it('removes a review', async () => {
    const created = await openReview();
    const response = await app.request(`/api/reviews/${created.id}`, { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect((await app.request(`/api/reviews/${created.id}`)).status).toBe(404);
  });
});
