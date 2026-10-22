import http from 'k6/http'
import { check, sleep } from 'k6'
import execution from 'k6/execution'
import { SharedArray } from 'k6/data'
import { Counter, Trend } from 'k6/metrics'

const actors = new SharedArray('actors', () => JSON.parse(open(__ENV.LUMI_ACTORS)))
const base = __ENV.LUMI_BASE_URL
const origin = __ENV.LUMI_ORIGIN
const duration = __ENV.LUMI_DURATION || '60s'
const overhead = new Trend('platform_overhead_ms', true)
const streams = new Counter('completed_streams')
const images = new Counter('completed_images')
export const options = {
  scenarios: {
    readers: { executor: 'constant-vus', vus: 75, duration, exec: 'read' },
    streams: { executor: 'constant-vus', vus: 20, duration, exec: 'chat' },
    images: { executor: 'constant-vus', vus: 5, duration, exec: 'image' },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<100'],
    platform_overhead_ms: ['p(95)<100'],
    completed_streams: ['count>=100'],
    completed_images: ['count>=25'],
  },
}
function params(token, kind) {
  return {
    headers: {
      Authorization: 'Bearer ' + token,
      Origin: origin,
      'X-Lumi-CSRF': '1',
      'Content-Type': 'application/json',
    },
    tags: { kind },
    timeout: '25s',
  }
}
function id() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16)
    return (c === 'x' ? n : (n & 3) | 8).toString(16)
  })
}
export function setup() {
  if (!base || !origin || actors.length !== 100)
    throw new Error('100 test actors and explicit base/origin required')
  return actors.map((actor) => {
    const chatID = id(),
      imageID = id()
    for (const [path, conversation, model] of [
      ['/conversations', chatID, __ENV.LUMI_CHAT_MODEL],
      ['/image-conversations', imageID, __ENV.LUMI_IMAGE_MODEL],
    ]) {
      const response = http.post(
        base + '/api/v1' + path,
        JSON.stringify({ id: conversation, model_id: model }),
        params(actor.token, 'setup'),
      )
      if (response.status !== 201) throw new Error('Conversation setup failed: ' + response.status)
    }
    return { token: actor.token, chatID, imageID }
  })
}
function current(data) {
  return data[execution.vu.idInTest - 1]
}
export function read(data) {
  const actor = current(data)
  const paths = [
    '/me',
    '/me/credits',
    '/conversations?limit=20',
    '/me/images?limit=40',
    '/models?type=chat',
  ]
  for (const path of paths) {
    const response = http.get(base + '/api/v1' + path, params(actor.token, 'read'))
    check(response, { 'authenticated read succeeds': (r) => r.status === 200 })
  }
  sleep(1)
}
export function chat(data) {
  const actor = current(data)
  const response = http.post(
    base + '/api/v1/conversations/' + actor.chatID + '/messages',
    JSON.stringify({
      request_id: id(),
      model_id: __ENV.LUMI_CHAT_MODEL,
      action: 'send',
      content: 'load',
    }),
    params(actor.token, 'stream'),
  )
  const ok = check(response, {
    'SSE completes': (r) =>
      r.status === 200 && r.body.includes('event: done') && !r.body.includes('event: error'),
    'SSE bypasses buffering': (r) =>
      r.headers['X-Accel-Buffering'] === 'no' && !r.headers['Content-Encoding'],
  })
  const match = response.body.match(/platform-timing:(\d+):(\d+)/)
  check(match, { 'upstream timing marker exists': (value) => value !== null })
  if (match)
    overhead.add(Math.max(0, response.timings.duration - (Number(match[2]) - Number(match[1]))))
  if (ok) streams.add(1)
  sleep(4)
}
export function image(data) {
  const actor = current(data),
    request = params(actor.token, 'image')
  request.headers['Idempotency-Key'] = id()
  const response = http.post(
    base + '/api/v1/image-tasks',
    JSON.stringify({
      conversation_id: actor.imageID,
      model_id: __ENV.LUMI_IMAGE_MODEL,
      prompt: 'load',
      quality: 'low',
      size: '1024x1024',
      ratio: '',
      n: 1,
      reference_file_ids: [],
    }),
    request,
  )
  if (!check(response, { 'image accepted': (r) => r.status === 202 })) return
  const task = response.json('id')
  let completed = false
  for (let attempt = 0; attempt < 40; attempt++) {
    sleep(0.25)
    const status = http.get(base + '/api/v1/image-tasks/' + task, params(actor.token, 'image'))
    if (status.status !== 200) break
    const state = status.json('status')
    if (state === 'succeeded') {
      completed = true
      images.add(1)
      break
    }
    if (['failed', 'partial', 'canceled'].includes(state)) break
  }
  check(completed, { 'image finishes successfully': (value) => value })
  sleep(4)
}
