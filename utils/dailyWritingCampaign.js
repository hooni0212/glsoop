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
    title: '오늘 가장 기억에 남은 장면',
    body: '오늘 하루 중 유독 마음에 남은 순간을 한 문장으로 시작해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['첫문장', '오늘기록', '글숲프로젝트'],
  },
  {
    key: 'day-02-window',
    day: 2,
    title: '창밖을 보다가 든 생각',
    body: '지금 보이는 풍경이나 오늘 스쳐 지나간 장면에서 떠오른 생각을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['창밖', '관찰', '일상'],
  },
  {
    key: 'day-03-small-kindness',
    day: 3,
    title: '작은 친절을 받은 순간',
    body: '크지는 않았지만 기억에 남은 친절한 말이나 행동을 기록해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['친절', '고마움', '관계'],
  },
  {
    key: 'day-04-unsent-message',
    day: 4,
    title: '끝내 하지 못한 말',
    body: '누군가에게 전하지 못했던 말을 글로 천천히 꺼내보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['못한말', '마음', '짧은글'],
  },
  {
    key: 'day-05-favorite-hour',
    day: 5,
    title: '내가 편안해지는 시간대',
    body: '아침, 오후, 밤 중 나에게 가장 잘 맞는 시간과 그 이유를 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['시간', '취향', '일상'],
  },
  {
    key: 'day-06-old-photo',
    day: 6,
    title: '오래된 사진을 보며',
    body: '과거의 내 모습을 떠올리며 지금의 내가 해주고 싶은 말을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['사진', '편지', '회고'],
  },
  {
    key: 'day-07-rain-memory',
    day: 7,
    title: '비 오는 날 떠오르는 기억',
    body: '빗소리, 냄새, 우산, 젖은 길 중 하나를 골라 글을 시작해보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['비', '기억', '시'],
  },
  {
    key: 'day-08-my-pace',
    day: 8,
    title: '내 속도를 지킨 날',
    body: '남과 비교하지 않고 내 방식대로 해낸 일을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['속도', '성장', '나답게'],
  },
  {
    key: 'day-09-comfort-food',
    day: 9,
    title: '마음이 풀리는 음식',
    body: '먹으면 마음이 조금 나아지는 음식과 그 이유를 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['음식', '위로', '기억'],
  },
  {
    key: 'day-10-goodbye',
    day: 10,
    title: '끝난 뒤에 남은 것',
    body: '끝난 관계, 계절, 습관이 지금의 나에게 남긴 것을 정리해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['작별', '정리', '마음'],
  },
  {
    key: 'day-11-walk',
    day: 11,
    title: '산책 중 떠오른 생각',
    body: '걷다가 본 것, 들은 것, 문득 떠오른 생각을 짧게 적어보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['산책', '생각', '관찰'],
  },
  {
    key: 'day-12-recent-lie',
    day: 12,
    title: '요즘 자주 하는 말',
    body: '자주 하는 말 뒤에 숨은 진짜 마음이 있다면 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['솔직함', '마음', '기록'],
  },
  {
    key: 'day-13-my-room',
    day: 13,
    title: '내 방에서 나를 보여주는 것',
    body: '책상, 침대, 조명, 물건 하나를 골라 나와 연결해 설명해보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['공간', '내방', '자기소개'],
  },
  {
    key: 'day-14-dream',
    day: 14,
    title: '최근 기억나는 꿈',
    body: '최근에 꾼 꿈에서 가장 선명하게 남은 장면을 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['꿈', '장면', '상상'],
  },
  {
    key: 'day-15-thanks',
    day: 15,
    title: '오늘 고마웠던 세 가지',
    body: '사람, 물건, 날씨, 우연 중 오늘 고마웠던 것을 세 가지 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['감사', '오늘', '기록'],
  },
  {
    key: 'day-16-worry',
    day: 16,
    title: '요즘 가장 신경 쓰이는 일',
    body: '최근 마음을 자주 차지하는 걱정이나 고민을 하나 골라 적어보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['걱정', '마음정리', '짧은글'],
  },
  {
    key: 'day-17-season',
    day: 17,
    title: '이번 계절의 느낌',
    body: '지금 계절이 나에게 어떤 분위기로 다가오는지 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['계절', '감각', '시'],
  },
  {
    key: 'day-18-object',
    day: 18,
    title: '버리지 못한 물건',
    body: '오래 가지고 있는 물건 하나와 그 물건을 버리지 못하는 이유를 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['물건', '추억', '기록'],
  },
  {
    key: 'day-19-one-line-diary',
    day: 19,
    title: '오늘을 한 줄로 정리한다면',
    body: '오늘 하루를 가장 잘 설명하는 한 줄을 써보세요.',
    defaultCategory: 'short',
    suggestedHashtags: ['한줄', '오늘', '짧은글'],
  },
  {
    key: 'day-20-silence',
    day: 20,
    title: '말하지 않아서 남은 것',
    body: '말하지 않았기 때문에 달라졌거나 지켜진 것이 있다면 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['침묵', '관계', '마음'],
  },
  {
    key: 'day-21-music',
    day: 21,
    title: '요즘 자주 듣는 노래',
    body: '반복해서 듣는 노래가 있다면, 왜 자꾸 듣게 되는지 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['노래', '감정', '일상'],
  },
  {
    key: 'day-22-regret',
    day: 22,
    title: '후회하는 일을 다시 본다면',
    body: '바꾸고 싶은 과거의 일을 지금의 시선으로 다시 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['후회', '화해', '성장'],
  },
  {
    key: 'day-23-night',
    day: 23,
    title: '밤에 더 많이 생각나는 것',
    body: '낮보다 밤에 더 자주 떠오르는 감정이나 생각을 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['밤', '감정', '시'],
  },
  {
    key: 'day-24-future-letter',
    day: 24,
    title: '한 달 뒤의 나에게',
    body: '지금의 마음과 상황을 한 달 뒤의 내가 읽는다고 생각하고 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['편지', '미래', '나에게'],
  },
  {
    key: 'day-25-boundary',
    day: 25,
    title: '내가 지키고 싶은 기준',
    body: '관계나 일상에서 나를 위해 지키고 싶은 기준 하나를 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['경계', '나를지키기', '관계'],
  },
  {
    key: 'day-26-city',
    day: 26,
    title: '내가 사는 동네의 모습',
    body: '동네, 거리, 지하철, 카페 중 하나를 골라 평소 보던 장면을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['도시', '동네', '관찰'],
  },
  {
    key: 'day-27-small-win',
    day: 27,
    title: '나만 아는 작은 성취',
    body: '남들이 몰라도 스스로 인정해주고 싶은 일을 적어보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['작은성취', '응원', '성장'],
  },
  {
    key: 'day-28-empty-space',
    day: 28,
    title: '비워두고 싶은 것',
    body: '당장 채우거나 해결하지 않고, 조금 비워두고 싶은 마음이나 일을 적어보세요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['여백', '마음', '시'],
  },
  {
    key: 'day-29-repeat',
    day: 29,
    title: '비슷한 하루에서 달랐던 점',
    body: '비슷한 하루 안에서 어제와 달랐던 작은 차이를 찾아보세요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['반복', '차이', '일상'],
  },
  {
    key: 'day-30-last-page',
    day: 30,
    title: '30일을 마치며 남기는 문장',
    body: '한 달 동안 글을 쓰며 나에게 남은 생각을 한 문장으로 정리해보세요.',
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
