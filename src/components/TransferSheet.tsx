import { Download, FileDown, FileUp, Share2, ShieldCheck, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import {
  backupFileName,
  backupFileText,
  lastBackup,
  lastBackupText,
  markBackup,
  MAX_BACKUP_BYTES,
  readBackupText,
} from '../lib/backup'
import { localDate } from '../lib/text'
import { decodeTransfer, encodeTransfer, TransferError, type TransferData } from '../lib/transfer'
import type { LearnedItem, Progress, Settings } from '../lib/types'
import { Sheet } from './common'
import './backup.css'

interface Props {
  learned: LearnedItem[]
  settings: Settings
  progress: Progress
  onImport: (data: TransferData) => { added: number; total: number }
  onNeedKey: () => void
  onClose: () => void
}

type Result = { good: boolean; text: string } | null
// 결과 글이 어느 칸 아래에 뜰지 (누른 버튼 가까이에 보이게)
type Where = 'file' | 'code'

const importedText = (r: { added: number; total: number }) =>
  r.added
    ? `${r.added}문장을 새로 가져왔어요 (모두 ${r.total}문장). 설정과 진도도 맞췄어요.`
    : `새 문장은 없었어요 (모두 ${r.total}문장). 설정과 진도는 맞췄어요.`

const errorText = (err: unknown, prefix: string) =>
  err instanceof TransferError ? err.message : prefix + (err instanceof Error ? err.message : String(err))

// 휴대폰 공유하기(카톡 등)로 파일을 보낼 수 있는지 (안드로이드 크롬 등)
function canShareFile(): boolean {
  try {
    const probe = new File(['x'], 'x.txt', { type: 'text/plain' })
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

// 폰 ↔ PC: 내보내기로 코드를 복사해 카톡 "나와의 채팅"으로 보내고, 다른 기기에서 가져오기에 붙여 넣는다
// 기록 백업: 같은 코드를 .txt 파일로 저장해 두었다가, 크롬 기록을 지웠거나 폰을 바꾸면 그 파일로 되살린다
export function TransferSheet({ learned, settings, progress, onImport, onNeedKey, onClose }: Props) {
  const [mode, setMode] = useState<'idle' | 'export' | 'import'>('idle')
  const [code, setCode] = useState('')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Result>(null)
  const [where, setWhere] = useState<Where>('code')
  const [working, setWorking] = useState(false)
  const [needKey, setNeedKey] = useState(false)
  const [last, setLast] = useState(lastBackup)
  const [shareOk] = useState(canShareFile)
  const fileRef = useRef<HTMLInputElement>(null)
  const linkHost = useRef<HTMLDivElement>(null)
  const today = localDate()

  const show = (w: Where, r: Result) => {
    setWhere(w)
    setResult(r)
  }

  const noteBackup = () => {
    const d = localDate()
    markBackup(d)
    setLast(d)
  }

  const doExport = async () => {
    setMode('export')
    setResult(null)
    const c = await encodeTransfer(learned, settings, progress)
    setCode(c)
    try {
      await navigator.clipboard.writeText(c)
      noteBackup()
      show('code', { good: true, text: `복사했어요 (문장 ${learned.length}개). 카톡 "나와의 채팅"에 붙여 넣어 보내세요.` })
    } catch {
      show('code', { good: false, text: '자동 복사가 안 됐어요. 아래 코드를 눌러 전체 선택한 뒤 복사해 주세요.' })
    }
  }

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setInput(t)
    } catch {
      show('code', { good: false, text: '자동 붙여넣기가 안 돼요. 칸을 길게 눌러 붙여 넣어 주세요.' })
    }
  }

  const doImport = async () => {
    if (!input.trim()) {
      show('code', { good: false, text: '받은 코드를 먼저 붙여 넣어 주세요.' })
      return
    }
    setWorking(true)
    try {
      const r = onImport(await decodeTransfer(input))
      show('code', { good: true, text: importedText(r) })
      setInput('')
      setNeedKey(!settings.apiKey)
    } catch (err) {
      show('code', { good: false, text: errorText(err, '가져오지 못했어요: ') })
    } finally {
      setWorking(false)
    }
  }

  const makeFile = async () => {
    const d = localDate()
    const c = await encodeTransfer(learned, settings, progress)
    return new File([backupFileText(c)], backupFileName(d), { type: 'text/plain' })
  }

  // 파일로 내려받기: Blob 주소를 a[download]로 누른다
  const saveFile = async () => {
    setWorking(true)
    try {
      const file = await makeFile()
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.hidden = true
      ;(linkHost.current ?? document.body).appendChild(a)
      a.click()
      a.remove()
      // 내려받기가 시작될 시간을 준 뒤 주소를 치운다
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      noteBackup()
      show('file', {
        good: true,
        text: `"${file.name}" 파일로 저장했어요. 폰에서는 "다운로드" 폴더(내 파일)에 있어요. 이 파일을 카톡 "나와의 채팅"이나 메일로 보내 두면 폰을 바꿔도 안전해요.`,
      })
    } catch {
      show('file', {
        good: false,
        text: '이 브라우저에서는 파일 저장이 안 돼요. 아래 "내보내기"로 코드를 복사해 카톡 "나와의 채팅"에 보내 두세요. 그것도 백업이 돼요.',
      })
    } finally {
      setWorking(false)
    }
  }

  // 휴대폰 공유하기로 파일을 바로 카톡·메일에 보낸다
  const shareFile = async () => {
    setWorking(true)
    try {
      const file = await makeFile()
      await navigator.share({ files: [file], title: '영어 친구 기록 백업' })
      noteBackup()
      show('file', { good: true, text: '백업 파일을 보냈어요. 받은 곳(카톡·메일)에서 파일을 지우지 말고 두세요.' })
    } catch (err) {
      // 공유 창을 그냥 닫은 경우는 알리지 않는다
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        show('file', { good: false, text: '보내기가 안 됐어요. "파일로 저장"을 눌러 주세요.' })
      }
    } finally {
      setWorking(false)
    }
  }

  const pickFile = () => {
    setResult(null)
    fileRef.current?.click()
  }

  const restoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setWorking(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        throw new TransferError('파일이 너무 커요. "파일로 저장"으로 만든 english-friend-backup-날짜.txt 파일을 골라 주세요.')
      }
      const r = onImport(await readBackupText(await file.text()))
      show('file', { good: true, text: '기록을 되살렸어요. ' + importedText(r) })
      setNeedKey(!settings.apiKey)
    } catch (err) {
      show('file', { good: false, text: errorText(err, '파일을 읽지 못했어요: ') })
    } finally {
      // 다 읽은 뒤에 비운다 (같은 파일을 다시 골라도 또 읽게)
      input.value = ''
      setWorking(false)
    }
  }

  const resultBox = (w: Where) =>
    result &&
    where === w && (
      <>
        <div className={`result${result.good ? ' good' : ' bad'}`} id="transferResult" role="status">
          {result.text}
        </div>
        {needKey && (
          <div className="unit-status warn" id="transferNeedKey">
            이 기기엔 아직 Gemini 키가 없어요. 키를 넣으면 이어서 대화할 수 있어요.{' '}
            <button className="primary" id="btnTransferKey" type="button" onClick={onNeedKey}>
              키 넣기
            </button>
          </div>
        )}
      </>
    )

  return (
    <Sheet
      id="transferSheet"
      title="폰↔PC 옮기기"
      onClose={onClose}
      footer={
        <button className="primary" id="btnTransferClose" type="button" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="transfer" id="transfer" ref={linkHost}>
        <section className="bk-card" id="backupBox" aria-labelledby="backupTitle">
          <h3 className="bk-title" id="backupTitle">
            <ShieldCheck className="ico" aria-hidden="true" />
            기록 백업
          </h3>
          <p className="bk-why">
            기록은 이 브라우저에만 있어요. 크롬 기록을 지우거나 폰을 바꾸면 사라질 수 있으니, 일주일에 한 번 파일로 저장해 두세요.
          </p>
          <p className={`bk-last${last ? '' : ' never'}`} id="backupLast">
            마지막 백업: <b>{lastBackupText(today, last)}</b>
          </p>
          <div className="bk-actions">
            <button className="primary" id="btnBackupSave" type="button" disabled={working} onClick={saveFile}>
              <FileDown className="ico" aria-hidden="true" />
              파일로 저장
            </button>
            {shareOk && (
              <button className="secondary" id="btnBackupShare" type="button" disabled={working} onClick={shareFile}>
                <Share2 className="ico" aria-hidden="true" />
                카톡·메일로 보내기
              </button>
            )}
            <button className="secondary" id="btnBackupRestore" type="button" disabled={working} onClick={pickFile}>
              <FileUp className="ico" aria-hidden="true" />
              파일에서 되살리기
            </button>
          </div>
          <input
            ref={fileRef}
            id="backupFile"
            type="file"
            accept=".txt,text/plain"
            hidden
            aria-label="백업 파일 고르기"
            onChange={restoreFile}
          />
          <p className="bk-hint">
            되살리기는 지금 기록에 <b>합쳐요</b> (지우지 않아요). 파일 저장이 안 되면(카톡 안에서 연 화면 등) 크롬으로 열거나, 아래
            "내보내기" 코드를 카톡에 보내 두어도 돼요.
          </p>
          {resultBox('file')}
        </section>

        <h3 className="bk-sub">다른 기기로 옮기기</h3>
        <ol className="list steps">
          <li>
            보내는 기기에서 <b>내보내기</b> → 코드가 복사돼요
          </li>
          <li>카톡 "나와의 채팅"에 붙여 넣어 보내기</li>
          <li>
            받는 기기에서 그 코드를 길게 눌러 복사 → <b>가져오기</b>
          </li>
        </ol>
        <p className="note">문장장·설정·교육과정 진도가 합쳐져요. Gemini 키와 목소리는 기기마다 따로 정해요.</p>
        <div className="tools two">
          <button className="secondary" id="btnExport" type="button" onClick={doExport}>
            <Upload className="ico" aria-hidden="true" />
            내보내기
          </button>
          <button
            className="secondary"
            id="btnImportOpen"
            type="button"
            onClick={() => {
              setMode('import')
              setResult(null)
            }}
          >
            <Download className="ico" aria-hidden="true" />
            가져오기
          </button>
        </div>
        {mode === 'export' && code && (
          <textarea
            id="exportCode"
            readOnly
            rows={3}
            value={code}
            onFocus={(e) => e.currentTarget.select()}
            // 자동 복사가 안 돼서 손으로 복사해도 백업한 것으로 친다
            onCopy={noteBackup}
          />
        )}
        {mode === 'import' && (
          <>
            <textarea
              id="importCode"
              rows={3}
              placeholder="받은 코드를 여기에 붙여 넣으세요"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="tools">
              <button className="secondary" type="button" onClick={pasteFromClipboard}>
                붙여넣기
              </button>
              <button className="primary" id="btnImportRun" type="button" disabled={working} onClick={doImport}>
                가져오기 실행
              </button>
            </div>
          </>
        )}
        {resultBox('code')}
      </div>
    </Sheet>
  )
}
