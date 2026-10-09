import type { Pair, Unit } from './types'

// 대화 전 2분 연습에 쓰는 문장 틀.
// frame의 ___ 자리에 fills의 단어를 넣어 바꿔 말한다. fills가 비어 있으면 그대로 외우는 고정 표현이다.
// ko의 ___ 바로 뒤 조사는 받침 없는 꼴(를·는·가·와·로·야)로 쓰면, 넣는 말에 맞게 을·은·이·과·으로·이야로 바꿔 준다.
export interface Fill {
  en: string
  ko: string
}
export interface Pattern {
  frame: string
  ko: string
  fills: Fill[]
}

export const BLANK = '___'

const f = (en: string, ko: string): Fill => ({ en, ko })
const fixed = (frame: string, ko: string): Pattern => ({ frame, ko, fills: [] })

// 1단계·2단계 단원별 문장 틀 (단원 focus의 표현과 맞춘다)
export const PATTERNS: Record<string, Pattern[]> = {
  's1-1': [
    { frame: "Hi, I'm ___.", ko: '안녕, 나는 ___야.', fills: [f('Minsu', '민수'), f('Jiyoung', '지영'), f('Tom', '톰')] },
    fixed('Nice to meet you.', '만나서 반가워.'),
    { frame: "I'm from ___.", ko: '나는 ___에서 왔어.', fills: [f('Korea', '한국'), f('Seoul', '서울'), f('Busan', '부산')] },
  ],
  's1-2': [
    { frame: "I'm ___.", ko: '나는 ___.', fills: [f('tired', '피곤해'), f('happy', '기분 좋아'), f('hungry', '배고파'), f('sleepy', '졸려')] },
    { frame: "I'm so ___.", ko: '나 너무 ___.', fills: [f('tired', '피곤해'), f('happy', '기뻐'), f('busy', '바빠')] },
    fixed("I'm so-so.", '그저 그래.'),
  ],
  's1-3': [
    { frame: 'I like ___.', ko: '나는 ___를 좋아해.', fills: [f('coffee', '커피'), f('pizza', '피자'), f('kimchi', '김치'), f('rice', '밥')] },
    { frame: "I don't like ___.", ko: '나는 ___를 안 좋아해.', fills: [f('milk', '우유'), f('fish', '생선'), f('onions', '양파')] },
    { frame: 'Do you like ___?', ko: '너 ___ 좋아해?', fills: [f('chicken', '치킨'), f('noodles', '국수'), f('cake', '케이크')] },
  ],
  's1-4': [
    { frame: 'I want ___.', ko: '나는 ___를 원해.', fills: [f('water', '물'), f('coffee', '커피'), f('a break', '휴식')] },
    { frame: 'Can I have ___?', ko: '___ 좀 주실래요?', fills: [f('water', '물'), f('a menu', '메뉴판'), f('a coffee', '커피 한 잔')] },
    { frame: '___, please.', ko: '___ 주세요.', fills: [f('Water', '물'), f('Coffee', '커피'), f('Tea', '차')] },
  ],
  's1-5': [
    { frame: 'I get up at ___.', ko: '나는 ___시에 일어나.', fills: [f('7', '7'), f('6', '6'), f('8', '8')] },
    { frame: 'I go to ___.', ko: '나는 ___에 가.', fills: [f('work', '회사'), f('school', '학교'), f('the gym', '헬스장')] },
    { frame: 'I eat lunch at ___.', ko: '나는 ___시에 점심을 먹어.', fills: [f('12', '12'), f('1', '1'), f('2', '2')] },
  ],
  's1-6': [
    { frame: 'I have a ___.', ko: '나는 ___가 있어.', fills: [f('son', '아들'), f('daughter', '딸'), f('dog', '강아지')] },
    { frame: 'This is my ___.', ko: '이 사람은 내 ___야.', fills: [f('wife', '아내'), f('husband', '남편'), f('friend', '친구'), f('mom', '엄마')] },
    { frame: 'She is ___.', ko: '그녀는 ___.', fills: [f('kind', '친절해'), f('funny', '재밌어'), f('tall', '키가 커')] },
  ],
  's1-7': [
    { frame: "It's ___.", ko: '날씨가 ___.', fills: [f('cold', '추워'), f('hot', '더워'), f('sunny', '맑아'), f('rainy', '비가 와')] },
    { frame: 'I like ___.', ko: '나는 ___를 좋아해.', fills: [f('summer', '여름'), f('winter', '겨울'), f('spring', '봄'), f('fall', '가을')] },
  ],
  's1-8': [
    { frame: "It's ___ o'clock.", ko: '___시야.', fills: [f('3', '3'), f('5', '5'), f('10', '10')] },
    fixed('How much is it?', '이거 얼마예요?'),
    { frame: "I'm ___.", ko: '나는 ___살이야.', fills: [f('40', '40'), f('35', '35'), f('52', '52')] },
  ],
  's1-9': [
    { frame: 'I play ___.', ko: '나는 ___를 해.', fills: [f('soccer', '축구'), f('tennis', '테니스'), f('golf', '골프')] },
    { frame: 'I watch ___.', ko: '나는 ___를 봐.', fills: [f('movies', '영화'), f('TV', 'TV'), f('YouTube', '유튜브')] },
    { frame: 'I like ___.', ko: '나는 ___를 좋아해.', fills: [f('cooking', '요리하기'), f('walking', '걷기'), f('reading', '책 읽기'), f('singing', '노래하기')] },
  ],
  's1-10': [
    { frame: 'I live in ___.', ko: '나는 ___에 살아.', fills: [f('Seoul', '서울'), f('Busan', '부산'), f('an apartment', '아파트')] },
    {
      frame: 'There is a ___ near my house.',
      ko: '우리 집 근처에 ___가 있어.',
      fills: [f('park', '공원'), f('cafe', '카페'), f('store', '가게'), f('school', '학교')],
    },
  ],
  's2-1': [
    { frame: 'I went to ___.', ko: '나는 ___에 갔어.', fills: [f('the park', '공원'), f('the store', '가게'), f('work', '회사')] },
    { frame: 'I ate ___.', ko: '나는 ___를 먹었어.', fills: [f('pizza', '피자'), f('rice', '밥'), f('ramen', '라면')] },
    { frame: 'I watched ___.', ko: '나는 ___를 봤어.', fills: [f('a movie', '영화'), f('TV', 'TV'), f('a game', '경기')] },
  ],
  's2-2': [
    { frame: "I'm going to ___.", ko: '나는 ___ 거야.', fills: [f('see a movie', '영화를 볼'), f('go hiking', '등산 갈'), f('meet friends', '친구를 만날')] },
    { frame: 'I will ___.', ko: '나는 ___ 거야.', fills: [f('rest', '쉴'), f('clean my room', '방 청소할'), f('cook', '요리할')] },
    { frame: "Maybe I'll ___.", ko: '아마 ___ 거야.', fills: [f('stay home', '집에 있을'), f('sleep', '잘'), f('go shopping', '쇼핑 갈')] },
  ],
  's2-3': [
    { frame: 'Could I get ___?', ko: '___ 주시겠어요?', fills: [f('a coffee', '커피 한 잔'), f('a latte', '라떼 한 잔'), f('some water', '물 좀')] },
    fixed('For here, please.', '여기서 먹을게요.'),
    fixed('Can I have the check?', '계산서 주시겠어요?'),
  ],
  's2-4': [
    { frame: 'Do you have this in ___?', ko: '이거 ___ 있어요?', fills: [f('black', '검은색으로'), f('blue', '파란색으로'), f('a bigger size', '더 큰 사이즈로')] },
    fixed('How much is this?', '이거 얼마예요?'),
    fixed("I'll take it.", '이걸로 할게요.'),
  ],
  's2-5': [
    { frame: 'Where is ___?', ko: '___가 어디예요?', fills: [f('the bathroom', '화장실'), f('the station', '역'), f('the bank', '은행')] },
    {
      frame: 'Go straight and turn left at the ___.',
      ko: '쭉 가서 ___에서 왼쪽으로 도세요.',
      fills: [f('bank', '은행'), f('corner', '모퉁이'), f('light', '신호등')],
    },
    fixed('Is it far?', '멀어요?'),
  ],
  's2-6': [
    { frame: 'I work at ___.', ko: '나는 ___에서 일해.', fills: [f('a bank', '은행'), f('a hospital', '병원'), f('a school', '학교'), f('home', '집')] },
    { frame: 'My job is ___.', ko: '내 일은 ___.', fills: [f('fun', '재밌어'), f('hard', '힘들어'), f('interesting', '흥미로워')] },
    { frame: 'I usually ___.', ko: '나는 보통 ___.', fills: [f('work late', '늦게까지 일해'), f('take the bus', '버스를 타'), f('eat at home', '집에서 먹어')] },
  ],
  's2-7': [
    { frame: 'Are you free on ___?', ko: '___에 시간 있어?', fills: [f('Friday', '금요일'), f('Saturday', '토요일'), f('Sunday', '일요일')] },
    { frame: 'How about ___?', ko: '___ 어때?', fills: [f('lunch', '점심'), f('coffee', '커피'), f('tomorrow', '내일')] },
    fixed('Sounds good.', '좋아.'),
  ],
  's2-8': [
    { frame: 'I have a ___.', ko: '나 ___.', fills: [f('headache', '머리가 아파'), f('cold', '감기에 걸렸어'), f('fever', '열이 나')] },
    { frame: 'I feel ___.', ko: '나 ___.', fills: [f('sick', '몸이 안 좋아'), f('tired', '피곤해'), f('better', '좀 나아졌어')] },
    { frame: 'You should ___.', ko: '너 ___ 게 좋겠어.', fills: [f('rest', '쉬는'), f('see a doctor', '병원에 가는'), f('go to bed early', '일찍 자는')] },
  ],
  's2-9': [
    { frame: "I've been to ___.", ko: '나는 ___에 가 봤어.', fills: [f('Japan', '일본'), f('Jeju', '제주도'), f('Paris', '파리')] },
    { frame: 'Have you ever ___?', ko: '너 ___ 적 있어?', fills: [f('been to Japan', '일본에 가 본'), f('tried kimchi', '김치 먹어 본'), f('seen snow', '눈 본')] },
    { frame: 'It was ___.', ko: '그건 ___.', fills: [f('fun', '재밌었어'), f('great', '아주 좋았어'), f('beautiful', '아름다웠어')] },
  ],
  's2-10': [
    { frame: '___ is bigger than a cat.', ko: '___는 고양이보다 커.', fills: [f('A dog', '개'), f('A horse', '말'), f('An elephant', '코끼리')] },
    { frame: 'I like ___ more than tea.', ko: '나는 차보다 ___를 더 좋아해.', fills: [f('coffee', '커피'), f('juice', '주스'), f('milk', '우유')] },
    { frame: "It's the best ___.", ko: '이게 최고의 ___야.', fills: [f('movie', '영화'), f('food', '음식'), f('cafe', '카페')] },
  ],
}

// 단원 focus에서 "따옴표" 안의 표현을 뽑는다 (~는 빈칸으로)
export function quotedPhrases(focus: string): string[] {
  const out: string[] = []
  for (const m of focus.matchAll(/"([^"]+)"/g)) {
    const phrase = m[1].replace(/\s*~\s*/g, ` ${BLANK} `).replace(/\s+([.,!?])/g, '$1').replace(/\s+/g, ' ').trim()
    if (phrase && !out.includes(phrase)) out.push(phrase)
  }
  return out
}

// 오늘 단원의 문장 틀 (2~3개). 데이터가 없는 3단계 이상은 focus의 표현을 그대로 고정 표현으로 쓴다
export function patternsFor(unit: Unit, max = 3): Pattern[] {
  const own = PATTERNS[unit.id]
  if (own) return own.slice(0, max)
  return quotedPhrases(unit.focus)
    .slice(0, max)
    .map((frame) => fixed(frame, ''))
}

// 받침이 있는 한글로 끝나는지 (한글이 아니면 받침 없음으로 친다). ㄹ 받침이면 'rieul'
function batchim(word: string): 'none' | 'rieul' | 'other' {
  const code = word.trim().slice(-1).charCodeAt(0) - 0xac00
  if (Number.isNaN(code) || code < 0 || code > 11171) return 'none'
  const jong = code % 28
  return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'other'
}

// 받침 없는 꼴 → 받침 있는 꼴 (긴 것부터 맞춘다)
const JOSA: [string, string][] = [
  ['예요', '이에요'],
  ['를', '을'],
  ['는', '은'],
  ['가', '이'],
  ['와', '과'],
  ['로', '으로'],
  ['야', '이야'],
]

export function fillKo(ko: string, word: string): string {
  const at = ko.indexOf(BLANK)
  if (at < 0) return ko
  const before = ko.slice(0, at)
  let after = ko.slice(at + BLANK.length)
  const b = batchim(word)
  for (const [plain, withB] of JOSA) {
    if (!after.startsWith(plain)) continue
    // '로'는 ㄹ 받침 뒤에서도 '로'
    const use = b === 'none' || (plain === '로' && b === 'rieul') ? plain : withB
    after = use + after.slice(plain.length)
    break
  }
  return before + word + after
}

export const fillEn = (frame: string, word: string): string => frame.replace(BLANK, word)

// 틀에 단어를 넣은 문장 (영어·한국어)
export function sentence(p: Pattern, fill?: Fill): Pair {
  if (!fill) return { en: p.frame, ko: p.ko }
  return { en: fillEn(p.frame, fill.en), ko: fillKo(p.ko, fill.ko) }
}

// 처음 들려줄 예문은 첫 단어로, 바꿔 말하기 칩은 나머지 단어로
export const exampleOf = (p: Pattern): Pair => sentence(p, p.fills[0])
export const swapFills = (p: Pattern): Fill[] => p.fills.slice(1)

// 소리 내어 읽거나 말한 것과 비교할 때는 빈칸을 빼고 쓴다
export const speakable = (text: string): string =>
  text
    .replaceAll(BLANK, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([,])(?=[.!?])/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// 화면에 그릴 때 빈칸 자리를 나눠 준다
export function splitBlank(frame: string): string[] {
  return frame.split(BLANK)
}
