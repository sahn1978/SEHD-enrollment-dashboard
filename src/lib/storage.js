// Storage adapter backed by browser localStorage.
// All snapshot data is namespaced under PREFIX so the dashboard can coexist
// with anything else on the same origin without collisions.

const PREFIX = 'edash:'

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

export const storage = {
  async get(key) {
    return safe(() => {
      const v = localStorage.getItem(PREFIX + key)
      return v == null ? null : { key, value: v, shared: false }
    })
  },

  async set(key, value) {
    return safe(() => {
      localStorage.setItem(PREFIX + key, value)
      return { key, value, shared: false }
    })
  },

  async delete(key) {
    return safe(() => {
      localStorage.removeItem(PREFIX + key)
      return { key, deleted: true, shared: false }
    })
  },

  async list(prefix = '') {
    return safe(() => {
      const fullPrefix = PREFIX + prefix
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(fullPrefix)) {
          keys.push(k.slice(PREFIX.length))
        }
      }
      return { keys, prefix, shared: false }
    })
  },
}
