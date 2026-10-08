import { useState } from 'react'
import { decodeTransfer, encodeTransfer, TransferError, type TransferData } from '../lib/transfer'
import type { LearnedItem, Progress, Settings } from '../lib/types'

interface Props {
  learned: LearnedItem[]
  settings: Settings
  progress: Progress
  onImport: (data: TransferData) => { added: number; total: number }
}

type Result = { good: boolean; text: string } | null

// 폰 ↔ PC: 내보내기로 코드를 복사해 카톡 "나와의 채팅"으로 보내고, 다른 기기에서 가져오기에 붙여 넣는다
export function TransferBox({ learned, settings, progress, onImport }: Props) {
  const [mode, setMode] = useState<'idle' | 'export' | 'import'>('idle')
  const [code, setCode] = useState('')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<Result>(null)
  const [working, setWorking] = useState(false)

  const doExport = async () => {
    setMode('export')
    setResult(null)
    const c = await encodeTransfer(learned, settings, progress)
    setCode(c)
    try {
      await navigator.clipboard.writeText(c)
      setResult({ good: true, text: `복사했어요 (문장 ${learned.length}개). 카톡 "나와의 채팅"에 붙여 넣어 보내세요.` })
    } catch {
      setResult({ good: false, text: '자동 복사가 안 됐어요. 아래 코드를 눌러 전체 선택한 뒤 복사해 주세요.' })
    }
  }

  const doImport = async () => {
    if (!input.trim()) {
      setResult({ good: false, text: '받은 코드를 먼저 붙여 넣어 주세요.' })
      return
    }
    setWorking(true)
    try {
      const r = onImport(await decodeTransfer(input))
      setResult({
        good: true,
        text: r.added
          ? `${r.added}문장을 새로 가져왔어요 (모두 ${r.total}문장). 설정과 진도도 맞췄어요.`
          : `새 문장은 없었어요 (모두 ${r.total}문장). 설정과 진도는 맞췄어요.`,
      })
      setInput('')
    } catch (err) {
      setResult({
        good: false,
        text: err instanceof TransferError ? err.message : '가져오지 못했어요: ' + (err instanceof Error ? err.message : String(err)),
      })
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="transfer" id="transfer">
      <h3>다른 기기로 옮기기</h3>
      <p className="note">문장장·설정·교육과정 진도를 코드 하나로 옮겨요. Gemini 키와 목소리는 기기마다 따로 정해요.</p>
      <div className="tools">
        <button className="secondary" id="btnExport" type="button" onClick={doExport}>
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
          가져오기
        </button>
      </div>
      {mode === 'export' && code && (
        <textarea id="exportCode" readOnly rows={3} value={code} onFocus={(e) => e.currentTarget.select()} />
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
            <button className="primary" id="btnImportRun" type="button" disabled={working} onClick={doImport}>
              가져오기 실행
            </button>
          </div>
        </>
      )}
      {result && (
        <div className={`result${result.good ? ' good' : ''}`} id="transferResult">
          {result.text}
        </div>
      )}
    </div>
  )
}
