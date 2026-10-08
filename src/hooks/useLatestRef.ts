import { useLayoutEffect, useRef } from 'react'

// 최신 값을 담아 두는 ref (한 번만 거는 이벤트 처리기나 비동기 작업 뒤에서 읽는다)
export function useLatestRef<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
