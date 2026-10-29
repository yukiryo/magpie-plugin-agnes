import { isIP } from 'node:net';

const API_ORIGIN = 'https://apihub.agnes-ai.com';
const ID_PREFIX = 'agnes_v1_';
const VIDEO_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const VIDEO_TIERS = new Set(['720P', '1080P', '1K', '2K']);
const PIXEL_SIZES = new Map([
  ['1280x720', ['720P', '16:9']], ['1280x704', ['720P', '16:9']],
  ['720x1280', ['720P', '9:16']], ['1470x630', ['720P', '21:9']],
  ['1680x720', ['720P', '21:9']], ['1112x834', ['720P', '4:3']],
  ['960x720', ['720P', '4:3']], ['960x960', ['720P', '1:1']],
  ['720x720', ['720P', '1:1']], ['834x1112', ['720P', '3:4']],
  ['720x960', ['720P', '3:4']], ['1920x1080', ['1080P', '16:9']],
  ['1080x1920', ['1080P', '9:16']], ['2206x946', ['1080P', '21:9']],
  ['1664x1248', ['1080P', '4:3']], ['1440x1440', ['1080P', '1:1']],
  ['1248x1664', ['1080P', '3:4']], ['1024x1024', ['1K', '1:1']],
  ['2560x1440', ['2K', '16:9']], ['1440x2560', ['2K', '9:16']],
  ['2940x1260', ['2K', '21:9']], ['2224x1668', ['2K', '4:3']],
  ['1920x1920', ['2K', '1:1']], ['1668x2224', ['2K', '3:4']],
]);

class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new MediaError(status, message);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(body, status = 200, sourceHeaders) {
  const headers = new Headers(sourceHeaders);
  for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'etag', 'content-md5']) {
    headers.delete(name);
  }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function privateIPv4(host) {
  const [a, b, c] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113);
}

function publicURL(value, { download = false } = {}) {
  const status = download ? 502 : 400;
  const message = download
    ? 'Agnes returned an unsafe video download URL; a public HTTPS URL is required.'
    : 'Media references require a public HTTP or HTTPS URL; uploads and Data URIs are not supported for video.';
  if (typeof value !== 'string' || !value.trim()) fail(status, message);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(status, message);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if ((download ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))
    || url.username || url.password || !host) fail(status, message);
  if (isIP(host) === 4) {
    if (privateIPv4(host)) fail(status, message);
  } else if (isIP(host) === 6) {
    if (!/^[23][0-9a-f]{3}:/.test(host) || /^2001:(?:db8|0):/.test(host)) fail(status, message);
  } else if (!host.includes('.')
    || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test)$/.test(host)
    || !/^[a-z0-9.-]+$/.test(host)) {
    fail(status, message);
  }
  return url;
}

function inputObject(value, message = 'The JSON request body must be an object.') {
  if (!object(value)) fail(400, message);
  return value;
}

async function readBody(request, kind) {
  const type = (request.headers.get('Content-Type') ?? 'application/json').split(';', 1)[0].trim();
  if (type.toLowerCase().startsWith('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      request.signal.throwIfAborted();
      fail(400, 'Invalid multipart request body.');
    }
    const body = {};
    const images = [];
    for (const [name, value] of form) {
      const imageField = /^image(?:\[\d*\])?$/.test(name);
      if (kind === 'image' && name === 'mask') fail(400, 'Image masks are not supported by Agnes.');
      if (value instanceof Blob) {
        if (kind === 'video') fail(400, 'Video media references require a public URL; uploaded files are not supported.');
        if (!imageField) fail(400, 'Only image fields accept uploaded image files.');
        const mime = value.type || 'application/octet-stream';
        images.push(`data:${mime};base64,${Buffer.from(await value.arrayBuffer()).toString('base64')}`);
      } else if (kind === 'image' && imageField) {
        images.push(value);
      } else if (['extra_body', 'images', 'audios', 'videos'].includes(name)) {
        try {
          body[name] = JSON.parse(value);
        } catch {
          fail(400, 'Multipart media arrays and extra_body must contain valid JSON.');
        }
      } else if (['n', 'seed'].includes(name)) {
        if (!value.trim() || !Number.isFinite(Number(value))) fail(400, 'Invalid numeric multipart field.');
        body[name] = Number(value);
      } else if (name === 'return_base64') {
        if (!['true', 'false'].includes(value)) fail(400, 'return_base64 must be a boolean.');
        body[name] = value === 'true';
      } else {
        body[name] = value;
      }
    }
    if (images.length) body.image = images;
    return body;
  }
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json$/i.test(type)) {
    fail(415, 'Media requests require JSON or multipart/form-data.');
  }
  try {
    return inputObject(await request.json());
  } catch (error) {
    request.signal.throwIfAborted();
    if (error instanceof MediaError) throw error;
    fail(400, 'Invalid JSON request body.');
  }
}

function imageReferences(value) {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  for (const reference of values) {
    if (typeof reference !== 'string' || !reference.trim()) fail(400, 'Image references must be URLs or image Data URIs.');
    if (!/^data:[^,]+;base64,/i.test(reference)) publicURL(reference);
  }
  return values;
}

function imageBody(body, editing) {
  const extra = body.extra_body === undefined ? {} : { ...inputObject(body.extra_body, 'extra_body must be an object.') };
  if ((body.mask !== undefined && body.mask !== null && body.mask !== '')
    || (extra.mask !== undefined && extra.mask !== null && extra.mask !== '')) {
    fail(400, 'Image masks are not supported by Agnes.');
  }
  const references = [
    ...imageReferences(body.image), ...imageReferences(body.images), ...imageReferences(extra.image),
  ];
  if (editing && !references.length) fail(400, 'Image editing requires at least one reference image.');
  const format = body.response_format ?? extra.response_format;
  if (format !== undefined && !['url', 'b64_json'].includes(format)) fail(400, 'Image response_format must be url or b64_json.');
  if (body.return_base64 !== undefined && typeof body.return_base64 !== 'boolean') fail(400, 'return_base64 must be a boolean.');
  if (references.length) extra.image = references;
  if (format !== undefined) extra.response_format = format;
  const result = { ...body, size: body.size ?? '1K', extra_body: extra };
  // Magpie remaps JSON model ids, but multipart edits still carry the alias.
  if (typeof result.model === 'string') result.model = result.model.replace(/^gpt-image-agnes-/, 'agnes-image-');
  for (const name of ['image', 'images', 'response_format', 'mask']) delete result[name];
  delete extra.mask;
  if (!references.length && format === 'b64_json') result.return_base64 = true;
  return result;
}

function mediaArray(body, name) {
  const value = body[name] ?? [];
  if (!Array.isArray(value)) fail(400, `Video ${name} must be an array.`);
  return value;
}

function videoBody(body) {
  const extra = body.extra_body === undefined ? {} : inputObject(body.extra_body, 'extra_body must be an object.');
  const result = { ...extra, ...body };
  delete result.extra_body;
  if (result.reference_images !== undefined
    && (!Array.isArray(result.reference_images) || result.reference_images.length > 0)) {
    fail(400, 'Video reference_images uploads are not supported; use images with public media URLs instead.');
  }
  delete result.reference_images;
  if (typeof result.model !== 'string' || !/^agnes-video-[a-zA-Z0-9._-]+$/.test(result.model)) {
    fail(400, 'A valid Agnes video model is required.');
  }
  const flash = result.model === 'agnes-video-2.5-flash';
  if (result.input_reference !== undefined) {
    if (typeof result.input_reference !== 'string') fail(400, 'Video input_reference requires a public URL.');
    publicURL(result.input_reference);
    if ((result.mode !== undefined && result.mode !== 'keyframe')
      || (result.first_frame !== undefined && result.first_frame !== result.input_reference)) {
      fail(400, 'input_reference conflicts with the selected video mode or first_frame.');
    }
    result.first_frame = result.input_reference;
    result.mode = 'keyframe';
    delete result.input_reference;
  }
  result.mode ??= 'text';
  if (!['text', 'keyframe', 'reference'].includes(result.mode)) fail(400, 'Video mode must be text, keyframe, or reference.');
  if (result.seconds !== undefined && !['number', 'string'].includes(typeof result.seconds)) {
    fail(400, 'Video seconds must be a number or numeric string from 4 to 12.');
  }
  const seconds = result.seconds === undefined ? 5 : Number(result.seconds);
  if (!Number.isInteger(seconds) || seconds < 4 || seconds > 12) fail(400, 'Video seconds must be from 4 to 12.');
  result.seconds = String(seconds);
  const size = result.size ?? '720P';
  const pixels = PIXEL_SIZES.get(size);
  if (pixels && result.aspect_ratio !== undefined && result.aspect_ratio !== pixels[1]) {
    fail(400, 'Video size and aspect_ratio conflict.');
  }
  result.size = pixels?.[0] ?? size;
  result.aspect_ratio ??= pixels?.[1] ?? (size === '1K' ? '1:1' : '16:9');
  if (!VIDEO_TIERS.has(result.size)) fail(400, 'Unsupported video size; use 720P, 1080P, 1K, or 2K.');
  if (flash && result.size !== '720P') fail(400, 'Agnes Video 2.5 Flash size must be 720P.');
  if (!VIDEO_RATIOS.has(result.aspect_ratio)) fail(400, 'Unsupported video aspect_ratio.');
  if (result.n !== undefined && result.n !== 1) fail(400, 'Video n must be 1.');
  const images = mediaArray(result, 'images');
  const audios = mediaArray(result, 'audios');
  const videos = mediaArray(result, 'videos');
  if (images.length > (flash ? 5 : 8)) fail(400, 'Too many video reference images.');
  if (audios.length > 3) fail(400, 'Too many video reference audio clips.');
  if (videos.length > (flash ? 0 : 1)) fail(400, 'Reference videos are not supported by this model or exceed its limit.');
  for (const reference of [...images, ...audios]) {
    if (typeof reference !== 'string') fail(400, 'Video references require a public URL.');
    publicURL(reference);
  }
  for (const video of videos) {
    if (!object(video) || typeof video.url !== 'string') fail(400, 'Video references require videos[].url.');
    publicURL(video.url);
  }
  for (const name of ['first_frame', 'last_frame']) {
    if (result[name] !== undefined && result[name] !== null) {
      if (typeof result[name] !== 'string') fail(400, 'Video frame references require a public URL.');
      publicURL(result[name]);
    }
  }
  const frames = Boolean(result.first_frame || result.last_frame);
  const references = images.length + audios.length + videos.length;
  if ((result.mode === 'text' && (frames || references))
    || (result.mode === 'keyframe' && (!frames || references))
    || (result.mode === 'reference' && (!references || frames))) {
    fail(400, 'Video mode and reference media do not match.');
  }
  return result;
}

function taskIdentity(value, status = 400) {
  if (!object(value) || typeof value.video_id !== 'string' || !value.video_id.trim()
    || value.video_id.length > 512 || /[\x00-\x1f\x7f]/.test(value.video_id)
    || typeof value.model !== 'string' || value.model.length > 128
    || !/^agnes-video-[a-zA-Z0-9._-]+$/.test(value.model)) {
    fail(status, status === 502 ? 'Agnes create response is missing a valid video_id.' : 'Invalid Agnes video task ID.');
  }
  return { video_id: value.video_id, model: value.model };
}

function encodeTask(identity) {
  return `${ID_PREFIX}${Buffer.from(JSON.stringify(identity)).toString('base64url')}`;
}

function decodeTask(id) {
  if (!id.startsWith(ID_PREFIX) || id.length > 2048) fail(400, 'Invalid Agnes video task ID.');
  const encoded = id.slice(ID_PREFIX.length);
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(encoded)) throw new Error();
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) throw new Error();
    return taskIdentity(JSON.parse(decoded.toString('utf8')));
  } catch (error) {
    if (error instanceof MediaError) throw error;
    fail(400, 'Invalid Agnes video task ID.');
  }
}

function providerHeaders(request, json = false) {
  const headers = new Headers();
  for (const name of ['authorization', 'x-api-key', 'anthropic-version', 'accept']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  if (json) headers.set('Content-Type', 'application/json');
  return headers;
}

async function upstreamJSON(response) {
  try {
    const data = await response.json();
    if (!object(data)) throw new Error();
    return data;
  } catch {
    fail(502, 'Agnes returned an invalid video JSON response.');
  }
}

function normalizeTask(data, identity, { creating = false } = {}) {
  const statuses = {
    queued: 'queued', pending: 'queued', submitted: 'queued',
    in_progress: 'in_progress', processing: 'in_progress', running: 'in_progress',
    completed: 'completed', succeeded: 'completed', success: 'completed',
    failed: 'failed', error: 'failed', canceled: 'failed', cancelled: 'failed',
  };
  const rawStatus = data.status ?? (creating ? 'queued' : '');
  const status = typeof rawStatus === 'string' && Object.hasOwn(statuses, rawStatus) ? statuses[rawStatus] : undefined;
  if (!status) fail(502, 'Agnes returned an invalid video task status.');
  const progress = status === 'completed' ? 100
    : Number.isFinite(Number(data.progress)) ? Math.min(100, Math.max(0, Math.round(Number(data.progress)))) : 0;
  return {
    ...data, id: encodeTask(identity), object: 'video', model: identity.model, status, progress,
    ...(data.seconds !== undefined ? { seconds: String(data.seconds) } : {}),
  };
}

async function poll(request, identity, fetchImpl) {
  const url = new URL('/agnesapi', API_ORIGIN);
  url.searchParams.set('video_id', identity.video_id);
  url.searchParams.set('model_name', identity.model);
  return fetchImpl(new Request(url, {
    method: 'GET', headers: providerHeaders(request), signal: request.signal, redirect: 'error',
  }));
}

export async function mediaRequest(request, { fetchImpl = globalThis.fetch } = {}) {
  const path = new URL(request.url).pathname.replace(/^\/v1(?=\/|$)/, '').replace(/\/$/, '');
  const image = request.method === 'POST' && ['/images/generations', '/images/edits'].includes(path);
  const create = request.method === 'POST' && path === '/videos';
  const task = request.method === 'GET' ? /^\/videos\/([^/]+)(\/content)?$/.exec(path) : null;
  if (!image && !create && !task) return null;
  try {
    request.signal.throwIfAborted();
    if (image || create) {
      const parsed = await readBody(request, image ? 'image' : 'video');
      const body = image ? imageBody(parsed, path === '/images/edits') : videoBody(parsed);
      const response = await fetchImpl(new Request(`${API_ORIGIN}/v1/${image ? 'images/generations' : 'videos'}`, {
        method: 'POST', headers: providerHeaders(request, true), body: JSON.stringify(body),
        signal: request.signal, redirect: 'error',
      }));
      if (image || !response.ok) return response;
      const data = await upstreamJSON(response);
      const identity = taskIdentity({ video_id: data.video_id, model: body.model }, 502);
      return jsonResponse(normalizeTask(data, identity, { creating: true }), response.status, response.headers);
    }
    let id;
    try {
      id = decodeURIComponent(task[1]);
    } catch {
      fail(400, 'Invalid Agnes video task ID.');
    }
    const identity = decodeTask(id);
    const response = await poll(request, identity, fetchImpl);
    if (!response.ok) return response;
    const data = normalizeTask(await upstreamJSON(response), identity);
    if (!task[2]) return jsonResponse(data, response.status, response.headers);
    if (data.status !== 'completed') fail(409, 'Video is not complete; its content is not ready.');
    const url = publicURL(data.url, { download: true });
    const headers = new Headers();
    for (const name of ['range', 'if-range']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    return await fetchImpl(new Request(url, {
      method: 'GET', headers, signal: request.signal, redirect: 'error', credentials: 'omit',
    }));
  } catch (error) {
    request.signal.throwIfAborted();
    if (error?.name === 'AbortError') throw error;
    const status = error instanceof MediaError ? error.status : 502;
    const message = error instanceof MediaError ? error.message : 'Unable to reach the Agnes media service.';
    return jsonResponse({ error: { message, type: status >= 500 ? 'upstream_error' : 'invalid_request_error' } }, status);
  }
}
