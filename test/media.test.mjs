import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaRequest } from '../media.mjs';

const origin = 'https://apihub.agnes-ai.com';
const key = 'test-only-secret-key';
const videoModel = 'agnes-video-2.5-flash';

function request(path, body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${key}`);
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(`${origin}/v1${path}`, {
    ...init,
    method: init.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function scriptedFetch(...steps) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const outgoing = input instanceof Request && init === undefined
      ? input
      : new Request(input, init);
    calls.push(outgoing);
    const step = steps.shift();
    assert.ok(step, `Unexpected fetch: ${outgoing.method} ${outgoing.url}`);
    return typeof step === 'function' ? step(outgoing) : step;
  };
  return { calls, fetchImpl };
}

async function handled(req, fetchImpl, adapter = mediaRequest) {
  const response = await adapter(req, { fetchImpl });
  assert.ok(response instanceof Response, 'A media route must return a Response');
  return response;
}

function opaqueId(video_id = 'video_actual_id', model = videoModel) {
  return `agnes_v1_${Buffer.from(JSON.stringify({ video_id, model })).toString('base64url')}`;
}

const createdTask = {
  id: 'task_internal_id',
  task_id: 'task_internal_id',
  video_id: 'video_actual_id',
  object: 'video',
  model: videoModel,
  status: 'queued',
  progress: 0,
  created_at: 1786900000,
  seconds: '5',
  size: '720P',
};

const completedTask = {
  completed_at: 1790062857,
  created_at: 1790062812,
  error: null,
  expires_at: null,
  id: 'task_internal_id',
  internal_progress: 0,
  internal_status: 'pending',
  object: 'video',
  progress: 100,
  quality: 'standard',
  remixed_from_video_id: null,
  seconds: '4',
  size: '720P',
  started_at: 1790062812,
  status: 'completed',
  url: 'https://storage.googleapis.com/agnes-aigc/result.mp4',
};

test('ordinary chat remains unhandled with its streaming body unread', async () => {
  const req = request('/chat/completions', { model: 'agnes-3.0-flash', stream: true });
  const response = await mediaRequest(req, { fetchImpl: () => assert.fail('No fetch expected') });
  assert.equal(response, null);
  assert.equal(req.bodyUsed, false);
});

test('image generations translates output format, preserves URL results, and defaults size', async () => {
  const network = scriptedFetch(async (outgoing) => {
    assert.equal(outgoing.url, `${origin}/v1/images/generations`);
    assert.equal(outgoing.headers.get('Authorization'), `Bearer ${key}`);
    assert.deepEqual(await outgoing.json(), {
      model: 'agnes-image-2.5-flash', prompt: 'A small cat', size: '1K',
      extra_body: { response_format: 'url' },
    });
    return json({ created: 1780000000, data: [{ url: 'https://example.com/cat.png', b64_json: null, revised_prompt: null }] });
  });
  const response = await handled(request('/images/generations', {
    model: 'agnes-image-2.5-flash', prompt: 'A small cat', response_format: 'url',
  }), network.fetchImpl);
  assert.equal((await response.json()).data[0].url, 'https://example.com/cat.png');
});

test('text-to-image Base64 output enables return_base64 without a top-level response_format', async () => {
  const network = scriptedFetch(async (outgoing) => {
    const body = await outgoing.json();
    assert.equal(body.return_base64, true);
    assert.equal(body.response_format, undefined);
    assert.equal(body.extra_body.response_format, 'b64_json');
    assert.equal(body.size, '2K');
    assert.equal(body.ratio, '16:9');
    return json({ created: 1780000000, data: [{ url: null, b64_json: 'aW1hZ2U=', revised_prompt: null }] });
  });
  const response = await handled(request('/images/generations', {
    model: 'agnes-image-2.5-flash', prompt: 'A landscape', size: '2K', ratio: '16:9',
    response_format: 'b64_json',
  }), network.fetchImpl);
  assert.equal((await response.json()).data[0].b64_json, 'aW1hZ2U=');
});

test('JSON image edits combine URL and Data URI references in nested extra_body', async () => {
  const network = scriptedFetch(async (outgoing) => {
    assert.equal(outgoing.url, `${origin}/v1/images/generations`);
    const body = await outgoing.json();
    assert.equal(body.image, undefined);
    assert.equal(body.images, undefined);
    assert.deepEqual(body.extra_body, {
      image: ['https://example.com/reference.png', 'data:image/png;base64,aW1hZ2U='],
      response_format: 'b64_json', custom_setting: true,
    });
    assert.equal(body.return_base64, undefined);
    return json({ data: [{ b64_json: 'cmVzdWx0' }] });
  });
  const response = await handled(request('/images/edits', {
    model: 'agnes-image-2.5-flash', prompt: 'Combine references',
    image: 'https://example.com/reference.png',
    extra_body: { image: ['data:image/png;base64,aW1hZ2U='], custom_setting: true },
    response_format: 'b64_json',
  }), network.fetchImpl);
  assert.equal(response.status, 200);
});

test('multipart image edits convert all uploaded images to Data URIs and reset content type', async () => {
  const form = new FormData();
  form.set('model', 'agnes-image-2.5-flash');
  form.set('prompt', 'Combine these');
  form.set('response_format', 'url');
  form.set('n', '1');
  form.append('image[]', new Blob(['one'], { type: 'image/png' }), 'one.png');
  form.append('image[1]', new Blob(['two'], { type: 'image/jpeg' }), 'two.jpg');
  const network = scriptedFetch(async (outgoing) => {
    assert.match(outgoing.headers.get('Content-Type'), /^application\/json/);
    assert.equal(outgoing.headers.get('Content-Length'), null);
    const body = await outgoing.json();
    assert.deepEqual(body.extra_body.image, ['data:image/png;base64,b25l', 'data:image/jpeg;base64,dHdv']);
    assert.equal(body.n, 1);
    return json({ data: [{ url: 'https://example.com/result.png' }] });
  });
  assert.equal((await handled(request('/images/edits', form), network.fetchImpl)).status, 200);
});

for (const mask of ['data:image/png;base64,bWFzaw==', null]) {
  test(`image masks are rejected explicitly (${mask === null ? 'multipart upload' : 'JSON'})`, async () => {
    let body;
    if (mask === null) {
      body = new FormData();
      body.set('model', 'agnes-image-2.5-flash');
      body.set('prompt', 'Edit');
      body.set('image', new Blob(['image'], { type: 'image/png' }), 'input.png');
      body.set('mask', new Blob(['mask'], { type: 'image/png' }), 'mask.png');
    } else {
      body = { model: 'agnes-image-2.5-flash', prompt: 'Edit', image: 'https://example.com/input.png', mask };
    }
    const response = await handled(request('/images/edits', body), () => assert.fail('Mask must not reach upstream'));
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /mask/i);
  });
}

for (const path of ['/images/generations', '/videos']) {
  test(`malformed JSON gets a predictable 400 for ${path}`, async () => {
    const response = await handled(request(path, '{not json'), () => assert.fail('No fetch expected'));
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /json/i);
  });
}

test('upstream non-success status and error payload survive image adaptation', async () => {
  const upstream = json({ error: { message: 'Quota exhausted', type: 'quota_exceeded' } }, 429, { 'Retry-After': '9' });
  const response = await handled(request('/images/generations', {
    model: 'agnes-image-2.5-flash', prompt: 'A tree',
  }), scriptedFetch(upstream).fetchImpl);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '9');
  assert.deepEqual(await response.json(), { error: { message: 'Quota exhausted', type: 'quota_exceeded' } });
});

test('video creation defaults text mode and string duration and retains the real video ID', async () => {
  const network = scriptedFetch(async (outgoing) => {
    assert.equal(outgoing.url, `${origin}/v1/videos`);
    assert.deepEqual(await outgoing.json(), {
      model: videoModel, prompt: 'A cat runs', mode: 'text', seconds: '5', size: '720P', aspect_ratio: '16:9',
    });
    return json(createdTask);
  });
  const result = await (await handled(request('/videos', { model: videoModel, prompt: 'A cat runs' }), network.fetchImpl)).json();
  assert.equal(result.id, opaqueId());
  assert.equal(result.status, 'queued');
  assert.equal(result.object, 'video');
});

for (const [size, tier, ratio] of [
  ['1280x720', '720P', '16:9'], ['720x1280', '720P', '9:16'],
  ['1920x1080', '1080P', '16:9'], ['1080x1920', '1080P', '9:16'],
  ['1024x1024', '1K', '1:1'], ['2560x1440', '2K', '16:9'],
  ['1440x2560', '2K', '9:16'],
]) {
  test(`video pixel size ${size} maps to ${tier} with ${ratio}`, async () => {
    const network = scriptedFetch(async (outgoing) => {
      const body = await outgoing.json();
      assert.equal(body.size, tier);
      assert.equal(body.aspect_ratio, ratio);
      assert.equal(body.seconds, '8');
      return json({ ...createdTask, model: 'agnes-video-2.5', seconds: '8', size: tier });
    });
    assert.equal((await handled(request('/videos', {
      model: 'agnes-video-2.5', prompt: 'A landscape', size, seconds: 8,
    }), network.fetchImpl)).status, 200);
  });
}

for (const size of ['1080P', '1920x1080', '1024x1024', '2K']) {
  test(`Flash rejects ${size} instead of lowering requested quality`, async () => {
    const response = await handled(request('/videos', { model: videoModel, prompt: 'A city', size }), () => assert.fail('No paid downgrade'));
    assert.equal(response.status, 400);
    assert.match(JSON.stringify(await response.json()), /720P/);
  });
}

test('public input_reference maps to first_frame and keyframe mode', async () => {
  const network = scriptedFetch(async (outgoing) => {
    const body = await outgoing.json();
    assert.equal(body.mode, 'keyframe');
    assert.equal(body.first_frame, 'https://example.com/first.png');
    assert.equal(body.input_reference, undefined);
    return json(createdTask);
  });
  assert.equal((await handled(request('/videos', {
    model: videoModel, prompt: 'Move', input_reference: 'https://example.com/first.png',
  }), network.fetchImpl)).status, 200);
});

test('multipart public reference works while multipart image uploads are rejected', async () => {
  const form = new FormData();
  form.set('model', videoModel);
  form.set('prompt', 'Move');
  form.set('input_reference', 'https://example.com/first.png');
  form.set('seconds', '6');
  const network = scriptedFetch(async (outgoing) => {
    const body = await outgoing.json();
    assert.equal(body.seconds, '6');
    assert.equal(body.first_frame, 'https://example.com/first.png');
    return json(createdTask);
  });
  assert.equal((await handled(request('/videos', form), network.fetchImpl)).status, 200);
  const upload = new FormData();
  upload.set('model', videoModel);
  upload.set('prompt', 'Move');
  upload.set('input_reference', new Blob(['image'], { type: 'image/png' }), 'input.png');
  const response = await handled(request('/videos', upload), () => assert.fail('Upload is unsupported'));
  assert.equal(response.status, 400);
  assert.match(JSON.stringify(await response.json()), /public.*url/i);
});

test('explicit video reference mode and media fields survive conversion', async () => {
  const network = scriptedFetch(async (outgoing) => {
    const body = await outgoing.json();
    assert.equal(body.mode, 'reference');
    assert.deepEqual(body.images, ['https://example.com/actor.png']);
    assert.deepEqual(body.audios, ['https://example.com/song.mp3']);
    assert.deepEqual(body.videos, [{ url: 'https://example.com/motion.mp4', start_seconds: 3, require_audio: true }]);
    return json({ ...createdTask, model: 'agnes-video-2.5' });
  });
  assert.equal((await handled(request('/videos', {
    model: 'agnes-video-2.5', prompt: 'Follow references', mode: 'reference',
    images: ['https://example.com/actor.png'], audios: ['https://example.com/song.mp3'],
    videos: [{ url: 'https://example.com/motion.mp4', start_seconds: 3, require_audio: true }],
  }), network.fetchImpl)).status, 200);
});

test('native reference_images cannot silently create a text video without the requested images', async () => {
  let calls = 0;
  const response = await handled(request('/videos', {
    model: videoModel, prompt: 'Animate these subjects',
    reference_images: ['data:image/png;base64,aW1hZ2U='],
  }), async () => { calls++; return json(createdTask); });
  assert.equal(response.status, 400);
  assert.equal(calls, 0, 'A request whose reference images cannot be sent must not queue a video');
  assert.match((await response.json()).error.message, /public.*URL/i);
});

for (const multipart of [false, true]) {
  test(`public image aliases are restored to Agnes model ids (${multipart ? 'multipart' : 'JSON'})`, async () => {
    const body = multipart ? new FormData() : {
      model: 'gpt-image-agnes-2.5-flash', prompt: 'Make the object orange', image: ['https://example.com/input.png'],
    };
    if (multipart) {
      body.set('model', 'gpt-image-agnes-2.5-flash');
      body.set('prompt', 'Make the object orange');
      body.append('image', new Blob(['test image'], { type: 'image/png' }), 'input.png');
    }
    const network = scriptedFetch(async (outgoing) => {
      assert.equal((await outgoing.json()).model, 'agnes-image-2.5-flash');
      return json({ data: [{ url: 'https://example.com/output.png' }] });
    });
    assert.equal((await handled(request('/images/edits', body), network.fetchImpl)).status, 200);
    assert.equal(network.calls.length, 1);
  });
}

for (const body of [
  { input_reference: 'data:image/png;base64,aW1hZ2U=' },
  { input_reference: 'http://127.0.0.1/first.png' },
  { mode: 'reference', images: ['data:image/png;base64,aW1hZ2U='] },
  { mode: 'reference', images: Array(6).fill('https://example.com/image.png') },
  { mode: 'reference', videos: [{ url: 'https://example.com/video.mp4' }] },
  { mode: 'text', first_frame: 'https://example.com/first.png' },
  { mode: 'reference' },
  { mode: 'keyframe' },
  { seconds: 3 }, { seconds: '13' }, { seconds: 'invalid' },
]) {
  test(`invalid video input is rejected: ${JSON.stringify(body).slice(0, 100)}`, async () => {
    const response = await handled(request('/videos', { model: videoModel, prompt: 'A scene', ...body }), () => assert.fail('Invalid video must not queue'));
    assert.equal(response.status, 400);
  });
}

test('a fresh module instance polls video_id and model from the public ID', async () => {
  const create = await handled(request('/videos', { model: videoModel, prompt: 'A scene' }), scriptedFetch(json(createdTask)).fetchImpl);
  const { id } = await create.json();
  const fresh = await import(`../media.mjs?instance=restart`);
  const network = scriptedFetch((outgoing) => {
    const url = new URL(outgoing.url);
    assert.equal(url.pathname, '/agnesapi');
    assert.equal(url.searchParams.get('video_id'), 'video_actual_id');
    assert.equal(url.searchParams.get('model_name'), videoModel);
    assert.equal(outgoing.headers.get('Authorization'), `Bearer ${key}`);
    return json(completedTask);
  });
  const response = await handled(request(`/videos/${id}`), network.fetchImpl, fresh.mediaRequest);
  const result = await response.json();
  assert.equal(result.id, id);
  assert.equal(result.model, videoModel);
  assert.equal(result.status, 'completed');
  assert.equal(result.progress, 100);
});

test('polling preserves failed status and error details', async () => {
  const network = scriptedFetch(json({
    ...createdTask, status: 'failed', progress: 100, error: { message: 'Invalid reference media' },
  }));
  const response = await handled(request(`/videos/${opaqueId()}`), network.fetchImpl);
  const body = await response.json();
  assert.equal(body.status, 'failed');
  assert.deepEqual(body.error, { message: 'Invalid reference media' });
});

test('polling retains upstream authentication failures', async () => {
  const response = await handled(request(`/videos/${opaqueId()}`), scriptedFetch(json({ error: { message: 'Invalid key' } }, 401)).fetchImpl);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: { message: 'Invalid key' } });
});

test('missing video_id on successful create is a 502 rather than polling task_id', async () => {
  const { video_id, ...missingVideoId } = createdTask;
  const response = await handled(request('/videos', { model: videoModel, prompt: 'A scene' }), scriptedFetch(json(missingVideoId)).fetchImpl);
  assert.equal(response.status, 502);
  assert.match(JSON.stringify(await response.json()), /video_id/);
});

for (const id of ['task_internal_id', 'agnes_v1_bad!', 'agnes_v1_e30', opaqueId('', videoModel), opaqueId('video_id', 'other-provider')]) {
  test(`invalid public task ID is a 400: ${id}`, async () => {
    const response = await handled(request(`/videos/${id}`), () => assert.fail('Invalid ID must not reach upstream'));
    assert.equal(response.status, 400);
  });
}

test('completed video content is streamed without credentials or redirects to its file host', async () => {
  const controller = new AbortController();
  const network = scriptedFetch(json(completedTask), (outgoing) => {
    assert.equal(outgoing.url, completedTask.url);
    assert.equal(outgoing.headers.get('Authorization'), null);
    assert.equal(outgoing.headers.get('x-api-key'), null);
    assert.equal(outgoing.headers.get('Cookie'), null);
    assert.equal(outgoing.redirect, 'error');
    assert.equal(outgoing.signal.aborted, false);
    return new Response(new Uint8Array([0, 1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } });
  });
  const response = await handled(request(`/videos/${opaqueId()}/content`, undefined, {
    signal: controller.signal,
    headers: { Cookie: 'session=private', 'x-api-key': 'also-private' },
  }), network.fetchImpl);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2, 3]);
});

for (const url of [
  'http://storage.googleapis.com/result.mp4', 'https://127.0.0.1/video',
  'https://10.1.2.3/video', 'https://192.168.1.1/video', 'https://172.16.0.1/video',
  'https://[::1]/video', 'https://[::ffff:127.0.0.1]/video',
  'https://localhost./video', 'https://router.local/video',
  'https://metadata.google.internal/video', 'https://user:password@example.com/video',
]) {
  test(`unsafe video download address is rejected: ${url}`, async () => {
    const network = scriptedFetch(json({ ...completedTask, url }));
    const response = await handled(request(`/videos/${opaqueId()}/content`), network.fetchImpl);
    assert.equal(response.status, 502);
    assert.equal(network.calls.length, 1);
  });
}

test('unfinished content is a predictable conflict and does not download', async () => {
  const network = scriptedFetch(json({ ...createdTask, status: 'in_progress', progress: 42 }));
  const response = await handled(request(`/videos/${opaqueId()}/content`), network.fetchImpl);
  assert.equal(response.status, 409);
  assert.match(JSON.stringify(await response.json()), /not.*ready|not.*complete/i);
});

test('malformed successful upstream video JSON produces a predictable 502', async () => {
  const response = await handled(request(`/videos/${opaqueId()}`), scriptedFetch(new Response('{broken', { status: 200 })).fetchImpl);
  assert.equal(response.status, 502);
});

for (const status of ['unknown-state', 'toString', '__proto__']) {
  test(`malformed upstream task status is rejected: ${status}`, async () => {
    const response = await handled(request(`/videos/${opaqueId()}`), scriptedFetch(json({ ...completedTask, status })).fetchImpl);
    assert.equal(response.status, 502);
  });
}

test('an array is not accepted as a video duration even when it converts to a number', async () => {
  const response = await handled(request('/videos', { model: videoModel, prompt: 'A scene', seconds: [5] }), () => assert.fail('Invalid duration must not queue'));
  assert.equal(response.status, 400);
});

test('download URLs must be strings rather than values coerced into URLs', async () => {
  const network = scriptedFetch(json({ ...completedTask, url: [completedTask.url] }));
  const response = await handled(request(`/videos/${opaqueId()}/content`), network.fetchImpl);
  assert.equal(response.status, 502);
  assert.equal(network.calls.length, 1);
});

test('legal whitespace in the JSON content type does not reject a media request', async () => {
  const req = new Request(`${origin}/v1/videos`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json ; charset=utf-8' },
    body: JSON.stringify({ model: videoModel, prompt: 'A scene' }),
  });
  const response = await handled(req, scriptedFetch(json(createdTask)).fetchImpl);
  assert.equal(response.status, 200);
});

test('a file host non-success response keeps its status and body without provider credentials', async () => {
  const network = scriptedFetch(json(completedTask), (outgoing) => {
    assert.equal(outgoing.headers.get('Authorization'), null);
    return new Response('Expired video URL', { status: 410 });
  });
  const response = await handled(request(`/videos/${opaqueId()}/content`), network.fetchImpl);
  assert.equal(response.status, 410);
  assert.equal(await response.text(), 'Expired video URL');
});

test('network errors never echo a secret or exception message', async () => {
  const response = await handled(request('/videos', { model: videoModel, prompt: 'A scene' }), () => {
    throw new Error(`Request failed with Authorization Bearer ${key}`);
  });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), new RegExp(key));
});

test('cancellation reaches upstream and remains an AbortError', async () => {
  const controller = new AbortController();
  const req = request('/videos', { model: videoModel, prompt: 'A scene' }, { signal: controller.signal });
  const network = scriptedFetch((outgoing) => {
    controller.abort();
    assert.equal(outgoing.signal.aborted, true);
    throw new DOMException('Cancelled', 'AbortError');
  });
  await assert.rejects(mediaRequest(req, { fetchImpl: network.fetchImpl }), { name: 'AbortError' });
});
