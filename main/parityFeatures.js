'use strict';

const MUSIC_SOURCES = new Set(['local', 'youtube', 'spotify']);

function normalizeMusicSettings(settings = {}) {
  const source = MUSIC_SOURCES.has(settings.breakMusicSource) ? settings.breakMusicSource : 'local';
  const volume = Number(settings.breakMusicVolume);
  return {
    // Music is opt-in. Missing or legacy settings must not silently start audio.
    enabled: settings.soundEnabled === true,
    source,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6,
    path: typeof settings.breakMusicPath === 'string' ? settings.breakMusicPath.trim() : '',
    youtubePlaylist: typeof settings.breakMusicYoutubePlaylist === 'string' ? settings.breakMusicYoutubePlaylist.trim() : '',
    spotifyUrl: typeof settings.breakMusicSpotifyUrl === 'string' ? settings.breakMusicSpotifyUrl.trim() : '',
  };
}

function normalizeTagGoals(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [tag, value] of Object.entries(raw)) {
    const cleanTag = String(tag || '').trim().slice(0, 80);
    if (!cleanTag || !value || typeof value !== 'object') continue;
    const targetHours = Number(value.targetHours);
    const targetDate = typeof value.targetDate === 'string' && value.targetDate.trim()
      ? value.targetDate.trim().slice(0, 10)
      : null;
    if (!Number.isFinite(targetHours) || targetHours <= 0) continue;
    out[cleanTag] = {
      targetHours: Math.min(100000, Math.max(0.1, targetHours)),
      targetDate,
      updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : 0,
    };
  }
  return out;
}

function tagGoalProgress(sessions, tag, goal) {
  const cleanTag = String(tag || '').trim();
  const targetHours = Number(goal?.targetHours);
  if (!cleanTag || !Number.isFinite(targetHours) || targetHours <= 0) {
    return { seconds: 0, targetSeconds: 0, progress: 0 };
  }
  const seconds = (Array.isArray(sessions) ? sessions : []).reduce((sum, session) => {
    if (session?.type !== 'focus' || String(session.tag || '').trim() !== cleanTag) return sum;
    const duration = Number(session.durationSec);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0);
  const targetSeconds = Math.round(targetHours * 3600);
  return { seconds, targetSeconds, progress: Math.min(1, seconds / targetSeconds) };
}

module.exports = { MUSIC_SOURCES, normalizeMusicSettings, normalizeTagGoals, tagGoalProgress };
