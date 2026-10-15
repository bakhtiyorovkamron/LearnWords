import { describe, expect, it } from 'vitest'
import { groupByFolder } from './moveWords'

describe('groupByFolder (undo)', () => {
  it('restores each word to its own previous folder, including "no folder"', () => {
    const groups = groupByFolder([
      { word_id: 'w1', folder_id: 'a' },
      { word_id: 'w2', folder_id: 'b' },
      { word_id: 'w3', folder_id: null },
      { word_id: 'w4', folder_id: 'a' },
    ])
    expect(groups).toEqual([
      { folderId: 'a', ids: ['w1', 'w4'] },
      { folderId: 'b', ids: ['w2'] },
      { folderId: null, ids: ['w3'] },
    ])
  })
})
