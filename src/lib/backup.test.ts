import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './config'
import { DEFAULT_PROGRESS } from './curriculum'
import {
  backupDueAt,
  backupFileName,
  backupFileText,
  BACKUP_NOTE,
  codeFromBackupText,
  isBackupDue,
  KEY_LAST_BACKUP,
  lastBackup,
  lastBackupText,
  markBackup,
  oldestRecordDate,
  readBackupText,
} from './backup'
import { encodeTransfer, TransferError } from './transfer'
import type { LearnedItem, Progress } from './types'

// 테스트용 브라우저 저장소
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

const TODAY = '2026-10-08'
const learned: LearnedItem[] = [
  { en: 'I like coffee.', ko: '커피 좋아해.', date: '2026-10-04' },
  { en: "I'm tired.", ko: '피곤해.', date: '2026-10-06' },
]
const progress: Progress = { ...DEFAULT_PROGRESS, sessions: [], doneUnits: [] }

describe('backupDueAt', () => {
  it('기록이 없으면 안내하지 않는다', () => {
    expect(backupDueAt(TODAY, false, null, null)).toBe(false)
  })
  it('기록이 생긴 지 3일이 안 됐으면 안내하지 않는다', () => {
    expect(backupDueAt(TODAY, true, null, TODAY)).toBe(false)
    expect(backupDueAt(TODAY, true, null, '2026-10-06')).toBe(false)
    expect(backupDueAt(TODAY, true, null, '2026-10-05')).toBe(true)
  })
  it('한 번도 백업 안 했으면 안내한다 (날짜를 모르면 오래된 것으로 본다)', () => {
    expect(backupDueAt(TODAY, true, null, '2026-10-04')).toBe(true)
    expect(backupDueAt(TODAY, true, null, null)).toBe(true)
  })
  it('마지막 백업이 7일을 넘으면 안내한다', () => {
    expect(backupDueAt(TODAY, true, '2026-10-01', '2026-09-01')).toBe(false)
    expect(backupDueAt(TODAY, true, '2026-09-30', '2026-09-01')).toBe(true)
    expect(backupDueAt(TODAY, true, TODAY, '2026-09-01')).toBe(false)
  })
  it('마지막 백업 날짜가 미래면(시계가 바뀜) 다시 안내한다', () => {
    expect(backupDueAt(TODAY, true, '2026-12-01', '2026-09-01')).toBe(true)
  })
})

describe('oldestRecordDate', () => {
  it('내 문장 노트·대화 기록·공부한 날 가운데 가장 이른 날짜', () => {
    const p: Progress = {
      ...progress,
      sessions: [{ id: 'a', date: '2026-10-03', stage: 1, unit: 's1-1', minutes: 5, turns: 1, koTurns: 0, enOwnTurns: 1, enOwnWords: 2, repeatTurns: 0 }],
      days: { '2026-10-02': 3 },
    }
    expect(oldestRecordDate(learned, p)).toBe('2026-10-02')
    expect(oldestRecordDate(learned, progress)).toBe('2026-10-04')
  })
  it('날짜가 없거나 이상하면 빼고, 하나도 없으면 null', () => {
    expect(oldestRecordDate([{ en: 'Hi.', ko: '', date: '' }], progress)).toBeNull()
    expect(oldestRecordDate([{ en: 'Hi.', ko: '', date: 'oops' }, ...learned], progress)).toBe('2026-10-04')
  })
})

describe('isBackupDue / markBackup (저장소 사용)', () => {
  it('저장된 기록 날짜와 마지막 백업 날짜로 판단한다', () => {
    localStorage.setItem('englishFriend.learned', JSON.stringify(learned))
    expect(isBackupDue(TODAY, true)).toBe(true)
    expect(isBackupDue(TODAY, false)).toBe(false)
    expect(markBackup(TODAY)).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY_LAST_BACKUP) ?? 'null')).toBe(TODAY)
    expect(lastBackup()).toBe(TODAY)
    expect(isBackupDue(TODAY, true)).toBe(false)
    expect(isBackupDue('2026-10-16', true)).toBe(true)
  })
  it('기록 1일차엔 안내하지 않는다', () => {
    localStorage.setItem('englishFriend.learned', JSON.stringify([{ en: 'Hi.', ko: '안녕.', date: TODAY }]))
    expect(isBackupDue(TODAY, true)).toBe(false)
  })
  it('저장소가 막혀도 오류 없이 넘어간다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(markBackup(TODAY)).toBe(false)
    expect(lastBackup()).toBeNull()
    expect(isBackupDue(TODAY, true)).toBe(true)
  })
  it('이상한 값이 저장돼 있으면 백업 안 한 것으로 본다', () => {
    localStorage.setItem(KEY_LAST_BACKUP, JSON.stringify(12345))
    expect(lastBackup()).toBeNull()
  })
})

describe('lastBackupText', () => {
  it('쉬운 말로', () => {
    expect(lastBackupText(TODAY, null)).toBe('아직 한 번도 안 했어요')
    expect(lastBackupText(TODAY, TODAY)).toBe('오늘')
    expect(lastBackupText(TODAY, '2026-10-07')).toBe('어제')
    expect(lastBackupText(TODAY, '2026-10-01')).toBe('7일 전')
  })
})

describe('백업 파일', () => {
  it('파일 이름은 날짜가 들어간 .txt', () => {
    expect(backupFileName(TODAY)).toBe('english-friend-backup-2026-10-08.txt')
  })

  it('첫 줄 안내 + 빈 줄 + 코드, 읽으면 기록이 그대로 돌아온다', async () => {
    const code = await encodeTransfer(learned, { ...DEFAULT_SETTINGS, apiKey: 'SECRET' }, progress)
    const text = backupFileText(code)
    const lines = text.split('\n')
    expect(lines[0]).toBe(BACKUP_NOTE)
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe(code)
    expect(text).not.toContain('SECRET')
    expect(codeFromBackupText(text)).toBe(code)
    const data = await readBackupText(text)
    expect(data.learned).toEqual(learned)
  })

  it('윈도우 줄바꿈·BOM·코드 중간 줄바꿈도 읽는다', async () => {
    const code = await encodeTransfer(learned, DEFAULT_SETTINGS, progress)
    const wrapped = code.slice(0, 20) + '\r\n' + code.slice(20)
    const text = '﻿' + BACKUP_NOTE + '\r\n\r\n' + wrapped + '\r\n'
    expect(codeFromBackupText(text)).toBe(code)
    expect((await readBackupText(text)).learned).toEqual(learned)
  })

  it('압축 없는 코드(EF0.)만 있는 글도 읽는다', async () => {
    const json = JSON.stringify({ v: 1, l: [['Hello.', '안녕.', '2026-10-01']], s: {}, p: null })
    const bin = String.fromCharCode(...new TextEncoder().encode(json))
    const code = 'EF0.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect((await readBackupText(code)).learned).toEqual([{ en: 'Hello.', ko: '안녕.', date: '2026-10-01' }])
  })

  it('코드가 없는 파일은 쉬운 오류', async () => {
    await expect(readBackupText('그냥 메모예요\n장보기: 우유')).rejects.toThrow(TransferError)
    await expect(readBackupText('')).rejects.toThrow('영어 친구 백업 파일이 아니에요')
  })

  it('코드가 망가진 파일은 쉬운 오류', async () => {
    await expect(readBackupText(BACKUP_NOTE + '\n\nEF1.%%%망가짐')).rejects.toThrow('백업 파일이 망가졌거나 잘렸어요')
    await expect(readBackupText('EF1.AAAA')).rejects.toThrow(TransferError)
  })
})
