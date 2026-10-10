import type { Pair } from './types'

// 내 문장 노트가 비었을 때(첫날) 5분 복습 퀴즈에 쓰는 기본 생존 표현.
// 노트에는 넣지 않는다 (노트에는 내가 저장한 문장만)
export const STARTER: Pair[] = [
  { en: 'Sorry? Can you say that again?', ko: '네? 다시 말해 줄래요?' },
  { en: 'Slowly, please.', ko: '천천히 말해 주세요.' },
  { en: "I don't know.", ko: '모르겠어요.' },
  { en: 'Thank you.', ko: '고마워요.' },
  { en: 'Yes, please.', ko: '네, 주세요.' },
  { en: 'Nice to meet you.', ko: '만나서 반가워요.' },
  { en: "I'm from Korea.", ko: '저는 한국에서 왔어요.' },
  { en: 'I like coffee.', ko: '저는 커피를 좋아해요.' },
  { en: 'How are you?', ko: '잘 지내요?' },
  { en: 'What does it mean?', ko: '그게 무슨 뜻이에요?' },
]

// 퀴즈에 쓸 문장: 노트가 비면 기본 표현, 문장이 생기면 노트 문장만
export const quizPool = <T extends Pair>(learned: T[]): Pair[] => (learned.length > 0 ? learned : STARTER)
