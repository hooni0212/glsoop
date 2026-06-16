const DAILY_WRITING_CAMPAIGN_KEY = 'glsoop-monthly-writing-project-prototype';
const DAILY_WRITING_CAMPAIGN_TITLE = '글숲 한달 글쓰기 프로젝트';
const DAILY_WRITING_CAMPAIGN_SUBTITLE = '매일 하나의 글감으로 30일 동안 글을 쌓아가요.';
const DAILY_WRITING_CAMPAIGN_TOTAL_DAYS = 30;
const CAMPAIGN_START_LOCAL_DATE = '2026-06-14';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DAILY_WRITING_PROMPTS = [
  {
    key: 'day-01-first-sentence',
    day: 1,
    title: '오늘 나를 붙잡은 첫 문장',
    body: '하루 중 마음에 남은 장면을 한 문장으로 시작해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['첫문장', '오늘기록', '글숲프로젝트'],
  },
  {
    key: 'day-02-window',
    day: 2,
    title: '창밖에서 시작된 생각',
    body: '지금 보이는 풍경이나 지나간 장면에서 떠오른 생각을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['창밖', '관찰', '일상'],
  },
  {
    key: 'day-03-small-kindness',
    day: 3,
    title: '작은 친절을 받은 날',
    body: '크지 않아도 오래 남는 친절의 순간을 기록해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['친절', '고마움', '관계'],
  },
  {
    key: 'day-04-unsent-message',
    day: 4,
    title: '보내지 못한 말',
    body: '누군가에게 끝내 전하지 못한 말을 글로 천천히 꺼내보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['못한말', '마음', '짧은글'],
  },
  {
    key: 'day-05-favorite-hour',
    day: 5,
    title: '내가 좋아하는 시간대',
    body: '아침, 오후, 밤 중 유난히 마음이 놓이는 시간을 묘사해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['시간', '취향', '일상'],
  },
  {
    key: 'day-06-old-photo',
    day: 6,
    title: '오래된 사진 속 나에게',
    body: '과거의 나에게 지금의 마음으로 짧은 편지를 써보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['사진', '편지', '회고'],
  },
  {
    key: 'day-07-rain-memory',
    day: 7,
    title: '비 오는 날의 기억',
    body: '빗소리, 냄새, 우산, 젖은 길 중 하나로 글을 시작해보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['비', '기억', '시'],
  },
  {
    key: 'day-08-my-pace',
    day: 8,
    title: '내 속도로 산다는 것',
    body: '남의 속도와 비교하지 않고 나를 지킨 순간을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['속도', '성장', '나답게'],
  },
  {
    key: 'day-09-comfort-food',
    day: 9,
    title: '나를 안심시키는 음식',
    body: '먹으면 마음이 누그러지는 음식과 그 이유를 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['음식', '위로', '기억'],
  },
  {
    key: 'day-10-goodbye',
    day: 10,
    title: '작별이 남긴 것',
    body: '끝난 관계, 계절, 습관이 남긴 감정을 글로 정리해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['작별', '정리', '마음'],
  },
  {
    key: 'day-11-walk',
    day: 11,
    title: '산책길에서 주운 생각',
    body: '걷다가 문득 떠오른 생각이나 본 것을 짧게 붙잡아보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['산책', '생각', '관찰'],
  },
  {
    key: 'day-12-recent-lie',
    day: 12,
    title: '요즘 내가 자주 하는 거짓말',
    body: '괜찮다는 말 뒤에 숨긴 진짜 마음을 안전하게 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['솔직함', '마음', '기록'],
  },
  {
    key: 'day-13-my-room',
    day: 13,
    title: '내 방이 나에 대해 말해주는 것',
    body: '책상, 침대, 조명, 물건 하나를 골라 나를 설명해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['공간', '내방', '자기소개'],
  },
  {
    key: 'day-14-dream',
    day: 14,
    title: '최근에 꾼 꿈',
    body: '기억나는 꿈의 장면을 현실처럼, 또는 시처럼 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['꿈', '장면', '상상'],
  },
  {
    key: 'day-15-thanks',
    day: 15,
    title: '오늘 고마웠던 세 가지',
    body: '사람, 물건, 날씨, 우연 중 고마운 것을 세 가지 골라보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['감사', '오늘', '기록'],
  },
  {
    key: 'day-16-worry',
    day: 16,
    title: '걱정에게 이름 붙이기',
    body: '요즘 마음을 차지하는 걱정을 하나의 이름으로 불러보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['걱정', '마음정리', '짧은글'],
  },
  {
    key: 'day-17-season',
    day: 17,
    title: '이번 계절이 내게 주는 것',
    body: '지금 계절의 빛, 냄새, 온도, 리듬을 글로 남겨보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['계절', '감각', '시'],
  },
  {
    key: 'day-18-object',
    day: 18,
    title: '버리지 못한 물건',
    body: '오래 가지고 있는 물건 하나에 얽힌 마음을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['물건', '추억', '기록'],
  },
  {
    key: 'day-19-one-line-diary',
    day: 19,
    title: '오늘을 한 줄로 남긴다면',
    body: '설명하지 않아도 오늘이 떠오르는 한 줄을 써보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['한줄', '오늘', '짧은글'],
  },
  {
    key: 'day-20-silence',
    day: 20,
    title: '침묵이 필요했던 순간',
    body: '말하지 않아서 오히려 지켜진 마음이나 관계를 떠올려보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['침묵', '관계', '마음'],
  },
  {
    key: 'day-21-music',
    day: 21,
    title: '반복해서 듣는 노래',
    body: '요즘 자주 듣는 노래가 내 마음 어디에 닿는지 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['노래', '감정', '일상'],
  },
  {
    key: 'day-22-regret',
    day: 22,
    title: '후회와 화해하기',
    body: '바꾸고 싶은 과거를 비난보다 이해의 문장으로 써보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['후회', '화해', '성장'],
  },
  {
    key: 'day-23-night',
    day: 23,
    title: '밤이 되면 선명해지는 것',
    body: '낮에는 흐렸지만 밤에 또렷해지는 감정을 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['밤', '감정', '시'],
  },
  {
    key: 'day-24-future-letter',
    day: 24,
    title: '한 달 뒤의 나에게',
    body: '지금의 마음을 한 달 뒤의 내가 읽는다고 생각하고 써보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['편지', '미래', '나에게'],
  },
  {
    key: 'day-25-boundary',
    day: 25,
    title: '내가 지키고 싶은 선',
    body: '관계나 일상에서 나를 위해 지키고 싶은 기준을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['경계', '나를지키기', '관계'],
  },
  {
    key: 'day-26-city',
    day: 26,
    title: '내가 사는 도시의 표정',
    body: '동네, 거리, 지하철, 카페 중 하나로 도시를 묘사해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['도시', '동네', '관찰'],
  },
  {
    key: 'day-27-small-win',
    day: 27,
    title: '아무도 몰라도 내가 이긴 일',
    body: '작지만 스스로에게 박수를 보내고 싶은 일을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['작은성취', '응원', '성장'],
  },
  {
    key: 'day-28-empty-space',
    day: 28,
    title: '비워두고 싶은 자리',
    body: '채우기보다 비워두고 싶은 마음의 공간을 써보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['여백', '마음', '시'],
  },
  {
    key: 'day-29-repeat',
    day: 29,
    title: '반복되는 하루 속 다른 점',
    body: '비슷한 하루 안에서 어제와 달랐던 작은 차이를 찾아보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['반복', '차이', '일상'],
  },
  {
    key: 'day-30-last-page',
    day: 30,
    title: '마지막 페이지에 남길 문장',
    body: '30일 프로젝트를 마무리하며 나에게 남기고 싶은 문장을 써보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['마지막문장', '완주', '글숲프로젝트'],
  },
];

const WRITING_EVENT_DEFINITIONS = [
  {
    key: DAILY_WRITING_CAMPAIGN_KEY,
    title: DAILY_WRITING_CAMPAIGN_TITLE,
    subtitle: DAILY_WRITING_CAMPAIGN_SUBTITLE,
    totalDays: DAILY_WRITING_CAMPAIGN_TOTAL_DAYS,
    startLocalDate: CAMPAIGN_START_LOCAL_DATE,
    prompts: DAILY_WRITING_PROMPTS,
    source: 'daily_writing_project',
    promptLabel: '오늘의 글감',
    pushCampaignKind: 'daily_writing_project_prompt',
  },
];

const WRITING_EVENT_BY_KEY = new Map(
  WRITING_EVENT_DEFINITIONS.map((event) => [event.key, event])
);

function formatKstDateKey(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseLocalDateMs(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return Date.UTC(2026, 5, 14);
  return Date.UTC(year, month - 1, day);
}

function getWritingEventDefinition(eventKey = DAILY_WRITING_CAMPAIGN_KEY) {
  return WRITING_EVENT_BY_KEY.get(eventKey) || null;
}

function getDefaultWritingEventDefinition() {
  return getWritingEventDefinition(DAILY_WRITING_CAMPAIGN_KEY);
}

function getWritingEventPrompt(eventKey, promptKey) {
  const event = getWritingEventDefinition(eventKey);
  if (!event || !promptKey) return null;
  return event.prompts.find((prompt) => prompt.key === promptKey) || null;
}

function getEventDayIndex(event, now = new Date()) {
  const totalDays = Math.max(1, Number(event?.totalDays) || event?.prompts?.length || 1);
  const startMs = parseLocalDateMs(event?.startLocalDate || CAMPAIGN_START_LOCAL_DATE);
  const currentMs = parseLocalDateMs(formatKstDateKey(now));
  const diffDays = Math.floor((currentMs - startMs) / DAY_MS);
  return ((diffDays % totalDays) + totalDays) % totalDays;
}

function buildWritingEventPromptWritePath(status = getDefaultWritingEventStatus()) {
  const prompt = status.prompt;
  const params = new URLSearchParams({
    campaignKey: status.campaignKey,
    campaignPromptKey: prompt.key,
    promptTitle: prompt.title,
    promptBody: prompt.body,
    promptCategory: prompt.defaultCategory,
    promptTags: prompt.suggestedHashtags.join(','),
    promptSource: status.title,
    promptDay: String(prompt.day),
  });

  return `/write?${params.toString()}`;
}

function getWritingEventStatus(eventKey = DAILY_WRITING_CAMPAIGN_KEY, now = new Date()) {
  const event = getWritingEventDefinition(eventKey);
  if (!event) return null;

  const promptIndex = getEventDayIndex(event, now);
  const prompt = event.prompts[promptIndex] || event.prompts[0];
  const currentDay = prompt.day;
  const completedDays = Math.max(0, currentDay - 1);
  const totalDays = Math.max(1, Number(event.totalDays) || event.prompts.length);
  const progressPercent = Math.round((currentDay / totalDays) * 100);
  const status = {
    campaignKey: event.key,
    title: event.title,
    subtitle: event.subtitle,
    totalDays,
    currentDay,
    completedDays,
    prompt,
    progressPercent,
    remainingDays: Math.max(0, totalDays - currentDay),
    localDateKey: formatKstDateKey(now),
    promptLabel: event.promptLabel || '오늘의 글감',
    pushCampaignKind: event.pushCampaignKind || 'writing_event_prompt',
  };

  return {
    ...status,
    writePath: buildWritingEventPromptWritePath(status),
  };
}

function getDefaultWritingEventStatus(now = new Date()) {
  return getWritingEventStatus(DAILY_WRITING_CAMPAIGN_KEY, now);
}

function getWritingEventProgressSteps(status = getDefaultWritingEventStatus()) {
  const event = getWritingEventDefinition(status?.campaignKey);
  if (!event) return [];

  return event.prompts.map((prompt) => {
    let state = 'upcoming';
    if (prompt.day < status.currentDay) state = 'completed';
    if (prompt.day === status.currentDay) state = 'current';
    return { ...prompt, state };
  });
}

function buildWritingEventContext(eventKey, promptKey) {
  const event = getWritingEventDefinition(eventKey);
  const prompt = getWritingEventPrompt(eventKey, promptKey);
  if (!event || !prompt) return null;

  return {
    eventKey: event.key,
    eventTitle: event.title,
    promptKey: prompt.key,
    promptDay: prompt.day,
    promptTitle: prompt.title,
    promptBody: prompt.body,
    source: event.source || 'writing_event',
  };
}

function buildDailyWritingPromptWritePath(status = getDailyWritingCampaignStatus()) {
  return buildWritingEventPromptWritePath(status);
}

function getDailyWritingCampaignStatus(now = new Date()) {
  return getDefaultWritingEventStatus(now);
}

function getDailyWritingCampaignProgressSteps(status = getDailyWritingCampaignStatus()) {
  return getWritingEventProgressSteps(status);
}

module.exports = {
  DAILY_WRITING_CAMPAIGN_KEY,
  DAILY_WRITING_CAMPAIGN_TITLE,
  DAILY_WRITING_CAMPAIGN_SUBTITLE,
  DAILY_WRITING_CAMPAIGN_TOTAL_DAYS,
  DAILY_WRITING_PROMPTS,
  WRITING_EVENT_DEFINITIONS,
  buildWritingEventContext,
  buildDailyWritingPromptWritePath,
  buildWritingEventPromptWritePath,
  getDailyWritingCampaignProgressSteps,
  getDailyWritingCampaignStatus,
  getDefaultWritingEventDefinition,
  getDefaultWritingEventStatus,
  getWritingEventDefinition,
  getWritingEventProgressSteps,
  getWritingEventPrompt,
  getWritingEventStatus,
};
