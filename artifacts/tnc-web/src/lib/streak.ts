const STREAK_KEY = "tnc_streak";
const FAVORITES_KEY = "tnc_favorites";

function notifyActivityUpdated() {
  window.dispatchEvent(new Event("tnc-site-activity-updated"));
}

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null;
  completedVideos: Record<string, string[]>;
  completedQuizzes: Record<string, string[]>;
  completedLectures: Record<string, { completedAt: string; title: string; courseId: string | null }>;
  watchedVideos: Record<string, WatchedVideo>;
  watchedCourses: Record<string, WatchedCourse>;
}

export interface WatchedVideo {
  sessionId: string;
  title: string;
  courseId: string | null;
  watchedAt: string;
  completedAt?: string;
}

export interface WatchedCourse {
  courseId: string;
  name: string;
  watchedAt: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function load(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw) as Partial<StreakData>;
    return {
      ...defaultData(),
      ...data,
      completedLectures: data.completedLectures ?? {},
      watchedVideos: data.watchedVideos ?? {},
      watchedCourses: data.watchedCourses ?? {},
    };
  } catch {
    return defaultData();
  }
}

function defaultData(): StreakData {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastStudyDate: null,
    completedVideos: {},
    completedQuizzes: {},
    completedLectures: {},
    watchedVideos: {},
    watchedCourses: {},
  };
}

function save(data: StreakData) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(data));
  } catch {}
  notifyActivityUpdated();
}

function recalcStreak(data: StreakData): StreakData {
  const t = today();
  const y = yesterday();
  const last = data.lastStudyDate;

  if (!last) {
    data.currentStreak = 0;
  } else if (last === t) {
    // already studied today — streak unchanged
  } else if (last === y) {
    // studied yesterday → increment
    data.currentStreak += 1;
  } else {
    // missed a day → reset
    data.currentStreak = 1;
  }

  data.lastStudyDate = t;
  data.longestStreak = Math.max(data.longestStreak, data.currentStreak);
  return data;
}

export function markVideoWatched(sessionId: string, details?: { title?: string; courseId?: string | null }) {
  const data = load();
  const t = today();
  if (!data.completedVideos[t]) data.completedVideos[t] = [];
  if (!data.completedVideos[t].includes(sessionId)) {
    data.completedVideos[t].push(sessionId);
    recalcStreak(data);
  }
  const existing = data.watchedVideos[sessionId];
  data.watchedVideos[sessionId] = {
    sessionId,
    title: details?.title || existing?.title || sessionId,
    courseId: details?.courseId ?? existing?.courseId ?? null,
    watchedAt: new Date().toISOString(),
  };
  save(data);
  window.dispatchEvent(new Event("tnc-watched-videos-updated"));
}

export function getWatchedVideos(): WatchedVideo[] {
  const data = load();
  return Object.values(data.watchedVideos ?? {})
    .map((video) => ({
      ...video,
      completedAt: data.completedLectures[video.sessionId]?.completedAt,
    }))
    .sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));
}

export function isVideoCompleted(sessionId: string): boolean {
  return Boolean(load().completedLectures[sessionId]);
}

export function toggleVideoCompleted(sessionId: string, details: { title: string; courseId?: string | null }): boolean {
  const data = load();
  const existing = data.completedLectures[sessionId];
  if (existing) {
    delete data.completedLectures[sessionId];
  } else {
    const completedAt = new Date().toISOString();
    data.completedLectures[sessionId] = {
      completedAt,
      title: details.title,
      courseId: details.courseId ?? null,
    };
    const watched = data.watchedVideos[sessionId];
    data.watchedVideos[sessionId] = {
      sessionId,
      title: details.title || watched?.title || sessionId,
      courseId: details.courseId ?? watched?.courseId ?? null,
      watchedAt: watched?.watchedAt ?? completedAt,
    };
  }
  save(data);
  window.dispatchEvent(new Event("tnc-watched-videos-updated"));
  return !existing;
}

export function markCourseVisited(courseId: string, name: string) {
  const data = load();
  data.watchedCourses[courseId] = { courseId, name, watchedAt: new Date().toISOString() };
  save(data);
  window.dispatchEvent(new Event("tnc-watched-videos-updated"));
}

export function getWatchedCourses(): WatchedCourse[] {
  return Object.values(load().watchedCourses ?? {}).sort((a, b) => b.watchedAt.localeCompare(a.watchedAt));
}

export function clearWatchedVideos() {
  const data = load();
  data.watchedVideos = {};
  data.completedLectures = {};
  save(data);
  window.dispatchEvent(new Event("tnc-watched-videos-updated"));
}

export function clearWatchHistory() {
  const data = load();
  data.watchedVideos = {};
  data.watchedCourses = {};
  data.completedLectures = {};
  save(data);
  window.dispatchEvent(new Event("tnc-watched-videos-updated"));
}

export function markQuizCompleted(examId: string) {
  const data = load();
  const t = today();
  if (!data.completedQuizzes[t]) data.completedQuizzes[t] = [];
  if (!data.completedQuizzes[t].includes(examId)) {
    data.completedQuizzes[t].push(examId);
    recalcStreak(data);
    save(data);
  }
}

export function getStreakData(): StreakData & { todayVideos: number; todayQuizzes: number } {
  const data = load();
  const t = today();
  const y = yesterday();

  // If last activity was before yesterday, reset streak display
  if (data.lastStudyDate && data.lastStudyDate !== t && data.lastStudyDate !== y) {
    data.currentStreak = 0;
  }

  return {
    ...data,
    todayVideos: (data.completedVideos[t] ?? []).length,
    todayQuizzes: (data.completedQuizzes[t] ?? []).length,
  };
}

export function getTotalActivity(): number {
  const data = load();
  let count = 0;
  for (const vids of Object.values(data.completedVideos)) count += vids.length;
  for (const quizzes of Object.values(data.completedQuizzes)) count += quizzes.length;
  return count;
}

const FAV_KEY = FAVORITES_KEY;

interface FavData {
  courses: string[];
  quizzes: string[];
}

function loadFavs(): FavData {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return raw ? (JSON.parse(raw) as FavData) : { courses: [], quizzes: [] };
  } catch {
    return { courses: [], quizzes: [] };
  }
}

function saveFavs(data: FavData) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(data));
  } catch {}
  notifyActivityUpdated();
}

export function toggleFavorite(type: "courses" | "quizzes", id: string): boolean {
  const data = loadFavs();
  const arr = data[type];
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    saveFavs(data);
    return false;
  } else {
    arr.push(id);
    saveFavs(data);
    return true;
  }
}

export function isFavorite(type: "courses" | "quizzes", id: string): boolean {
  return loadFavs()[type].includes(id);
}

export function getFavorites(type: "courses" | "quizzes"): string[] {
  return loadFavs()[type];
}
