// 4) 기록 백업: 파일로 내려받기·파일에서 되살리기, 오래 백업 안 했으면 알려 주기
// (isBackupDue의 모양은 App·시작 화면이 쓰므로 바꾸지 않는다)
import { loadLearned, loadProgress, read, write } from './storage'
import { dayDiff } from './text'
import { decodeTransfer, TransferError, type TransferData } from './transfer'
import type { LearnedItem, Progress } from './types'

export const KEY_LAST_BACKUP = 'englishFriend.lastBackup'

// 마지막 백업에서 이 날 수가 넘으면 알려 준다
export const BACKUP_EVERY_DAYS = 7
// 처음 쓰기 시작한 뒤 이 날 수가 안 됐으면 아직 재촉하지 않는다
export const BACKUP_GRACE_DAYS = 3

const DATE = /^\d{4}-\d{2}-\d{2}$/

// 마지막으로 백업한 날 ('YYYY-MM-DD'). 한 번도 안 했으면 null
export function lastBackup(): string | null {
  const v = read(KEY_LAST_BACKUP)
  return typeof v === 'string' && DATE.test(v) ? v : null
}

// 백업했다고 적어 둔다 (파일 저장, 코드 복사)
export function markBackup(today: string): boolean {
  return write(KEY_LAST_BACKUP, today)
}

// 문장장·대화 기록·공부한 날 가운데 가장 이른 날짜. 날짜가 하나도 없으면 null
export function oldestRecordDate(learned: LearnedItem[], progress: Progress): string | null {
  const dates = [
    ...learned.map((x) => x.date),
    ...progress.sessions.map((s) => s.date),
    ...Object.keys(progress.days ?? {}),
  ].filter((d) => DATE.test(d))
  if (!dates.length) return null
  return dates.reduce((a, b) => (b < a ? b : a))
}

// 저장소를 읽지 않는 계산 (테스트용)
export function backupDueAt(today: string, hasData: boolean, last: string | null, oldest: string | null): boolean {
  if (!hasData) return false
  // 기록이 생긴 지 얼마 안 됐으면 재촉하지 않는다 (날짜를 모르면 오래된 것으로 본다)
  if (oldest && dayDiff(oldest, today) < BACKUP_GRACE_DAYS) return false
  if (!last) return true
  const since = dayDiff(last, today)
  // 날짜가 이상하면(기기 시계가 바뀜 등) 다시 백업하게 한다
  return !Number.isFinite(since) || since < 0 || since > BACKUP_EVERY_DAYS
}

// 시작 화면에 '백업하세요' 안내를 띄울지
export function isBackupDue(today: string, hasData: boolean): boolean {
  if (!hasData) return false
  return backupDueAt(today, hasData, lastBackup(), oldestRecordDate(loadLearned(), loadProgress()))
}

// 마지막 백업을 쉬운 말로 ('오늘', '3일 전', '아직 안 했어요')
export function lastBackupText(today: string, last: string | null): string {
  if (!last) return '아직 한 번도 안 했어요'
  const d = dayDiff(last, today)
  if (!Number.isFinite(d) || d < 0) return last
  if (d === 0) return '오늘'
  if (d === 1) return '어제'
  return `${d}일 전`
}

export const backupFileName = (today: string) => `english-friend-backup-${today}.txt`

// 파일을 열어 본 사람도 알아보게 첫 줄에 안내를 적고, 빈 줄 뒤에 옮기기 코드를 그대로 넣는다
export const BACKUP_NOTE = '영어 친구 기록 백업 파일이에요. 앱의 "폰↔PC 옮기기" → "파일에서 되살리기"로 이 파일을 고르면 기록이 돌아와요.'

export function backupFileText(code: string): string {
  return `${BACKUP_NOTE}\n\n${code}\n`
}

// 파일 글에서 옮기기 코드를 찾는다 (EF0./EF1.로 시작하는 줄부터 끝까지). 없으면 null
export function codeFromBackupText(text: string): string | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const at = lines.findIndex((l) => /^\s*EF[01]\./.test(l))
  if (at < 0) return null
  return lines.slice(at).join('').replace(/\s+/g, '')
}

// 이보다 크면 백업 파일이 아니다 (문장장이 꽉 차도 수백 KB를 넘지 않는다)
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024

// 백업 파일 글을 기록으로 바꾼다. 잘못된 파일이면 쉬운 한국어로 TransferError
export async function readBackupText(text: string): Promise<TransferData> {
  const code = codeFromBackupText(text)
  if (!code) {
    throw new TransferError('영어 친구 백업 파일이 아니에요. "파일로 저장"으로 만든 english-friend-backup-날짜.txt 파일을 골라 주세요.')
  }
  if (code.startsWith('EF1.') && (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function')) {
    throw new TransferError('이 브라우저는 이 파일을 못 읽어요. 크롬이나 엣지 최신 버전에서 열어 주세요.')
  }
  try {
    return await decodeTransfer(code)
  } catch {
    throw new TransferError('백업 파일이 망가졌거나 잘렸어요. 다른 백업 파일을 골라 주세요.')
  }
}
