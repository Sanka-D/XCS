import { appendFile } from 'node:fs/promises'

import type { OperationJournal, SubmissionJournalEntry } from '@xcs-protocol/sdk'

export class JsonLinesOperationJournal implements OperationJournal {
  readonly #path: string

  public constructor(path: string) {
    this.#path = path
  }

  public async append(entry: SubmissionJournalEntry): Promise<void> {
    await appendFile(this.#path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
}

export class CompositeOperationJournal implements OperationJournal {
  readonly #journals: readonly OperationJournal[]

  public constructor(...journals: readonly OperationJournal[]) {
    this.#journals = journals
  }

  public async append(entry: SubmissionJournalEntry): Promise<void> {
    for (const journal of this.#journals) {
      await journal.append(entry)
    }
  }
}
