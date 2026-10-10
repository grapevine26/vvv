# 왕초보 첫 주 보완 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 영어를 읽을 줄은 알지만 말은 못 하는 왕초보가 키 넣기 전부터 앱을 써 보고, 대화 중 막히면 구조 버튼과 다시 해 보기로 빠져나오게 한다.

**Architecture:** 서버 없는 React 앱이다. 바꾸는 곳은 네 군데다.
- 화면 문구는 컴포넌트 안의 문자열이다.
- 기본 표현은 새 `src/lib/starter.ts`에 둔다.
- AI 규칙은 `src/lib/prompt.ts`에 더한다.
- 대화 흐름은 `App.tsx`의 `sendUser` 옆에 `sendHelp`, `retryMine`를 더한다.

메시지 모양(`Message`의 `me`)에 선택 칸 두 개(`help`, `retry`)를 더한다. 임시 저장도 이 모양을 그대로 쓴다.

**Tech Stack:** React 19, TypeScript, Vite, Vitest(단위), Playwright(화면 흐름, AI·마이크·스피커는 `e2e/helpers.ts`의 가짜)

**Spec:** `docs/superpowers/specs/2026-10-10-beginner-first-week-design.md`

## Global Constraints

- 새 패키지를 더하지 않는다.
- 화면 문구는 쉬운 한국어로 쓴다. 영어 버튼 이름은 영어 원문에 뜻을 붙인다: "Get API key (API 키 받기)".
- 구조 버튼 문장: 다시 `Sorry? Can you say that again?`, 천천히 `Slowly, please.`, 모르겠음 `I don't know.`
- 구조 버튼은 1~3단계에서만 보인다. 4단계부터 숨긴다(`stage >= 4`, 한국어 버튼 축소와 같은 기준).
- 도움 요청과 다시 해 보기는 `turns`, `koTurns`, `enOwnTurns`, `enOwnWords`, `repeatTurns` 어디에도 세지 않는다.
- 다시 해 보기는 AI에 보내지 않고, `history`에도 넣지 않는다.
- 기본 표현은 내 문장 노트(`learned`)에 넣지 않는다.
- 각 작업이 끝나면 `npx tsc -b`, `npm run lint`, `npm test`, `npm run test:e2e`가 모두 통과해야 한다.

## Review Focus

1. 답을 못 받은 내 말(오류 뒤)이 있는데 구조 버튼을 누르는 경우. 같은 차례로 합쳐지고, 셈이 늘지 않아야 한다. → Task 5에서 테스트한다.
2. 듣는 중이거나 친구가 말하는 중에 구조 버튼을 누르는 경우. 마이크가 꺼지고 소리가 멈춘 뒤 보내져야 한다. 생각 중에는 누를 수 없어야 한다. → Task 5.
3. 새 말풍선이 생긴 뒤 예전 말풍선에서 다시 해 보기를 누르는 경우. 그 말풍선만 바뀌고 AI 요청은 없어야 한다. → Task 6.
4. `help`, `retry` 칸이 들어간 임시 저장을 새로고침 뒤 이어서 할 때, 그리고 이 칸이 없는 예전 임시 저장을 열 때. 둘 다 깨지지 않고 그대로 보여야 한다. → Task 5, Task 6.
5. 기본 표현으로 푼 뒤 같은 문장(예: "Thank you.")을 대화에서 저장하는 경우. 복습 일정이 이어지고, 노트에는 사용자가 저장한 것만 있어야 한다. → Task 3.

---

### Task 1: 쉬운 우리말로 바꾸기

**Files:**
- Modify: `src/components/StartScreen.tsx` (히어로 배지, 처음 안내 3줄, 쉐도잉 타일), `src/components/Composer.tsx` (영어 버튼 위 글자, 안내 문구의 "EN"), `src/components/Header.tsx` (끝내기 버튼), `src/App.tsx` (`turnsText`), `src/components/QuizSheet.tsx` (제목)
- Test: `e2e/*.spec.ts`의 문구 단언

**Interfaces:**
- Produces: 문구만 바뀐다. id와 class는 그대로다.

- [ ] **Step 1: 바꿀 문구를 테스트에 먼저 반영한다.** 바꾸는 단언은 아래와 같다.
  - `'#turnCount'`의 `'N/5 턴 완료'` → `'N/5번 주고받음'`
  - 안내 문구 속 `EN을 누르고` → `영어 버튼을 누르고`. 대상은 `chat.spec.ts`의 `toHaveText('EN을 누르고 "…" 말해 보세요')`, `` `이제 내 차례! EN을 누르고 "…" 따라 말해요` ``와, 기본 안내 `'내 차례예요! EN 버튼을 누르고 말씀하세요'`다.
  - `first-run.spec.ts`의 `「세션 종료」` → `「대화 끝내기」`
  - 새 단언 추가: `#btnEnd` 글자 `'대화 끝내기'`, `#courseCard .hero-badge`가 `/^오늘의 단원 \d\d$/`, `#btnListen b`가 `'듣고 따라 하기'`, `#quizSheet-title`이 `'5분 복습 퀴즈'`, `#micEn .mic-top`이 `'🎙️ 영어'`

- [ ] **Step 2: 테스트가 실패하는지 본다.** `npm run build; npx playwright test e2e/chat.spec.ts e2e/first-run.spec.ts` → 위 단언들에서 FAIL.

- [ ] **Step 3: 문구를 바꾼다.** 설계 4부의 표를 그대로 따른다.
  - Composer 안내: `EN을 누르고` → `영어 버튼을 누르고`, `EN 버튼` → `영어 버튼`
  - 처음 안내 2번째 줄: `「EN」` → `「영어」 버튼`

- [ ] **Step 4: 전체 확인.** `npx tsc -b; npm run lint; npm test; npm run test:e2e` → 모두 PASS.

- [ ] **Step 5: 커밋.** `git commit -am "화면 용어를 쉬운 우리말로"`

### Task 2: 키 없이 입 풀기 + 키 받기 안내

**Files:**
- Modify: `src/components/StartScreen.tsx:267` (`{hasKey && …}` 조건 제거), `src/components/SettingsSheet.tsx:45,116,129,179-195`
- Test: `e2e/warmup.spec.ts`, `e2e/first-run.spec.ts`

**Interfaces:**
- Produces: `#keyGuide` 안에 `#keyNoKeyNote`(키 없이 해 볼 수 있다는 줄)가 생긴다. 키 형식 판단은 `SettingsSheet` 안의 `keyLooksOdd`가 그대로 맡는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `warmup.spec.ts`: `test('키가 없어도 홈에 입 풀기가 보이고, 끝까지 하면 키 넣기 화면이 열린다 (대화 요청 없음)')`
    - 키 없이 연다.
    - `#btnWarmup`이 보인다.
    - 입 풀기를 끝까지 하고 `#btnWarmupDone`을 누른다.
    - `#settingsSheet-title`이 `'Gemini 키 넣기'`다.
    - `requests` 길이가 0이다.
  - `first-run.spec.ts`:
    - 기존 `'AIza로 시작하지 않는 글자를…'` 테스트를 고친다. `'AQ.Ab8TESTKEY'`를 넣으면 `#keyField .warn-text`가 0개이고, `'hello world'`를 넣으면 경고 글자가 `'키가 맞는지 확인해 주세요. 복사한 글자 그대로 붙여 넣었는지 봐 주세요.'`다.
    - `#keyGuide`에 `'Get API key (API 키 받기)'`, `'Create API key (키 만들기)'`, `'Copy (복사)'`, `'구글 계정이 없으면'`이 있고, `'AIza'`는 없다.
    - `#keyNoKeyNote`가 `'키 없이도 입 풀기와 5분 복습 퀴즈는 해 볼 수 있어요. 키는 대화할 때 필요해요.'`다.

- [ ] **Step 2: 실패를 확인한다.** `npm run build; npx playwright test e2e/warmup.spec.ts e2e/first-run.spec.ts` → 새 단언에서 FAIL.

- [ ] **Step 3: 고친다.**
  - `StartScreen`: 입 풀기 버튼을 `hasKey`와 상관없이 그린다.
  - `SettingsSheet` firstRun 안내: 설계 1부의 4단계 문구로 바꾼다.
  - `keyLooksOdd`: 공백과 따옴표를 뗀 뒤 `/^(AIza|AQ\.)/`이 아니면 true다.
  - 입력칸 placeholder: `'복사한 긴 글자를 붙여 넣어요'`

- [ ] **Step 4: 전체 확인.** `npx tsc -b; npm run lint; npm test; npm run test:e2e` → PASS.

- [ ] **Step 5: 커밋.** `git commit -am "키 없이도 입 풀기, 키 받기 안내를 왕초보용으로"`

### Task 3: 첫날 퀴즈는 기본 표현으로

**Files:**
- Create: `src/lib/starter.ts`, `src/lib/starter.test.ts`
- Modify: `src/components/QuizSheet.tsx` (`picked` 고르기, `Intro`의 빈 노트 분기, `pickAhead`, `nextDue`, `countDueBy` 호출에 쓰는 목록)
- Test: `e2e/quiz.spec.ts`

**Interfaces:**
- Produces: `export const STARTER: Pair[]`(10개, 설계 1부 순서 그대로, 한국어 뜻 포함), `export function quizPool<T extends Pair>(learned: T[]): Pair[]`(learned가 비면 `STARTER`, 아니면 `learned`)

- [ ] **Step 1: 단위 테스트를 쓴다** (`starter.test.ts`).
  - `STARTER` 길이가 10이고, 모든 `en`과 `ko`가 비어 있지 않고, `en`이 서로 겹치지 않는다.
  - `quizPool([])`는 `STARTER`다.
  - `quizPool([{en:'Hi.',ko:'안녕',date:'2026-10-10'}])`의 길이는 1이다.
  - `buildQuestions(STARTER.slice(0,3), STARTER)`의 각 문제 `item`은 `STARTER`에 있다.

- [ ] **Step 2: 실패를 확인한다.** `npx vitest run src/lib/starter.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: `starter.ts`를 만든다.** 아래 10개를 이 순서 그대로 쓴다. 설계 목록에서 "A / B" 꼴인 항목은 문제 하나에 한 문장만 들어가도록 앞 문장만 쓴다.

  | en | ko |
  |---|---|
  | Sorry? Can you say that again? | 네? 다시 말해 줄래요? |
  | Slowly, please. | 천천히 말해 주세요. |
  | I don't know. | 모르겠어요. |
  | Thank you. | 고마워요. |
  | Yes, please. | 네, 주세요. |
  | Nice to meet you. | 만나서 반가워요. |
  | I'm from Korea. | 저는 한국에서 왔어요. |
  | I like coffee. | 저는 커피를 좋아해요. |
  | How are you? | 잘 지내요? |
  | What does it mean? | 그게 무슨 뜻이에요? |

- [ ] **Step 4: 단위 테스트 통과를 확인한다.** `npx vitest run src/lib/starter.test.ts` → PASS.

- [ ] **Step 5: 화면 흐름 테스트를 쓴다** (`quiz.spec.ts`). 기존 `#qzEmpty` 테스트를 바꾼다: `test('노트가 비면 기본 표현으로 퀴즈를 풀고, 결과는 복습 일정에만 저장되고 노트는 비어 있다')`
  - `#qzStarterNote`가 `'아직 내 문장 노트가 비어 있어요. 먼저 기본 표현으로 풀어 봐요.'`다.
  - `#qzStart`로 시작하면 `#qzProgress`가 보인다.
  - 한 문제를 풀면 `englishFriend.quiz`에 그 영어 문장 열쇠가 생긴다.
  - `englishFriend.learned`는 `[]`이거나 `null`이다.
  - Review Focus 5: 그 뒤 `learned`에 `{en:'Thank you.'}`를 넣고 다시 열면, 문제는 노트 문장으로만 나오고 `quiz['Thank you.']`의 `box`는 유지된다.

- [ ] **Step 6: `QuizSheet`를 고친다.**
  - `picked`, `pickAhead`, `nextDue`, `buildQuestions`의 두 번째 인자, `countDueBy`에 `quizPool(learned)`를 쓴다.
  - `Intro`에서 `learned.length === 0`이면 `#qzStarterNote` 문구와 함께, 노트가 있을 때와 같은 시작 안내와 `#qzStart`를 보인다.
  - 예전 `#qzEmpty` 분기는 지운다.

- [ ] **Step 7: 전체 확인.** `npx tsc -b; npm run lint; npm test; npm run test:e2e` → PASS. 예전 `#qzEmpty`를 단언하던 테스트는 Step 5에서 바꾼 것으로 대신한다.

- [ ] **Step 8: 커밋.** `git commit -am "노트가 비면 기본 표현으로 퀴즈"`

### Task 4: 도움 요청 꼬리표와 AI 규칙

**Files:**
- Modify: `src/lib/prompt.ts` (`userTag` 옆에 함수 하나, 대화 규칙 14번, `[내 말 앞에 붙는 표시]`), `src/lib/types.ts`
- Test: `src/lib/prompt.test.ts`

**Interfaces:**
- Produces:
  - `export type HelpKind = 'again' | 'slow' | 'dunno'` (`types.ts`)
  - `export const HELP_PHRASE: Record<HelpKind, string>`: `again` `Sorry? Can you say that again?`, `slow` `Slowly, please.`, `dunno` `I don't know.` (`prompt.ts`)
  - `export function helpTag(kind: HelpKind): string` → `'[도움 요청: 다시]' | '[도움 요청: 천천히]' | '[도움 요청: 모르겠음]'`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `helpTag('again')`는 `'[도움 요청: 다시]'`, `'slow'`는 `'[도움 요청: 천천히]'`, `'dunno'`는 `'[도움 요청: 모르겠음]'`이다.
  - 1·4단계 `buildSystemPrompt` 결과에 `"14. [도움 요청]이 오면:"`과 `"- [도움 요청: …]: 내가 못 알아들었거나 막혀서 누른 도움 버튼."`이 있다.

- [ ] **Step 2: 실패를 확인한다.** `npx vitest run src/lib/prompt.test.ts` → FAIL.

- [ ] **Step 3: 구현한다.**
  - 14번 문구는 설계 2부의 인용 그대로 쓴다.
  - 표시 설명 줄은 Step 1의 문구 그대로 쓴다.

- [ ] **Step 4: 통과를 확인하고 커밋한다.** `npm test` → PASS. `git commit -am "도움 요청 꼬리표와 AI 규칙"`

### Task 5: 대화 중 구조 버튼

**Files:**
- Modify: `src/lib/types.ts` (`me` 메시지에 `help?: HelpKind`), `src/components/Composer.tsx` (칩 줄), `src/components/Messages.tsx` (`UserBubble` 꼬리표), `src/App.tsx` (`sendHelp`, 느린 다음 답), `src/index.css` (칩 모양)
- Test: `e2e/chat.spec.ts`

**Interfaces:**
- Consumes: `HelpKind`, `HELP_PHRASE`, `helpTag` (Task 4)
- Produces:
  - `Composer` prop `onHelp: (kind: HelpKind) => void`. 칩 id는 `#helpAgain`, `#helpSlow`, `#helpDunno`이고, 줄 컨테이너 id는 `#helpRow`다.
  - `UserBubble` prop `help?: HelpKind`. 꼬리표 `.tag` 글자는 `'도움 요청'`이다.

- [ ] **Step 1: 실패하는 화면 흐름 테스트를 쓴다** (`chat.spec.ts`, 새 `describe('구조 버튼')`).
  - `test('세 버튼 모두: 영어 문장을 읽어 주고 [도움 요청] 꼬리표로 보내며, 대화 셈은 늘지 않는다')`
    - 각 kind마다 `clearSpoken` 후 클릭한다.
    - `spoken`의 첫 항목 `text`가 `HELP_PHRASE[kind]`다.
    - 마지막 요청의 `lastUserText`가 `` `${helpTag(kind)} ${HELP_PHRASE[kind]}` ``다.
    - 마지막 내 말풍선 `.tag`가 `'도움 요청'`이다.
    - `#turnCount`는 누르기 전 값 그대로다.
    - `draftStats`의 `turns`, `koTurns`, `enOwnTurns`, `enOwnWords`, `repeatTurns`도 그대로다.
  - `test('천천히 뒤의 AI 답은 느린 속도로 읽는다')`: 다음 AI 답의 `say` 발화 `rate`가 보통 답의 `rate`보다 작다.
  - `test('생각 중에는 누를 수 없고, 듣는 중에 누르면 마이크를 끄고 보낸다')`
    - 느린 응답(`slow(reply, 1500)`) 동안 `#helpAgain`은 `disabled`다.
    - `#micEn`으로 듣기 시작한 뒤 `#helpDunno`를 누르면 `lastRec(page).stopped`가 true다.
    - 요청은 1개 늘고, 그 끝은 `'[도움 요청: 모르겠음] I don\'t know.'`다.
  - Review Focus 1: `test('오류로 답을 못 받은 말 뒤에 누르면 같은 차례로 합쳐지고 셈이 늘지 않는다')`
    - 오류 답 뒤 `#helpAgain`을 누른다.
    - 마지막 요청의 마지막 user 내용에 앞서 한 말과 `[도움 요청: 다시]`가 줄바꿈으로 함께 있다.
    - `turns`는 1이다.
  - `test('4단계에서는 구조 버튼이 없다')`: progress를 `stage: 4`로 연다. `#helpRow`가 0개다.
  - Review Focus 4: `test('구조 버튼 말풍선은 새로고침 뒤 이어서 해도 꼬리표가 남는다')`. 이어서 하기 후 `.tag`가 `'도움 요청'`이다.

- [ ] **Step 2: 실패를 확인한다.** `npm run build; npx playwright test e2e/chat.spec.ts -g "구조 버튼"` → FAIL.

- [ ] **Step 3: 구현한다.**
  - `App.sendHelp(kind: HelpKind): void`
    - 대화 중이 아니거나 생각 중이면 아무것도 하지 않는다.
    - `stopListening()` 후 `await play([{ text: HELP_PHRASE[kind], lang: 'en' }])`로 읽는다.
    - 말풍선 `{kind:'me', text: HELP_PHRASE[kind], lang:'en', isRepeat:false, help: kind}`를 더한다.
    - `pushHistory(…, 'user', `${helpTag(kind)} ${HELP_PHRASE[kind]}`)` 후 `aiTurn()`을 부른다.
    - `statsRef`와 `setTurns`는 건드리지 않는다.
    - `kind === 'slow'`면 `slowNextRef.current = true`로 둔다. `aiTurn`은 `play(turnSegments(turn), slowNextRef.current)`로 읽은 뒤 이 값을 false로 되돌린다.
  - `Composer`: `stage < 4`일 때만 `#helpRow`를 안내 줄과 마이크 사이에 그린다. 칩 3개, 생각 중이면 `disabled`.

- [ ] **Step 4: 전체 확인.** `npx tsc -b; npm run lint; npm test; npm run test:e2e` → PASS.

- [ ] **Step 5: 커밋.** `git commit -am "대화 중 구조 버튼: 다시 말해 줘·천천히·모르겠어요"`

### Task 6: 덜 들린 단어 듣기 + 다시 해 보기

**Files:**
- Modify: `src/components/common.tsx` (`WordMarks`), `src/lib/types.ts` (`me`에 `retry?: { said: string; heardWell: boolean }`), `src/components/Messages.tsx` (`UserBubble`), `src/components/QuizSheet.tsx` (`Feedback`의 `WordMarks`에 `onPlayWord`), `src/App.tsx` (`retryMine`)
- Test: `e2e/fixes.spec.ts` (발음 피드백 테스트 옆)

**Interfaces:**
- Produces:
  - `WordMarks({ goal, said, onPlayWord }: { goal: string; said: string; onPlayWord?: (word: string) => void })`. `onPlayWord`가 있으면 빠진 단어를 `<button className="wm miss">`로 그리고, `aria-label`은 `` `${word} 천천히 듣기` ``다.
  - `UserBubble` props `retry?`, `onPlayWord?`, `onRetry?: () => void`. 버튼 `.btn-retry-say`의 글자는 `'🔁 다시 해 보기'`다. 결과 줄 `.heard`의 글자는 `'이번엔 잘 들렸어요'`다.
  - `App.retryMine(id: number): void`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `test('덜 들린 단어를 누르면 그 단어만 천천히 읽는다')`: `.wm.miss` 첫 버튼을 누르면 `spoken` 마지막 `text`가 그 단어다(구두점 제외). `rate`는 보통보다 작다.
  - `test('다시 해 보기: 목표 문장을 천천히 들려주고, 잘 말하면 그 말풍선만 "이번엔 잘 들렸어요"로 바뀌고 AI 요청은 없다')`
    - 누르기 전 `requests` 길이를 기억한다.
    - `.btn-retry-say`를 누르면 `spoken`에 목표 문장(느린 속도)이 있다.
    - 목표와 같게 `say`한다.
    - 그 말풍선 `.heard`가 `'이번엔 잘 들렸어요'`이고, `.btn-retry-say`는 0개다.
    - `requests` 길이와 `draftStats`는 그대로다.
  - `test('다시 해 보기를 또 틀리면 덜 들린 단어 표시가 새 말로 바뀐다')`: 다르게 말하면 `.wm.miss` 목록이 새 말 기준으로 바뀐다.
  - Review Focus 3: `test('새 말풍선이 생긴 뒤 예전 말풍선에서 다시 해 보기를 해도 그 말풍선만 바뀐다')`
  - Review Focus 4: `test('다시 해 보기 결과는 새로고침 뒤 이어서 해도 남고, retry가 없는 예전 임시 저장도 그대로 열린다')`

- [ ] **Step 2: 실패를 확인한다.** `npm run build; npx playwright test e2e/fixes.spec.ts -g "다시 해 보기|덜 들린 단어"` → FAIL.

- [ ] **Step 3: 구현한다.**
  - `retryMine(id)`
    - 그 메시지의 `goal`을 `play(splitByScript(goal), true)`로 읽는다.
    - 끝나면 `startMic('en', (said) => …)`로 듣는다.
    - 들은 말로 `setMessages`에서 그 id 메시지의 `retry`만 `{ said, heardWell: overlap(goal, said) >= 0.7 }`로 바꾼다.
    - `history`, `statsRef`, `sendUser`는 쓰지 않는다.
  - `UserBubble`
    - 버튼은 `goal`이 있고 `heardWell`도 `retry?.heardWell`도 아닐 때만 보인다.
    - `WordMarks`의 `said`는 `retry?.said ?? text`다.
  - `onPlayWord`는 `play([{ text: word, lang: 'en' }], true)`다.

- [ ] **Step 4: 전체 확인.** `npx tsc -b; npm run lint; npm test; npm run test:e2e` → PASS.

- [ ] **Step 5: 커밋.** `git commit -am "덜 들린 단어 듣기와 다시 해 보기"`

### Task 7: 실제 Gemini로 구조 버튼 확인

**Files:**
- 프로젝트 밖 임시 스크립트만 쓴다(세션 scratchpad의 `livechat.mjs`). 키는 환경 변수로만 넘기고, 파일에 저장하지 않는다.

- [ ] **Step 1: 스크립트에 도움 요청 차례를 더한다.** 1~3단계에서 3번째 차례에 `again`, 5번째에 `slow`, 7번째에 `dunno`를 `` `${helpTag(k)} ${HELP_PHRASE[k]}` ``로 보낸다.

- [ ] **Step 2: 단계마다 2번씩 돌려 다음을 확인한다.**
  - `again` 뒤 `say`가 직전 `say`보다 단어 수가 같거나 적다.
  - `slow` 뒤 `say`의 문장이 짧다(문장당 6단어 이하).
  - `dunno` 뒤 `hints`가 2개 이상이거나 `repeat`가 있다.
  - 세 경우 모두 `say`에 `?`가 있거나 `repeat`가 있다.
  - 작별 말이 없다.

- [ ] **Step 3: 어긋나면 14번 규칙 문구만 고치고 Step 2를 다시 한다.** 고친 뒤 `npm test`와 `npm run test:e2e`를 통과시키고 커밋한다.
