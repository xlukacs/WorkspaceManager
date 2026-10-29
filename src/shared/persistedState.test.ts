import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stateFromDisk, stateToDisk, type PersistedState } from './persistedState'

describe('v11 storage compatibility', () => {
  it('round-trips the previous format byte for byte, including key order and unknown fields', () => {
    const original = readFileSync(new URL('./fixtures/store-v11.json', import.meta.url), 'utf8')
    const disk = JSON.parse(original) as PersistedState
    const state = stateFromDisk(disk)
    expect(state.groups.map((group) => group.id)).toEqual(['active', 'backend'])
    expect(state.workspaces[0]?.groupIds).toEqual(['active', 'backend'])
    expect(state.terminals[0]?.workspaceId).toBe('p1')
    expect(state.terminals[0]?.projectId).toBeNull()
    expect(state.workspaces[0]).not.toHaveProperty('collectionIds')
    expect(`${JSON.stringify(stateToDisk(state), null, 2)}\n`).toBe(original)

    const extended = { ...disk, extension: { keep: true } }
    expect(JSON.stringify(stateToDisk(stateFromDisk(extended)))).toBe(JSON.stringify(extended))
  })
})
