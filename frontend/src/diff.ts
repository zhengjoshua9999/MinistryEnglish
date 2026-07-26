function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '')
}

/** Word-level LCS between the original sentence's words and what the user typed.
 * Returns the set of indices into `originalWords` that are part of the longest
 * common subsequence — i.e. words the user heard correctly, in the right order. */
export function matchedWordIndices(originalWords: string[], typedWords: string[]): Set<number> {
  const a = originalWords.map(normalizeWord)
  const b = typedWords.map(normalizeWord)
  const n = a.length
  const m = b.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] !== '' && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const matched = new Set<number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] !== '' && a[i] === b[j]) {
      matched.add(i)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return matched
}
