const DAILY_WRITING_CAMPAIGN_KEY = 'glsoop-monthly-writing-project-prototype';
const DAILY_WRITING_CAMPAIGN_TITLE = '글숲 한달 글쓰기 프로젝트';
const DAILY_WRITING_CAMPAIGN_SUBTITLE = '매일 하나의 글감으로 30일 동안 글을 쌓아가요.';
const DAILY_WRITING_CAMPAIGN_TOTAL_DAYS = 30;
const CAMPAIGN_START_LOCAL_DATE = '2026-06-14';
const NEXT_DAILY_WRITING_PROMPTS_START_LOCAL_DATE = '2026-07-14';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const NEXT_DAILY_WRITING_PROMPTS = [
  {
    key: 'day-01-kind-gaze',
    day: 1,
    title: '나를 다정하게 바라보는 달',
    body: '매일 하나씩, 나에게 건넬 수 있는 부드러운 말을 기록해요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['다정함', '나에게', '글숲프로젝트'],
  },
  {
    key: 'day-02-remaining-feelings',
    day: 2,
    title: '사라지지 않은 마음들',
    body: '잊은 줄 알았지만 아직 안쪽에 남아 있는 감정을 천천히 꺼내봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['남은마음', '감정기록', '마음'],
  },
  {
    key: 'day-03-holding-today',
    day: 3,
    title: '오늘을 붙잡는 문장',
    body: '흘러가버릴 하루에서 오래 남기고 싶은 장면을 적어봐요.',
    defaultCategory: 'short',
    suggestedHashtags: ['오늘문장', '장면기록', '하루'],
  },
  {
    key: 'day-04-places-i-stayed',
    day: 4,
    title: '내가 머문 자리들',
    body: '집, 거리, 카페, 버스정류장처럼 내가 지나온 공간을 글로 남겨요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['공간기록', '머문자리', '일상'],
  },
  {
    key: 'day-05-unsaid-words',
    day: 5,
    title: '말하지 못한 말들',
    body: '그때는 삼켰지만 이제는 조용히 꺼내보고 싶은 말을 적어봐요.',
    defaultCategory: 'short',
    suggestedHashtags: ['말하지못한말', '마음', '짧은글'],
  },
  {
    key: 'day-06-small-comfort',
    day: 6,
    title: '작은 위로의 방식',
    body: '거창하지 않아도 누군가를 살게 하는 다정한 말들을 모아봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['위로', '다정한말', '관계'],
  },
  {
    key: 'day-07-inner-season',
    day: 7,
    title: '내 마음의 계절',
    body: '지금 내 안에 머무는 계절의 온도와 풍경을 글로 기록해요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['마음의계절', '감정', '시'],
  },
  {
    key: 'day-08-ordinary-beauty',
    day: 8,
    title: '평범한 날의 아름다움',
    body: '아무 일도 없었던 하루 속에서 발견한 작은 빛을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['평범한날', '아름다움', '일상'],
  },
  {
    key: 'day-09-forming-memories',
    day: 9,
    title: '나를 만든 기억들',
    body: '지금의 나를 조금씩 만든 사람, 장소, 사건을 돌아봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['기억', '나를만든것', '회고'],
  },
  {
    key: 'day-10-alone-time',
    day: 10,
    title: '혼자 있는 시간의 기록',
    body: '외로움과 고요함 사이에서 내가 만난 마음을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['혼자있는시간', '고요함', '마음'],
  },
  {
    key: 'day-11-practicing-kindness',
    day: 11,
    title: '다정함을 연습하는 달',
    body: '차가운 말보다 부드러운 시선을 선택하는 글쓰기를 해봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['다정함', '연습', '시선'],
  },
  {
    key: 'day-12-long-watched-things',
    day: 12,
    title: '오래 바라본 것들',
    body: '자주 지나쳤지만 사실은 오래 마음에 남아 있던 것들을 기록해요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['오래바라본것', '관찰', '기록'],
  },
  {
    key: 'day-13-resting-sentence',
    day: 13,
    title: '마음이 쉬어가는 문장',
    body: '지친 하루 끝에 나를 잠시 앉혀둘 수 있는 문장을 써봐요.',
    defaultCategory: 'short',
    suggestedHashtags: ['쉬어가는문장', '위로', '짧은글'],
  },
  {
    key: 'day-14-beloved-small-things',
    day: 14,
    title: '내가 사랑한 사소함',
    body: '작은 습관, 냄새, 소리, 표정처럼 사소하지만 소중한 것을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['사소함', '취향', '소중한것'],
  },
  {
    key: 'day-15-grown-up-lessons',
    day: 15,
    title: '어른이 되어 알게 된 것들',
    body: '시간이 지나서야 이해하게 된 마음과 관계를 돌아봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['어른이되어', '관계', '이해'],
  },
  {
    key: 'day-16-after-hurt',
    day: 16,
    title: '상처 이후의 나',
    body: '아팠던 시간을 지나 지금의 내가 붙잡고 있는 것을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['상처이후', '회복', '마음'],
  },
  {
    key: 'day-17-quiet-tastes',
    day: 17,
    title: '나의 조용한 취향들',
    body: '좋아하는 색, 문장, 날씨, 분위기처럼 나를 닮은 취향을 기록해요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['조용한취향', '나를닮은것', '취향'],
  },
  {
    key: 'day-18-letting-go',
    day: 18,
    title: '하루에 하나씩 덜어내기',
    body: '미움, 후회, 비교, 불안을 조금씩 내려놓는 글을 써봐요.',
    defaultCategory: 'short',
    suggestedHashtags: ['덜어내기', '불안', '마음정리'],
  },
  {
    key: 'day-19-revisit-moment',
    day: 19,
    title: '다시 살고 싶은 순간',
    body: '가능하다면 한 번쯤 돌아가 머물고 싶은 장면을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['다시살고싶은순간', '장면', '기억'],
  },
  {
    key: 'day-20-life-giving-words',
    day: 20,
    title: '나를 살게 한 말들',
    body: '누군가의 한마디, 책 속 문장, 스스로의 다짐을 모아봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['나를살게한말', '문장', '다짐'],
  },
  {
    key: 'day-21-relationship-temperature',
    day: 21,
    title: '관계의 온도를 기록하는 달',
    body: '가까운 사람들과의 거리, 고마움, 서운함을 솔직하게 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['관계의온도', '고마움', '서운함'],
  },
  {
    key: 'day-22-inner-forest',
    day: 22,
    title: '내 안의 작은 숲',
    body: '복잡한 마음속에서도 조용히 자라고 있는 나만의 세계를 써봐요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['내안의숲', '나만의세계', '시'],
  },
  {
    key: 'day-23-observing-emotion',
    day: 23,
    title: '오늘의 감정을 관찰하기',
    body: '기쁨, 무기력, 불안, 평온처럼 오늘의 감정을 판단 없이 바라봐요.',
    defaultCategory: 'short',
    suggestedHashtags: ['감정관찰', '오늘감정', '마음'],
  },
  {
    key: 'day-24-letter-to-old-self',
    day: 24,
    title: '오래된 나에게 보내는 편지',
    body: '과거의 나, 어린 나, 버텨온 나에게 하고 싶은 말을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['오래된나에게', '편지', '회고'],
  },
  {
    key: 'day-25-less-hate-life',
    day: 25,
    title: '삶을 조금 덜 미워하는 법',
    body: '마음에 들지 않는 하루 속에서도 미워하지 않을 이유를 찾아봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['덜미워하기', '하루', '마음'],
  },
  {
    key: 'day-26-people-passed-through',
    day: 26,
    title: '나를 지나간 사람들',
    body: '내 삶에 잠시 머물렀거나 오래 남은 사람들에 대해 써봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['지나간사람들', '관계', '기억'],
  },
  {
    key: 'day-27-after-collapse',
    day: 27,
    title: '무너진 날에도 남은 것',
    body: '힘들었던 하루 끝에서도 끝내 사라지지 않은 것을 기록해요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['무너진날', '남은것', '회복'],
  },
  {
    key: 'day-28-self-permission',
    day: 28,
    title: '내가 나에게 허락할 것들',
    body: '쉬어도 되는 마음, 울어도 되는 마음, 다시 시작해도 되는 마음을 적어봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['허락', '나에게', '마음'],
  },
  {
    key: 'day-29-night-thoughts',
    day: 29,
    title: '밤에 떠오르는 생각',
    body: '낮에는 지나쳤지만 밤이 되면 선명해지는 마음을 글로 남겨요.',
    defaultCategory: 'poem',
    suggestedHashtags: ['밤생각', '마음', '시'],
  },
  {
    key: 'day-30-trust-myself-again',
    day: 30,
    title: '다시 나를 믿어보는 달',
    body: '흔들리는 마음 속에서도 나를 조금씩 믿어보는 연습을 해봐요.',
    defaultCategory: 'essay',
    suggestedHashtags: ['나를믿기', '다시시작', '글숲프로젝트'],
  },
];

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

const DAILY_WRITING_PROMPT_SETS = [
  {
    key: 'current-2026-06',
    startsLocalDate: CAMPAIGN_START_LOCAL_DATE,
    prompts: DAILY_WRITING_PROMPTS,
  },
  {
    key: 'next-2026-07',
    startsLocalDate: NEXT_DAILY_WRITING_PROMPTS_START_LOCAL_DATE,
    prompts: NEXT_DAILY_WRITING_PROMPTS,
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
    promptSets: DAILY_WRITING_PROMPT_SETS,
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

function getWritingEventPromptSet(event, now = new Date()) {
  const promptSets = Array.isArray(event?.promptSets) ? event.promptSets : [];
  if (promptSets.length === 0) return null;

  const currentMs = parseLocalDateMs(formatKstDateKey(now));
  const totalDays = Math.max(1, Number(event?.totalDays) || event?.prompts?.length || 1);
  return promptSets.reduce((activeSet, promptSet) => {
    const startsMs = parseLocalDateMs(promptSet.startsLocalDate);
    const endsMs = startsMs + (totalDays - 1) * DAY_MS;
    if (currentMs < startsMs || currentMs > endsMs) return activeSet;
    if (!activeSet) return promptSet;
    return startsMs >= parseLocalDateMs(activeSet.startsLocalDate) ? promptSet : activeSet;
  }, null);
}

function getNextWritingEventPromptSet(event, now = new Date()) {
  const promptSets = Array.isArray(event?.promptSets) ? event.promptSets : [];
  if (promptSets.length === 0) return null;

  const currentMs = parseLocalDateMs(formatKstDateKey(now));
  return (
    promptSets
      .filter((promptSet) => parseLocalDateMs(promptSet.startsLocalDate) > currentMs)
      .sort((a, b) => parseLocalDateMs(a.startsLocalDate) - parseLocalDateMs(b.startsLocalDate))[0] ||
    null
  );
}

function getWritingEventPrompts(event, now = new Date()) {
  const promptSets = Array.isArray(event?.promptSets) ? event.promptSets : [];
  if (promptSets.length === 0) return event?.prompts || [];
  return getWritingEventPromptSet(event, now)?.prompts || [];
}

function listWritingEventPrompts(event) {
  const prompts = [
    ...(Array.isArray(event?.prompts) ? event.prompts : []),
    ...(Array.isArray(event?.promptSets)
      ? event.promptSets.flatMap((promptSet) => promptSet.prompts || [])
      : []),
  ];

  return Array.from(new Map(prompts.map((prompt) => [prompt.key, prompt])).values());
}

function getWritingEventPrompt(eventKey, promptKey) {
  const event = getWritingEventDefinition(eventKey);
  if (!event || !promptKey) return null;
  return listWritingEventPrompts(event).find((prompt) => prompt.key === promptKey) || null;
}

function getEventDayIndex(event, now = new Date(), startLocalDate, options = {}) {
  const totalDays = Math.max(1, Number(event?.totalDays) || event?.prompts?.length || 1);
  const startMs = parseLocalDateMs(startLocalDate || event?.startLocalDate || CAMPAIGN_START_LOCAL_DATE);
  const currentMs = parseLocalDateMs(formatKstDateKey(now));
  const diffDays = Math.floor((currentMs - startMs) / DAY_MS);
  if (options.repeat === false) return diffDays;
  return ((diffDays % totalDays) + totalDays) % totalDays;
}

function buildWritingEventPromptWritePath(status = getDefaultWritingEventStatus()) {
  if (!status?.prompt) return null;
  if (status.writePath) return status.writePath;
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

  const promptSet = getWritingEventPromptSet(event, now);
  const nextPromptSet = getNextWritingEventPromptSet(event, now);
  const hasPromptSets = Array.isArray(event.promptSets) && event.promptSets.length > 0;
  const prompts = getWritingEventPrompts(event, now);
  const totalDays = Math.max(1, Number(event.totalDays) || prompts.length || event.prompts?.length || 1);
  const baseStatus = {
    campaignKey: event.key,
    title: event.title,
    subtitle: event.subtitle,
    totalDays,
    currentDay: 0,
    completedDays: 0,
    prompt: null,
    progressPercent: 0,
    remainingDays: 0,
    localDateKey: formatKstDateKey(now),
    promptLabel: event.promptLabel || '오늘의 글감',
    pushCampaignKind: event.pushCampaignKind || 'writing_event_prompt',
    active: false,
    promptSetKey: null,
    promptSetStartsLocalDate: null,
    nextPromptSetKey: nextPromptSet?.key || null,
    nextPromptSetStartsLocalDate: nextPromptSet?.startsLocalDate || null,
    prompts: [],
    writePath: null,
  };

  if (prompts.length === 0 || (hasPromptSets && !promptSet)) {
    return baseStatus;
  }

  const promptIndex = getEventDayIndex(event, now, promptSet?.startsLocalDate || event.startLocalDate, {
    repeat: !hasPromptSets,
  });
  if (promptIndex < 0 || promptIndex >= prompts.length) {
    return baseStatus;
  }

  const prompt = prompts[promptIndex] || prompts[0];
  const currentDay = prompt.day;
  const completedDays = Math.max(0, currentDay - 1);
  const progressPercent = Math.round((currentDay / totalDays) * 100);
  const status = {
    ...baseStatus,
    totalDays,
    currentDay,
    completedDays,
    prompt,
    progressPercent,
    remainingDays: Math.max(0, totalDays - currentDay),
    active: true,
    promptSetKey: promptSet?.key || null,
    promptSetStartsLocalDate: promptSet?.startsLocalDate || event.startLocalDate,
    prompts,
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
  if (!event || !status?.active || !status?.prompt) return [];
  const prompts = Array.isArray(status?.prompts) ? status.prompts : event.prompts;

  return prompts.map((prompt) => {
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
  NEXT_DAILY_WRITING_PROMPTS,
  NEXT_DAILY_WRITING_PROMPTS_START_LOCAL_DATE,
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
  getWritingEventPrompts,
  getWritingEventStatus,
};
