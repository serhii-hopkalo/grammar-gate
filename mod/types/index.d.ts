export type Entry = {
  id: number
  role: 'you' | 'gate'
  text: string
  status?: 'checking' | 'clean' | 'fix' | 'error'
}

declare module 'claude-code' {
  interface PluginState {
    'grammar-pane': { log: Shaped<Entry[]> }
  }
}
