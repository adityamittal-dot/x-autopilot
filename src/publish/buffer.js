import { http, log, warn } from '../util.js';

const ENDPOINT = 'https://api.buffer.com';

export async function gql(query, label = 'buffer') {
  if (!process.env.BUFFER_API_KEY) throw new Error('BUFFER_API_KEY is not set');
  const res = await http(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.BUFFER_API_KEY}`,
    },
    body: JSON.stringify({ query }),
  }, { label, retries: 2 });

  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${res.body.slice(0, 300)}`);
  if (res.json?.errors?.length) {
    throw new Error(`${label}: ${res.json.errors.map((e) => e.message).join('; ')}`);
  }
  return res.json?.data;
}

const q = (s) => JSON.stringify(String(s)); // safe GraphQL string literal

export async function getOrganizationId() {
  const d = await gql(`query { account { id email organizations { id name } } }`, 'buffer:orgs');
  const orgs = d?.account?.organizations || [];
  if (!orgs.length) throw new Error('no Buffer organizations on this API key');
  return { id: orgs[0].id, name: orgs[0].name, email: d.account.email, all: orgs };
}

export async function listChannels(orgId) {
  const d = await gql(
    `query { channels(input: { organizationId: ${q(orgId)} }) { id name displayName service isQueuePaused } }`,
    'buffer:channels'
  );
  return d?.channels || [];
}

export async function resolveChannel(cfg) {
  if (cfg.buffer.channelId) return { id: cfg.buffer.channelId, service: cfg.buffer.channelService };
  const org = await getOrganizationId();
  const channels = await listChannels(org.id);
  const want = (cfg.buffer.channelService || 'twitter').toLowerCase();
  const match = channels.find((c) => String(c.service).toLowerCase() === want) ||
                channels.find((c) => /twitter|^x$/i.test(String(c.service)));
  if (!match) {
    throw new Error(
      `no ${want} channel in Buffer org "${org.name}". Channels found: ` +
      (channels.map((c) => `${c.displayName || c.name} (${c.service})`).join(', ') || 'none')
    );
  }
  if (match.isQueuePaused) warn(`Buffer channel "${match.displayName || match.name}" has a PAUSED queue — posts will not go out.`);
  return { ...match, organizationId: org.id };
}

/**
 * Schedule the post. We always use customScheduled with an explicit dueAt so the
 * publish time is deterministic and does not depend on Buffer's queue settings.
 */
export async function createPost({ channelId, text, dueAt }) {
  const d = await gql(`
    mutation {
      createPost(input: {
        text: ${q(text)},
        channelId: ${q(channelId)},
        schedulingType: automatic,
        mode: customScheduled,
        dueAt: ${q(dueAt)}
      }) {
        ... on PostActionSuccess { post { id text dueAt status } }
        ... on MutationError { message }
      }
    }`, 'buffer:createPost');

  const r = d?.createPost;
  if (!r) throw new Error('createPost returned nothing');
  if (r.message) throw new Error(`Buffer rejected the post: ${r.message}`);
  log(`buffer: scheduled post ${r.post.id} for ${r.post.dueAt}`);
  return r.post;
}

export async function getPostMetrics(postId) {
  const d = await gql(
    `query { post(input: { id: ${q(postId)} }) { id text status metrics { type name value unit } metricsUpdatedAt } }`,
    'buffer:metrics'
  );
  const p = d?.post;
  if (!p) return null;
  const metrics = {};
  for (const m of p.metrics || []) metrics[m.type] = m.value;
  return { id: p.id, status: p.status, metrics, updatedAt: p.metricsUpdatedAt };
}
