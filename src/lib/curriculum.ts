import { addDays } from './text'
import type { Progress, SessionLog, Stage, Unit } from './types'

// 교육과정: 완전 초보(A1)부터 원어민 수준(C2)까지 6단계, 단계마다 단원 10개.
// 단계가 오를수록 AI 문장이 길어지고, 한국어 도움·대답 예시·따라 말하기가 줄고, 고쳐 주는 방식이 직접적으로 바뀐다.
// hours는 Cambridge English의 CEFR 누적 '수업 시간' 안내치(처음부터 그 단계까지). 한국어 화자는 더 걸릴 수 있다.
export const STAGES: Stage[] = [
  {
    n: 1,
    name: '첫걸음',
    cefr: 'A1',
    goal: '짧은 표현으로 나에 대해 말하고, 쉬운 질문에 대답하기',
    canDo: ['인사하고 나를 소개할 수 있다', '기분·좋아하는 것·원하는 것을 한 문장으로 말할 수 있다', '천천히 말하면 쉬운 질문을 알아듣는다'],
    hours: '약 90~100시간',
    speaker:
      '단어는 조금 읽지만 모르는 단어가 많고, 문법은 모르고, 영어로 말해 본 적이 거의 없어. 스스로 문장을 지어내기 어렵다고 생각하고 도와줘.',
    sayRule:
      '반응 한마디 + 아주 쉬운 질문 하나. 최대 2문장, 한 문장에 6단어 이하, 아주 쉬운 단어만. 내가 방금 한 말을 영어로 바꿔 repeat로 줄 때만 질문 없이 반응만.',
    repeatRule: '6단어 이하, 통째로 외워 바로 쓸 수 있는 표현.',
    hintRule: 'say에 질문이 있으면 항상, 내가 그대로 따라 쓸 수 있는 아주 쉬운 대답 2개(각 1~5단어)와 뜻.',
    tipRule: '평소엔 빈칸. 내가 한국어로 이유를 물을 때만 한국어 한두 문장으로 쉽게(문법 용어 없이).',
    correction: '틀려도 지적하지 말고, 맞는 문장으로 자연스럽게 되받아 말해. 예: "I go park" → "Oh, you went to the park?"',
    extra: '문법 대신 통째로 쓰는 틀을 반복해: "I\'m ~.", "I like ~.", "I want ~.", "Can I ~?" 같은 것. 같은 틀을 다른 단어로 여러 번 쓰게 해.',
    activity: '짧게 묻고 답하며, 연습할 표현을 듣고 따라 말하게 해.',
    defaults: { rate: 0.8, showKo: true, repeatAmount: '많이' },
    routine: [
      '앱 대화 15분',
      '내 문장 노트의 문장을 듣고 소리 내어 따라 하기 10분',
      '유아용 영어 애니메이션을 영어 자막으로 20분 (다 못 알아들어도 괜찮아요. 소리에 익숙해지는 게 목표)',
    ],
    promote: { ratio: 0.5, words: 3 },
    units: [
      { id: 's1-1', title: '인사와 자기소개', focus: '"Hi, I\'m ~." / "Nice to meet you." / "I\'m from Korea."' },
      { id: 's1-2', title: '오늘 기분', focus: '"I\'m tired." / "I\'m happy." / "I\'m so-so."' },
      { id: 's1-3', title: '좋아하는 음식', focus: '"I like ~." / "I don\'t like ~." / "Do you like ~?"' },
      { id: 's1-4', title: '원하는 것 말하기', focus: '"I want ~." / "Can I have ~?" / "Water, please."' },
      { id: 's1-5', title: '나의 하루', focus: '"I get up at ~." / "I go to work." / "I eat lunch at ~."' },
      { id: 's1-6', title: '가족과 친구', focus: '"I have a ~." / "This is my ~." / "She is ~."' },
      { id: 's1-7', title: '날씨와 계절', focus: '"It\'s cold." / "It\'s sunny." / "I like summer."' },
      { id: 's1-8', title: '숫자와 시간', focus: '"It\'s 3 o\'clock." / "How much is it?" / "I\'m 40."' },
      { id: 's1-9', title: '취미', focus: '"I play ~." / "I watch ~." / "I like ~ing."' },
      { id: 's1-10', title: '집과 동네', focus: '"I live in ~." / "There is a ~ near my house."' },
    ],
  },
  {
    n: 2,
    name: '기초 대화',
    cefr: 'A2',
    goal: '어제 한 일과 계획을 짧은 문장 여러 개로 말하기',
    canDo: ['지난 일과 계획을 말할 수 있다', '가게·식당에서 필요한 말을 할 수 있다', '대답에 이유를 한 문장 덧붙일 수 있다'],
    hours: '약 180~200시간',
    speaker: '자주 쓰는 표현은 알아듣고 짧은 문장으로 대답할 수 있어. 과거·미래 표현은 아직 서툴러.',
    sayRule: '반응 + 질문 하나. 최대 2문장, 한 문장에 10단어 이하, 일상 단어 위주.',
    repeatRule: '10단어 이하, 이번 단원 표현이 들어간 문장.',
    hintRule: '내가 한국어로 대답했거나 막힌 것 같을 때만 쉬운 대답 2개와 뜻. 영어로 잘 대답하고 있으면 빈 배열.',
    tipRule: '평소엔 빈칸. 내가 한국어로 이유를 물을 때만 한국어 한두 문장으로 쉽게(문법 용어 없이).',
    correction: '틀려도 지적하지 말고, 맞는 문장으로 자연스럽게 되받아 말해.',
    extra: '이번 단원의 틀을 다른 단어로 바꿔 가며 여러 번 쓰게 해. 대답이 한 단어면 "Why?"나 "What else?"로 한 문장 더 말하게 이끌어.',
    activity: '일상 이야기를 주고받으며 연습할 표현을 내가 직접 쓰게 해.',
    defaults: { rate: 0.85, showKo: true, repeatAmount: '보통' },
    routine: [
      '앱 대화 15분',
      '쉐도잉 10분: 내 문장 노트나 쉬운 영상에서 한 문장 듣고 바로 똑같이 따라 말하기',
      '쉬운 영어 책(학습자용 그레이디드 리더)이나 학습자용 영상 30분',
    ],
    promote: { ratio: 0.8, words: 5 },
    units: [
      { id: 's2-1', title: '어제 한 일', focus: '"I went to ~." / "I ate ~." / "I watched ~." (지난 일 말하기)' },
      { id: 's2-2', title: '주말 계획', focus: '"I\'m going to ~." / "I will ~." / "Maybe I\'ll ~."' },
      { id: 's2-3', title: '카페·식당에서 주문', focus: '"Could I get ~?" / "For here, please." / "Can I have the check?"', roleplay: true },
      { id: 's2-4', title: '쇼핑하기', focus: '"Do you have this in ~?" / "How much is this?" / "I\'ll take it."', roleplay: true },
      { id: 's2-5', title: '길 묻고 답하기', focus: '"Where is ~?" / "Go straight and turn left." / "Is it far?"', roleplay: true },
      { id: 's2-6', title: '일과 직장', focus: '"I work at ~." / "My job is ~." / "I usually ~."' },
      { id: 's2-7', title: '약속 잡기', focus: '"Are you free on ~?" / "How about ~?" / "Sounds good."' },
      { id: 's2-8', title: '몸과 건강', focus: '"I have a headache." / "I feel sick." / "You should rest."' },
      { id: 's2-9', title: '가 본 곳', focus: '"I\'ve been to ~." / "Have you ever ~?" / "It was ~."' },
      { id: 's2-10', title: '비교하기', focus: '"A is bigger than B." / "I like A more than B." / "the best ~"' },
    ],
  },
  {
    n: 3,
    name: '자립 대화',
    cefr: 'B1',
    goal: '익숙한 주제에서 막히지 않고 이야기 이어 가기, 상황극으로 실전 연습',
    canDo: ['여행·생활에서 생기는 일을 영어로 해결할 수 있다', '경험을 순서대로 이야기할 수 있다', '간단한 의견과 이유를 말할 수 있다'],
    hours: '약 350~400시간',
    speaker: '익숙한 주제는 영어로 대화할 수 있지만 문장이 짧고 자주 막혀.',
    sayRule: '자연스러운 반응 + 질문. 2~3문장, 한 문장에 15단어 이하. 자주 쓰는 구동사·관용 표현을 조금씩 섞어.',
    repeatRule: '더 자연스러운 말투를 보여 줄 때만, 15단어 이하.',
    hintRule: '내가 한국어로 대답했을 때만 쉬운 대답 2개와 뜻. 아니면 빈 배열.',
    tipRule: '대여섯 번에 한 번, 내가 반복해서 틀리는 것이나 더 자연스러운 표현을 한국어 한 문장으로. 나머지는 빈칸.',
    correction: '먼저 맞는 문장으로 되받아 말하고, 같은 실수가 반복되면 tip으로 짧게 알려 줘.',
    extra: '대답이 짧으면 "Tell me more."처럼 더 말하게 해. 이야기는 First, Then, After that 같은 순서 말로 하게 이끌어.',
    activity: '상황극이나 경험 이야기로 대화를 길게 이어 가.',
    defaults: { rate: 0.9, showKo: false, repeatAmount: '적게' },
    routine: [
      '앱 대화 20분 (상황극)',
      '학습자용 영어 팟캐스트 20분',
      '관심 분야의 쉬운 영어 글 15분',
      '하루 한 번 영어로 세 문장 일기 쓰기',
    ],
    promote: { ratio: 0.95, words: 8 },
    units: [
      { id: 's3-1', title: '공항·호텔 체크인', focus: '"I have a reservation." / "Could I get a window seat?" / "What time is check-out?"', roleplay: true },
      { id: 's3-2', title: '주문이 잘못 왔을 때', focus: '"Excuse me, I ordered ~." / "I think there\'s a mistake." / "Could you change it?"', roleplay: true },
      { id: 's3-3', title: '전화로 예약하기', focus: '"I\'d like to book ~." / "Is ~ available?" / "Could you repeat that?"', roleplay: true },
      { id: 's3-4', title: '기억에 남는 경험', focus: '"First, ~. Then, ~. After that, ~." / "It was the best ~ ever."' },
      { id: 's3-5', title: '의견과 이유', focus: '"I think ~ because ~." / "In my opinion, ~." / "I\'m not sure, but ~."' },
      { id: 's3-6', title: '조언 구하고 주기', focus: '"What should I do?" / "You should ~." / "Why don\'t you ~?"' },
      { id: 's3-7', title: '내 일 설명하기', focus: '"I\'m in charge of ~." / "My main task is ~." / "It makes ~ easier."' },
      { id: 's3-8', title: '영화·드라마 이야기', focus: '"It\'s about ~." / "The main character is ~." / "I recommend it because ~."' },
      { id: 's3-9', title: '부탁과 거절', focus: '"Would you mind ~ing?" / "Could you do me a favor?" / "I\'m afraid I can\'t."' },
      { id: 's3-10', title: '꿈과 계획', focus: '"I\'d like to ~ someday." / "I\'m planning to ~." / "My goal is to ~."' },
    ],
  },
  {
    n: 4,
    name: '자신감 있는 대화',
    cefr: 'B2',
    goal: '의견을 근거와 함께 길게 말하고, 원어민 속도를 따라가기',
    canDo: ['찬반이 있는 주제에서 근거를 들어 말할 수 있다', '들은 내용을 요약할 수 있다', '원어민 친구와 큰 막힘 없이 대화할 수 있다'],
    hours: '약 500~600시간',
    speaker: '일상 대화는 대부분 할 수 있고, 이제 의견을 근거와 함께 길게 말하는 연습이 필요해.',
    sayRule: '원어민이 친구에게 말하듯 자연스럽게, 2~4문장. 어려운 단어는 가끔만.',
    repeatRule: '내 말을 원어민답게 다듬은 버전을 보여 줄 때만(가끔).',
    hintRule: '항상 빈 배열.',
    tipRule: '서너 번에 한 번, 더 원어민다운 표현이나 반복되는 실수를 한국어 한 문장으로. 나머지는 빈칸.',
    correction: '먼저 맞는 문장으로 되받아 말하고, 반복되는 실수는 tip으로 알려 줘.',
    extra: '내 의견에 "Why do you think so?", "What about ~?"처럼 반론이나 다른 관점을 던져서 길게 말하게 해.',
    activity: '의견·토론·요약 위주로, 단원 활동을 충실히 진행해.',
    defaults: { rate: 1, showKo: false, repeatAmount: '적게' },
    routine: [
      '앱 대화 20분 (의견·토론)',
      '영어 드라마·유튜브를 영어 자막으로 30분',
      '영어 뉴스 기사 1개 읽고, 앱에서 요약해 말하기',
    ],
    promote: { ratio: 0.95, words: 12 },
    units: [
      { id: 's4-1', title: '찬반 토론: 재택근무', focus: '"On the one hand, ~. On the other hand, ~." / "I see your point, but ~."' },
      { id: 's4-2', title: '뉴스 요약하고 생각 말하기', focus: '"The article says ~." / "What surprised me is ~." / "I think it means ~."' },
      { id: 's4-3', title: '회의에서 제안하기', focus: '"What if we ~?" / "I\'d suggest ~." / "I agree to some extent, but ~."', roleplay: true },
      { id: 's4-4', title: '장단점 따지기', focus: '"The main advantage is ~." / "The downside is ~." / "It depends on ~."' },
      { id: 's4-5', title: '가정해서 말하기', focus: '"If I were ~, I would ~." / "If I had ~, I could ~."' },
      { id: 's4-6', title: '문제 설명과 해결책', focus: '"The problem is that ~." / "One solution would be ~." / "That way, ~."' },
      {
        id: 's4-7',
        title: '같은 이야기 더 짧게 다시 말하기',
        focus: '"To put it simply, ~." / "In short, ~." (한 이야기를 하게 한 뒤, 더 짧게 두 번 다시 말하게 해)',
      },
      { id: 's4-8', title: '자주 쓰는 구동사', focus: '"figure out" / "come up with" / "run into" / "look forward to"' },
      { id: 's4-9', title: '감정을 섬세하게', focus: '"I\'m a bit worried that ~." / "I was thrilled when ~." / "It\'s frustrating that ~."' },
      { id: 's4-10', title: '기술과 AI 이야기', focus: '"It saves me a lot of time." / "The tricky part is ~." / "In the long run, ~."' },
    ],
  },
  {
    n: 5,
    name: '유창한 대화',
    cefr: 'C1',
    goal: '복잡한 주제를 자연스럽게, 상황에 맞는 표현을 골라 말하기',
    canDo: ['토론에서 반론에 바로 답할 수 있다', '발표하고 질문에 답할 수 있다', '말투를 정중하게·편하게 바꿀 수 있다'],
    hours: '약 700~800시간',
    speaker: '복잡한 주제도 말할 수 있어. 이제 표현을 골라 쓰고, 상황에 맞게 말투를 바꾸는 연습이 필요해.',
    sayRule: '원어민끼리 말하듯 자연스러운 길이와 속도. 관용어·구동사를 자연스럽게 섞어.',
    repeatRule: '거의 쓰지 마. 꼭 알려 줄 원어민 표현이 있을 때만.',
    hintRule: '항상 빈 배열.',
    tipRule: '세 번에 한 번 정도, 뉘앙스 차이나 더 세련된 표현을 한국어 한 문장으로. 나머지는 빈칸.',
    correction: '어색한 표현은 "원어민은 보통 ~라고 해" 식으로 tip에 바로 알려 줘.',
    extra: '내 논리의 빈틈을 짚고 반박해서 더 정교하게 말하게 해.',
    activity: '토론·발표·협상 같은 단원 활동을 실전처럼 진행해.',
    defaults: { rate: 1, showKo: false, repeatAmount: '적게' },
    routine: [
      '앱 대화 20분 (토론·발표)',
      '자막 없이 영어 영상·팟캐스트 40분',
      '영어로 글쓰기 (업무 메일, 짧은 글)',
      '사람과 영어로 대화 주 1~2회 (언어 교환, 화상 수업)',
    ],
    promote: { ratio: 0.95, words: 15 },
    units: [
      { id: 's5-1', title: '반론에 답하기', focus: '"That\'s a fair point, but ~." / "I\'d argue that ~." / "Let me put it another way."' },
      { id: 's5-2', title: '3분 발표와 질문 받기', focus: '"Today I\'d like to talk about ~." / "That\'s a great question." / "To sum up, ~."' },
      { id: 's5-3', title: '관용어와 비유', focus: '"a piece of cake" / "hit the nail on the head" / "the ball is in your court"' },
      { id: 's5-4', title: '직설과 완곡 사이', focus: '"I was wondering if ~." / "It might be better to ~." / "To be honest, ~."' },
      { id: 's5-5', title: '이야기를 재밌게', focus: '"You won\'t believe what happened." / "So there I was, ~." / "Long story short, ~."' },
      { id: 's5-6', title: '협상하기', focus: '"Is there any flexibility on ~?" / "What if we met halfway?" / "That works for me."', roleplay: true },
      { id: 's5-7', title: '추상적인 주제', focus: '"It comes down to ~." / "There\'s no easy answer, but ~." / "From a broader perspective, ~."' },
      { id: 's5-8', title: '비슷한 말 골라 쓰기', focus: 'say / tell / talk / speak, make / do, borrow / lend 의 차이를 대화로' },
      { id: 's5-9', title: '면접', focus: '"Could you walk me through ~?" / "My strength is ~." / "A challenge I faced was ~."', roleplay: true },
      { id: 's5-10', title: '맞장구와 끼어들기', focus: '"Sorry to interrupt, but ~." / "Exactly!" / "That reminds me, ~."' },
    ],
  },
  {
    n: 6,
    name: '원어민 수준',
    cefr: 'C2',
    goal: '원어민끼리의 대화처럼: 속도, 속어, 유머, 문화 맥락, 미묘한 뉘앙스까지',
    canDo: ['원어민 친구들 대화에 자연스럽게 끼어들 수 있다', '농담·비꼼·돌려 말하기를 알아듣고 쓸 수 있다', '어떤 주제든 정확하고 섬세하게 말할 수 있다'],
    hours: '약 1,000~1,200시간',
    speaker: '원어민과 거의 동등하게 대화해. 속어, 유머, 문화 맥락, 미묘한 뉘앙스까지 다듬는 단계야.',
    sayRule: '원어민 친구처럼 완전히 자연스럽게. 속어, 줄임말, 농담도 섞어.',
    repeatRule: '쓰지 마. 항상 빈칸.',
    hintRule: '항상 빈 배열.',
    tipRule: '원어민이 듣기에 어색한 표현이 있거나, 문화 배경 설명이 필요한 표현을 썼을 때만 한국어 한 문장으로. 나머지는 빈칸.',
    correction: '원어민이 듣기에 어색한 부분은 tip으로 바로 알려 줘.',
    extra: '대화 속도와 화제 전환을 원어민처럼 자유롭게 해.',
    activity: '단원 주제로 깊고 자유롭게 이야기해.',
    defaults: { rate: 1.05, showKo: false, repeatAmount: '적게' },
    routine: [
      '앱 대화 20분',
      '원어민 콘텐츠를 무엇이든 자막 없이',
      '사람과 영어로 대화 주 2회 이상',
      '관심 분야를 영어로 깊이 읽고 쓰기',
    ],
    promote: null,
    units: [
      { id: 's6-1', title: '일상 속어와 줄임말', focus: '"I\'m down." / "I\'m beat." / "It\'s not a big deal." / gonna, wanna' },
      { id: 's6-2', title: '농담과 문화 맥락', focus: '농담·유명한 장면·표현이 왜 웃기거나 통하는지 함께 이야기하기' },
      { id: 's6-3', title: '비꼼과 돌려 말하기', focus: '"Oh, great." (비꼼) / "I\'m not saying ~, but ~." / "Let\'s just say ~."' },
      { id: 's6-4', title: '즉석 1분 스피치', focus: '"Off the top of my head, ~." / "Here\'s the thing: ~." (주제를 받고 바로 1분 말하기)' },
      { id: 's6-5', title: '지역·세대별 말투', focus: '"y\'all" / "mate" / "awesome vs brilliant" 같은 차이' },
      { id: 's6-6', title: '정확하게 설명하기', focus: '"In other words, ~." / "What I mean is ~." / "Strictly speaking, ~."' },
      { id: 's6-7', title: '위로·사과·축하를 섬세하게', focus: '"I\'m so sorry to hear that." / "I owe you an apology." / "You totally deserve it."' },
      { id: 's6-8', title: '긴 이야기 끌고 가기', focus: '"Anyway, where was I?" / "Fast forward to ~." / "And that\'s when ~."' },
      { id: 's6-9', title: '갈등 조정', focus: '"I hear what you\'re saying." / "Let\'s find a middle ground." / "Can we take a step back?"', roleplay: true },
      { id: 's6-10', title: '자유 주제 깊은 대화', focus: '가치관·인생·일에 대해 깊이 이야기하기' },
    ],
  },
]

// 이만큼 주고받아야 단원을 마친 것으로 친다
export const MIN_TURNS_FOR_UNIT = 5
// 승급 기준은 이 단계의 최근 대화 몇 번으로 본다
export const RECENT_SESSIONS = 5
const MAX_SESSIONS = 300

// 날짜별 공부한 분은 이만큼의 날만 남긴다 (대화 기록은 잘려도 연속 일수는 이어지게)
const MAX_DAYS = 800

export const DEFAULT_PROGRESS: Progress = { stage: 1, unit: 's1-1', doneUnits: [], sessions: [], days: {} }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// 대화 기록에서 날짜별 분을 모은다
function sessionDays(sessions: SessionLog[]): Record<string, number> {
  const days: Record<string, number> = {}
  for (const s of sessions) if (DATE_RE.test(s.date)) days[s.date] = (days[s.date] ?? 0) + s.minutes
  return days
}

// 날짜별 분: 따로 쌓은 값과 남아 있는 대화 기록 중 큰 쪽 (옛 버전 데이터에는 days가 없다)
function dayMinutes(progress: Progress): Record<string, number> {
  const out = sessionDays(progress.sessions)
  for (const [d, m] of Object.entries(progress.days ?? {})) out[d] = Math.max(out[d] ?? 0, m)
  return out
}

function pruneDays(days: Record<string, number>): Record<string, number> {
  const keys = Object.keys(days).sort()
  if (keys.length <= MAX_DAYS) return days
  return Object.fromEntries(keys.slice(-MAX_DAYS).map((k) => [k, days[k]]))
}

export function getStage(n: number): Stage {
  return STAGES.find((s) => s.n === n) ?? STAGES[0]
}

export function unitById(id: string): Unit | null {
  for (const s of STAGES) {
    const u = s.units.find((x) => x.id === id)
    if (u) return u
  }
  return null
}

export function getUnit(progress: Progress): Unit {
  const stage = getStage(progress.stage)
  return stage.units.find((u) => u.id === progress.unit) ?? stage.units[0]
}

// 이 단계에서 아직 안 한 첫 단원. 다 했으면 처음부터 다시 돈다
function firstOpenUnit(stage: Stage, doneUnits: string[], after?: string): string {
  const ids = stage.units.map((u) => u.id)
  const start = after ? ids.indexOf(after) + 1 : 0
  const ordered = [...ids.slice(start), ...ids.slice(0, start)]
  return ordered.find((id) => !doneUnits.includes(id)) ?? ordered[0]
}

export function changeStage(progress: Progress, n: number): Progress {
  const stage = getStage(n)
  return { ...progress, stage: stage.n, unit: firstOpenUnit(stage, progress.doneUnits) }
}

export function chooseUnit(progress: Progress, unitId: string): Progress {
  const stage = getStage(progress.stage)
  return stage.units.some((u) => u.id === unitId) ? { ...progress, unit: unitId } : progress
}

// 대화를 끝내면 기록하고, 충분히 주고받았으면 단원을 마친 것으로 하고 다음 단원으로 넘어간다
export function recordSession(progress: Progress, log: SessionLog): { progress: Progress; unitDone: boolean } {
  const sessions = [...progress.sessions, log].slice(-MAX_SESSIONS)
  const base = dayMinutes(progress)
  const days = DATE_RE.test(log.date) ? pruneDays({ ...base, [log.date]: (base[log.date] ?? 0) + log.minutes }) : base
  const unitDone = log.turns >= MIN_TURNS_FOR_UNIT
  if (!unitDone) return { progress: { ...progress, sessions, days }, unitDone }
  const doneUnits = progress.doneUnits.includes(log.unit) ? progress.doneUnits : [...progress.doneUnits, log.unit]
  // 그사이 다른 단원·단계를 골라 두었으면(다른 탭, 남은 대화 저장) 그 선택을 지킨다
  const stillHere = progress.stage === log.stage && progress.unit === log.unit
  const unit = stillHere ? firstOpenUnit(getStage(progress.stage), doneUnits, log.unit) : progress.unit
  return { progress: { ...progress, sessions, days, doneUnits, unit }, unitDone }
}

export interface Criterion {
  label: string
  current: string
  target: string
  ok: boolean
}

export interface Promotion {
  ready: boolean
  criteria: Criterion[]
}

// 다음 단계로 올라갈 준비가 됐는지: 단원을 다 했고, 최근 대화에서 영어로 스스로 대답한 비율과 길이가 기준을 넘었는지
export function promotionStatus(progress: Progress): Promotion | null {
  const stage = getStage(progress.stage)
  if (!stage.promote) return null
  const done = stage.units.filter((u) => progress.doneUnits.includes(u.id)).length
  const recent = progress.sessions.filter((s) => s.stage === stage.n).slice(-RECENT_SESSIONS)
  const own = recent.reduce((a, s) => a + s.enOwnTurns, 0)
  const ko = recent.reduce((a, s) => a + s.koTurns, 0)
  const words = recent.reduce((a, s) => a + s.enOwnWords, 0)
  const ratio = own + ko ? own / (own + ko) : 0
  const avgWords = own ? words / own : 0
  const criteria: Criterion[] = [
    { label: '단원', current: `${done}개`, target: `${stage.units.length}개`, ok: done >= stage.units.length },
    {
      label: '영어로 스스로 대답한 비율 (최근 대화)',
      current: `${Math.round(ratio * 100)}%`,
      target: `${Math.round(stage.promote.ratio * 100)}%`,
      ok: recent.length > 0 && ratio >= stage.promote.ratio,
    },
    {
      label: '영어 대답 평균 길이 (최근 대화)',
      current: `${avgWords.toFixed(1)}단어`,
      target: `${stage.promote.words}단어`,
      ok: avgWords >= stage.promote.words,
    },
  ]
  return { ready: criteria.every((c) => c.ok), criteria }
}

export function totalMinutes(progress: Progress): number {
  return Object.values(dayMinutes(progress)).reduce((a, m) => a + m, 0)
}

// 그날 앱에서 공부한 분
export function minutesOn(progress: Progress, date: string): number {
  return dayMinutes(progress)[date] ?? 0
}

// 오늘(또는 아직 오늘 안 했으면 어제)부터 거꾸로 이어서 공부한 날 수
export function streakDays(progress: Progress, today: string): number {
  const days = new Set(Object.keys(dayMinutes(progress)))
  let day = days.has(today) ? today : addDays(today, -1)
  let count = 0
  while (days.has(day)) {
    count++
    day = addDays(day, -1)
  }
  return count
}

// 오늘 이 단원을 마쳤는지 (시작 화면에서 '오늘 완료'로 보여 준다)
export function doneToday(progress: Progress, today: string): SessionLog | null {
  return [...progress.sessions].reverse().find((s) => s.date === today && s.turns >= MIN_TURNS_FOR_UNIT) ?? null
}

// 두 기기의 진도를 합친다: 더 높은 단계, 마친 단원은 합집합, 대화 기록은 겹치지 않게
export function mergeProgress(local: Progress, incoming: Progress): Progress {
  const doneUnits = [...new Set([...local.doneUnits, ...incoming.doneUnits])]
  const seen = new Set(local.sessions.map((s) => s.id))
  const sessions = [...local.sessions, ...incoming.sessions.filter((s) => !seen.has(s.id))]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(-MAX_SESSIONS)
  const stage = getStage(Math.max(local.stage, incoming.stage))
  const preferred = incoming.stage > local.stage ? incoming.unit : local.unit
  const unit =
    stage.units.some((u) => u.id === preferred) && !doneUnits.includes(preferred) ? preferred : firstOpenUnit(stage, doneUnits)
  // 날짜별 분은 기기마다 따로 쌓였을 수 있다: 각자 값과 합친 대화 기록의 합 중 큰 쪽
  const days = sessionDays(sessions)
  for (const src of [dayMinutes(local), dayMinutes(incoming)])
    for (const [d, m] of Object.entries(src)) days[d] = Math.max(days[d] ?? 0, m)
  return { stage: stage.n, unit, doneUnits, sessions, days: pruneDays(days) }
}

// 저장된 값이 깨졌거나 옛 버전이어도 앱이 돌아가게 다듬는다
export function sanitizeProgress(value: unknown): Progress {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PROGRESS }
  const v = value as Record<string, unknown>
  const stage = getStage(typeof v.stage === 'number' ? v.stage : 1)
  const allIds = new Set(STAGES.flatMap((s) => s.units.map((u) => u.id)))
  const doneUnits = Array.isArray(v.doneUnits) ? v.doneUnits.filter((x): x is string => typeof x === 'string' && allIds.has(x)) : []
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const sessions = Array.isArray(v.sessions)
    ? v.sessions
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof (s as Record<string, unknown>).id === 'string')
        .map((s) => ({
          id: String(s.id),
          date: String(s.date ?? ''),
          stage: num(s.stage) || 1,
          unit: String(s.unit ?? ''),
          minutes: num(s.minutes),
          turns: num(s.turns),
          koTurns: num(s.koTurns),
          enOwnTurns: num(s.enOwnTurns),
          enOwnWords: num(s.enOwnWords),
          repeatTurns: num(s.repeatTurns),
        }))
    : []
  const unit = typeof v.unit === 'string' && stage.units.some((u) => u.id === v.unit) ? v.unit : firstOpenUnit(stage, doneUnits)
  const savedDays: Record<string, number> = {}
  if (v.days && typeof v.days === 'object')
    for (const [d, m] of Object.entries(v.days as Record<string, unknown>)) if (DATE_RE.test(d) && num(m) > 0) savedDays[d] = num(m)
  const days = pruneDays(dayMinutes({ stage: stage.n, unit, doneUnits, sessions, days: savedDays }))
  return { stage: stage.n, unit, doneUnits, sessions, days }
}

// 대화 한 번의 고유 번호. 시간순으로 정렬되게 앞에 시각을 붙인다
export function newSessionId(now = Date.now()): string {
  return `${now.toString(36).padStart(9, '0')}-${Math.random().toString(36).slice(2, 7)}`
}
