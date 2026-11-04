// The AI user agent's video of its session: one .webm of the app window, and agent-video.json saying when it started, so a note made at a clock time can be found in the video (admin "AI persona" tab).
// Job: report health
// Why (4 Nov 2026, AI user agents 9/12, owner: "Can we also do a video recording of the AI user agent/persona explorer?"): the pool's fill video (desktop/ready-fill/fill-video.mjs) stops at 3 minutes; a session runs up to 30,
// so this lifts that limit to the session's own cap and no further. Off unless AGENT_VIDEO=1 (the workflow's `video` input): sizing it on a real run comes before any upload (spec, plan row 9/12). Never the owner's window: the suite's own app.
import fs from 'node:fs';
import path from 'node:path';
import {startFillVideo} from '../../ready-fill/fill-video.mjs';

export const VIDEO_FILE = 'agent-video.webm', VIDEO_META = 'agent-video.json';

/**
 * Start recording the suite's window when AGENT_VIDEO=1. -> {startedAt, finish(): the meta written, or null when nothing was kept}.
 * `minutes` is the session's cap; the recorder stops by itself a minute after it. `finish()` moves the file to <dir>/agent-video.webm and writes agent-video.json {startedAt (ms epoch), secs, bytes}, so the page can seek to (note.at - startedAt).
 */
export async function startAgentVideo(page, {dir, minutes, env = process.env, start = startFillVideo, now = Date.now}) {
  if (env.AGENT_VIDEO !== '1') return {startedAt: 0, finish: async () => null};
  const seconds = Math.round((Number(minutes) || 10) * 60) + 60, startedAt = now();
  const recorder = await start(page, {dir, maxSeconds: seconds, hardMaxSeconds: seconds}).catch(error => { console.log(`  video: not started (${error.message})`); return null; });
  return {startedAt, async finish() {
    const video = await recorder?.stop().catch(error => { console.log(`  video: the recorder did not stop cleanly (${error.message})`); return null; });
    if (!video) { console.log('  video: none kept (no frame, no ffmpeg or the encode failed)'); return null; }
    const target = path.join(dir, VIDEO_FILE);
    fs.renameSync(video.path, target);
    const meta = {file: VIDEO_FILE, startedAt, secs: video.secs, bytes: video.bytes};
    fs.writeFileSync(path.join(dir, VIDEO_META), JSON.stringify(meta));
    console.log(`  video: ${video.secs} s, ${(video.bytes / 1048576).toFixed(1)} MB (${(video.bytes / 1048576 / Math.max(1, video.secs / 60)).toFixed(2)} MB per minute)`);
    return meta;
  }};
}

/** Where in the video a clock time falls, in whole seconds from its start; 0 when the time is before it. */
export const seekSeconds = (meta, at) => Math.max(0, Math.round((at - meta.startedAt) / 1000));
