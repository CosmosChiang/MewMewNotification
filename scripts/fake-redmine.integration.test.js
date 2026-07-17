const http = require('node:http');
const { RedmineAPI } = require('./background/redmine-api.js');

function loadRedmineApi(baseFetch) {
  return class TestRedmineAPI extends RedmineAPI {
    constructor(baseUrl, apiKey) {
      super(baseUrl, apiKey, {
        fetch: baseFetch,
        AbortController,
        setTimeout,
        clearTimeout
      });
    }
  };
}

describe('fake Redmine HTTP integration', () => {
  let server;
  let baseUrl;
  const requests = [];

  beforeAll(async () => {
    server = http.createServer(async (request, response) => {
      requests.push({ method: request.method, url: request.url, token: request.headers['x-redmine-api-key'] });
      response.setHeader('Content-Type', 'application/json');
      if (request.headers['x-redmine-api-key'] !== 'integration-token') {
        response.writeHead(401); response.end('{}'); return;
      }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/users/current.json') {
        response.end(JSON.stringify({ user: { id: 7, login: 'tester' } })); return;
      }
      if (url.pathname === '/issues.json') {
        const offset = Number(url.searchParams.get('offset'));
        const all = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, updated_on: `2026-07-11T00:${String(index).padStart(2, '0')}:00.000Z` }));
        response.end(JSON.stringify({ issues: all.slice(offset, offset + 10), total_count: 25, offset, limit: 10 })); return;
      }
      if (url.pathname === '/issues/1.json' && request.method === 'PUT') {
        response.writeHead(204); response.end(); return;
      }
      response.writeHead(404); response.end('{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise(resolve => server.close(resolve)));
  beforeEach(() => requests.splice(0));

  test('authenticates, applies overlap pagination, and consumes every page', async () => {
    const RedmineAPI = loadRedmineApi(fetch);
    const api = new RedmineAPI(baseUrl, 'integration-token');
    api.minRequestInterval = 0;
    const result = await api.getIssuesLossless({ onlyMyProjects: true, cursor: '2026-07-11T00:10:00.000Z' });
    expect(result.issues).toHaveLength(25);
    expect(requests.filter(item => item.url.startsWith('/issues.json'))).toHaveLength(3);
    expect(requests[1].url).toContain('status_id=*');
    expect(requests[1].url).toContain('updated_on=%3E%3D');
  });

  test('sends validated mutation payload and handles 204 response', async () => {
    const RedmineAPI = loadRedmineApi(fetch);
    const api = new RedmineAPI(baseUrl, 'integration-token');
    api.minRequestInterval = 0;
    await expect(api.applyIssueChanges(1, { statusId: 2, reply: 'Done' })).resolves.toEqual({});
    expect(requests).toContainEqual(expect.objectContaining({ method: 'PUT', url: '/issues/1.json', token: 'integration-token' }));
  });

  test('maps fake server authentication errors without exposing the token', async () => {
    const RedmineAPI = loadRedmineApi(fetch);
    const api = new RedmineAPI(baseUrl, 'wrong-token');
    api.minRequestInterval = 0;
    await expect(api.getCurrentUser()).rejects.toThrow('Authentication failed');
  });
});
